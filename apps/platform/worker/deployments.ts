/**
 * Builds and deployments: CI dispatch (preview builds at submit, production deploys at promote), build reports from
 * CI / agents / admins, and deployment records with their Phenome ingest tokens. `env.CI` (the cross-script
 * `artyfact-ci` Workflow) is optional: without it nothing is dispatched and builds arrive only as reports.
 */
import { templateFile } from "@artyfact/templates";
import { systemRepoNames } from "@artyfact/cli/naming";
import { parse as parseYaml } from "yaml";
import type {
  Build, BuildKind, BuildReport, BuildReportResponse, BuildReporter, BuildStatus, BuildStep, BuildSummary, BuildsResponse, CiBuildParams,
  Deployment, DeploymentCreated, DeploymentRequest, DeploymentsResponse, IngestTokenResponse, RealizedArtifactsResponse, SystemCommit,
} from "../shared/api";
import { artifactsFor, withRepo } from "./artifacts/client";
import { newRealizationSecret } from "./auth";
import { buildSummary } from "./do/builds-store";
import { TERMINAL_REALIZATION, type HeadState, type RealizationRecord } from "./do/system-authority";
import { badRequest, conflict, HttpError, notFound, unprocessable } from "./errors";
import { appThing, genomeAt, refreshRegistry, submit, systemStub } from "./service";
import { sha256Hex } from "./util";

const COMMIT_RE = /^[0-9a-f]{40}$/;
const BUILD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const STATUSES: BuildStatus[] = ["queued", "running", "passed", "failed", "error"];
const HTTP_URL = (v: unknown): v is string => typeof v === "string" && v.length <= 2048 && /^https?:\/\/[^\s]+$/.test(v);

export type CiBinding = Pick<Workflow<CiBuildParams>, "create">;

/**
 * The only build commands CI may run. They come from the app template's `scaffold.yaml` (platform-side), never from
 * the app repo or a request body, and anything else is refused before a Workflow starts. Mirrored by
 * `ALLOWED_COMMANDS` in `apps/ci/src/contract.ts`, which re-checks; `deploy` only names the step there.
 */
export const ALLOWED_COMMANDS = {
  install: ["npm install", "npm ci"],
  test: ["npm test", "npm run test"],
  build: ["npm run build"],
  deploy: ["npx wrangler deploy", "wrangler deploy"],
} as const satisfies Record<keyof CiBuildParams["commands"], readonly string[]>;

/** Throws unless every command is on {@link ALLOWED_COMMANDS} (`install` and `deploy` required). */
export function assertAllowedCommands(commands: CiBuildParams["commands"]): void {
  const bad = (["install", "test", "build", "deploy"] as const).filter((k) => {
    const v = commands[k];
    if (v === undefined) return k === "install" || k === "deploy";
    return !(ALLOWED_COMMANDS[k] as readonly string[]).includes(v);
  });
  if (bad.length) throw new Error(`commands not on the CI allowlist: ${bad.map((k) => `${k}=${JSON.stringify(commands[k] ?? null)}`).join(", ")}`);
}

let ciOverride: CiBinding | null | undefined;
/** Tests inject a fake Workflow binding (`null` forces "no CI"). */
export function setCiOverride(ci: CiBinding | null | undefined): void {
  ciOverride = ci;
}

/** The CI Workflow, or null when it is not bound or reports could not be accepted (no `CI_REPORT_TOKEN`). */
function ciFor(env: Env): CiBinding | null {
  const ci = ciOverride === undefined ? (env.CI ?? null) : ciOverride;
  if (ci && !env.CI_REPORT_TOKEN) {
    console.warn("[ci] the CI binding is set but CI_REPORT_TOKEN is not; builds are not dispatched");
    return null;
  }
  return ci;
}

// ------------------------------------------------------------------ names and params

/** Workflow instance ids allow letters, digits, `-` and `_` (max 100); a suffix keeps re-dispatches unique. */
export function workflowInstanceId(buildRow: string): string {
  const suffix = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${buildRow.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 90)}-${suffix}`;
}

/** Worker script name from the System slug: lower-case alphanumerics and dashes, at most 63 characters. */
function workerName(systemId: string, tail: string): string {
  const base = systemRepoNames(systemId).slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "system";
  return `${base.slice(0, 63 - tail.length)}${tail}`;
}
export const previewWorkerName = (systemId: string, n: number) => workerName(systemId, `-app-r${n}`);
export const productionWorkerName = (systemId: string) => workerName(systemId, "-app");

interface AppInfo { thingId: string; artifactId: string; commands: CiBuildParams["commands"] }

async function modelAt(env: Env, s: HeadState, genomeCommit: string, pinnedRepo?: string) {
  let last: unknown;
  for (const repo of new Set([...(pinnedRepo ? [pinnedRepo] : []), s.genomeSource, s.genomeRepo])) {
    try { return (await genomeAt(env, s.systemId, genomeCommit, repo)).model; } catch (e) { last = e; }
  }
  throw last;
}

async function realizationGenomeCommit(stub: ReturnType<typeof systemStub>, rec: RealizationRecord): Promise<string | undefined> {
  const pinned = await stub.realizationPinnedGenome(rec.realization.id);
  if (pinned) return pinned.commit;
  const baseHead = rec.realization.baseRevision;
  if (baseHead) {
    const base = await stub.systemCommit(baseHead);
    if (base?.composition?.genomeCommit) return base.composition.genomeCommit;
  }
  return undefined;
}

async function appBinding(env: Env, s: HeadState, genomeCommit = s.genomeCommit, artifactId?: string, pinnedRepo?: string): Promise<{ thingId: string; artifactId: string }> {
  const m = await modelAt(env, s, genomeCommit, pinnedRepo);
  const matches = m.things.flatMap((thing) => thing.artifacts
    .filter((artifact) => artifactId ? artifact.artifact === artifactId : artifact.type === "worker-fullstack")
    .map((artifact) => ({ thingId: thing.id, artifactId: artifact.artifact })));
  if (matches.length === 1) return matches[0];
  throw new Error(artifactId
    ? `artifact ${artifactId} must belong to exactly one Thing in the Genome (found ${matches.length})`
    : `the Genome must identify exactly one worker-fullstack artifact for an unpinned build (found ${matches.length})`);
}

/** The app Thing, its worker-fullstack artifact and the CI commands from its template's `scaffold.yaml`. */
async function appInfo(env: Env, s: HeadState, genomeCommit = s.genomeCommit, artifactId?: string, pinnedRepo?: string): Promise<AppInfo> {
  const fallback: AppInfo = { thingId: "unknown", artifactId: "artifact.webapp", commands: { install: "npm install", test: "npm test", deploy: "npx wrangler deploy" } };
  try {
    const m = await modelAt(env, s, genomeCommit, pinnedRepo);
    const thing = artifactId ? m.things.find(t => t.artifacts.some(a => a.artifact === artifactId)) : appThing(m);
    const artifact = thing?.artifacts.find((a) => artifactId ? a.artifact === artifactId : a.type === "worker-fullstack");
    const text = thing?.templateRef ? templateFile(thing.templateRef, "scaffold.yaml") : undefined;
    const cmds = (text ? (parseYaml(text) as { commands?: Record<string, unknown> })?.commands : undefined) ?? {};
    const pick = (k: string) => (typeof cmds[k] === "string" && (cmds[k] as string).trim() ? (cmds[k] as string).trim() : undefined);
    return {
      thingId: thing?.id ?? fallback.thingId,
      artifactId: artifact?.artifact ?? fallback.artifactId,
      commands: {
        install: pick("install") ?? fallback.commands.install,
        ...((pick("test") ?? fallback.commands.test) && { test: pick("test") ?? fallback.commands.test }),
        ...(pick("build") && { build: pick("build") }),
        deploy: pick("deploy") ?? fallback.commands.deploy,
      },
    };
  } catch (e) {
    console.error(`[ci] app info for ${s.systemId} unavailable, using defaults: ${(e as Error)?.message ?? e}`);
    return fallback;
  }
}

const platformUrl = (env: Env) => (env.PUBLIC_URL || "").replace(/\/+$/, "");

/** A fresh Phenome ingest token and its stored SHA-256. */
async function mintIngestToken(): Promise<{ token: string; hash: string }> {
  const token = newRealizationSecret();
  return { token, hash: await sha256Hex(token) };
}

/**
 * Check the commands and start the Workflow; record the instance id, or an `error` build (and failed deployment)
 * when the commands are refused or the Workflow cannot start.
 */
async function startCi(env: Env, ci: CiBinding, params: CiBuildParams): Promise<BuildSummary> {
  const stub = systemStub(env, params.systemId);
  const base = {
    id: params.buildId, realization: params.realizationId, candidate: params.candidateId, commit: params.commit, kind: params.kind, reporter: "ci" as const,
  };
  try {
    assertAllowedCommands(params.commands);
    const instance = await ci.create({ id: workflowInstanceId(params.buildId), params });
    return buildSummary((await stub.upsertBuild({ ...base, status: "queued", externalId: instance.id })).build);
  } catch (e) {
    const error = `CI could not start: ${(e as Error)?.message ?? e}`.slice(0, 4000);
    console.error(`[ci] ${params.buildId}: ${error}`);
    if (params.deploymentId) await stub.setDeploymentResult(params.deploymentId, { status: "failed" });
    return buildSummary((await stub.upsertBuild({ ...base, status: "error", error })).build);
  }
}

// ------------------------------------------------------------------ dispatch

/**
 * Called by `submit()` when an app candidate is created: a queued preview build `build.<rid>.<commit7>.ci`, a pending
 * preview deployment carrying an ingest token, and the `artyfact-ci` Workflow started for the fork commit. No-op
 * without CI or for Genome realizations; idempotent per (realization, commit). Never throws.
 */
export async function dispatchPreviewBuild(env: Env, s: HeadState, rec: RealizationRecord, candidate: { id: string; commit: string }): Promise<BuildSummary | null> {
  if (rec.target !== "app") return null;
  const ci = ciFor(env);
  if (!ci) return null;
  const stub = systemStub(env, s.systemId);
  const rid = rec.realization.id;
  const buildId = `build.${rid}.${candidate.commit.slice(0, 7)}.ci`;
  try {
    const existing = await stub.build(buildId);
    if (existing) return buildSummary(existing);
    const genomeCommit = await realizationGenomeCommit(stub, rec);
    if (!genomeCommit) throw new Error(`the Genome lineage of ${rid} is unknown`);
    const pinned = await stub.realizationPinnedGenome(rid);
    const artifactId = await stub.realizationBindingId(rid);
    const app = await appInfo(env, s, genomeCommit, artifactId ?? undefined, pinned?.repo);
    const binding = await appBinding(env, s, genomeCommit, artifactId ?? undefined, pinned?.repo);
    const ingest = await mintIngestToken();
    await stub.upsertBuild({
      id: buildId, realization: rid, candidate: candidate.id, commit: candidate.commit, kind: "preview", status: "queued", reporter: "ci",
      sourceRepo: rec.forkRepo, genomeCommit, thingId: binding.thingId, artifactId: binding.artifactId,
    });
    const deployment = await stub.createDeployment({
      kind: "preview", artifactId: binding.artifactId, repo: rec.forkRepo, commit: candidate.commit, realization: rid, buildRow: buildId, by: "ci", ingestTokenHash: ingest.hash,
    });
    return await startCi(env, ci, {
      buildId, systemId: s.systemId, realizationId: rid, candidateId: candidate.id, namespace: env.ARTIFACTS_NAMESPACE, repo: rec.forkRepo,
      commit: candidate.commit, kind: "preview", workerName: previewWorkerName(s.systemId, rec.realization.n ?? Number(/--r(\d+)$/.exec(rec.forkRepo)?.[1] ?? 0)),
      thingId: binding.thingId, artifactId: binding.artifactId, genomeCommit,
      vars: {
        BUILD_ID: candidate.commit, ARTYFACT_PLATFORM_URL: platformUrl(env), ARTYFACT_SYSTEM_ID: s.systemId, ARTYFACT_THING_ID: binding.thingId,
        ARTYFACT_ARTIFACT_ID: binding.artifactId, ARTYFACT_REALIZATION_ID: rid, ARTYFACT_DEPLOYMENT_ID: deployment.id, ARTYFACT_INGEST_TOKEN: ingest.token,
      },
      commands: app.commands,
      reportUrl: `${platformUrl(env)}/api/systems/${encodeURIComponent(s.systemId)}/realizations/${encodeURIComponent(rid)}/builds`,
      deploymentId: deployment.id,
    });
  } catch (e) {
    console.error(`[ci] dispatching ${buildId} failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

/**
 * Called at the end of `promote()`: a pending production deployment of the promoted app binding and, with CI, a
 * production build deploying `<slug>-app`. Without CI the deployment stays pending until an admin records it
 * (`POST …/deployments`) or a production build report arrives. Never throws.
 */
export async function requestProductionDeploy(
  env: Env, systemId: string, commit: SystemCommit, artifactId: string, realization?: string,
): Promise<Deployment | null> {
  const app = commit.composition?.artifacts[artifactId];
  if (!app) return null;
  const stub = systemStub(env, systemId);
  try {
    const ingest = await mintIngestToken();
    const deployment = await stub.createDeployment({
      kind: "production", artifactId, repo: app.repo, commit: app.commit, systemCommit: commit.id, ...(realization && { realization }), by: "admin", ingestTokenHash: ingest.hash,
    });
    const ci = ciFor(env);
    if (!ci) return deployment;
    const s = await stub.state();
    if (!s) return deployment;
    const genomeCommit = app.realizedGenome ?? commit.composition?.genomeCommit ?? s.genomeCommit;
    const info = await appInfo(env, s, genomeCommit, artifactId);
    const binding = await appBinding(env, s, genomeCommit, artifactId);
    const scriptName = Object.keys(commit.composition?.artifacts ?? {}).length === 1 ? productionWorkerName(systemId) : workerName(systemId, `-app-${(await sha256Hex(artifactId)).slice(0, 8)}`);
    const buildId = `build.${deployment.id}`;
    await stub.upsertBuild({
      id: buildId, realization: null, candidate: null, commit: app.commit, kind: "production", status: "queued", reporter: "ci",
      sourceRepo: app.repo, genomeCommit, thingId: binding.thingId, artifactId: binding.artifactId,
    });
    await stub.setDeploymentResult(deployment.id, { buildRow: buildId });
    await startCi(env, ci, {
      buildId, systemId, realizationId: null, candidateId: null, namespace: env.ARTIFACTS_NAMESPACE, repo: app.repo, commit: app.commit,
      kind: "production", workerName: scriptName, thingId: binding.thingId, artifactId: binding.artifactId,
      genomeCommit,
      vars: {
        BUILD_ID: app.commit, ARTYFACT_PLATFORM_URL: platformUrl(env), ARTYFACT_SYSTEM_ID: systemId, ARTYFACT_THING_ID: binding.thingId,
        ARTYFACT_ARTIFACT_ID: binding.artifactId, ARTYFACT_SYSTEM_COMMIT: commit.id, ARTYFACT_DEPLOYMENT_ID: deployment.id, ARTYFACT_INGEST_TOKEN: ingest.token,
      },
      commands: info.commands,
      reportUrl: `${platformUrl(env)}/api/systems/${encodeURIComponent(systemId)}/builds`,
      deploymentId: deployment.id,
    });
    return await stub.deployment(deployment.id);
  } catch (e) {
    console.error(`[ci] requesting the production deploy of ${commit.id} failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

// ------------------------------------------------------------------ reports

const trim = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function parseSteps(v: unknown): BuildStep[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw badRequest("steps must be an array");
  return v.slice(0, 50).map((x: Partial<BuildStep>, i) => {
    if (!x || typeof x.name !== "string" || !STATUSES.includes(x.status as BuildStatus)) throw badRequest(`steps[${i}] needs a name and a build status`);
    return {
      name: x.name.slice(0, 100), status: x.status as BuildStatus,
      ...(typeof x.durationMs === "number" && Number.isFinite(x.durationMs) && x.durationMs >= 0 && { durationMs: Math.round(x.durationMs) }),
      ...(HTTP_URL(x.logsUrl) && { logsUrl: x.logsUrl }),
    };
  });
}

/** Validate a {@link BuildReport} body. */
export function parseReport(body: unknown): BuildReport {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== "object") throw badRequest("body must be a JSON object");
  if (!STATUSES.includes(b.status as BuildStatus)) throw badRequest(`status must be one of ${STATUSES.join(", ")}`);
  if (typeof b.commit !== "string" || !COMMIT_RE.test(b.commit)) throw badRequest("commit must be a 40-character hex sha");
  if (b.kind !== undefined && b.kind !== "preview" && b.kind !== "production") throw badRequest("kind must be preview or production");
  if (b.id !== undefined && (typeof b.id !== "string" || !BUILD_ID_RE.test(b.id))) throw badRequest("id must be a build id (letters, digits, . _ : -)");
  for (const k of ["url", "logsUrl"] as const) if (b[k] !== undefined && b[k] !== null && !HTTP_URL(b[k])) throw badRequest(`${k} must be an http(s) URL`);
  if (b.deploymentId !== undefined && typeof b.deploymentId !== "string") throw badRequest("deploymentId must be a string");
  let output: BuildReport["output"];
  if (b.output !== undefined) {
    if (!b.output || typeof b.output !== "object" || Array.isArray(b.output)) throw badRequest("output must be an object");
    const raw = b.output as Record<string, unknown>;
    const locator = trim(raw.locator, 2048), digest = trim(raw.digest, 512);
    if (!locator && !digest) throw badRequest("output needs a locator or digest");
    if (b.status !== "passed") throw badRequest("output may be reported only for a passed build");
    output = { ...(locator && { locator }), ...(digest && { digest }) };
  }
  return {
    status: b.status as BuildStatus, commit: b.commit,
    ...(b.id !== undefined && { id: b.id as string }), ...(b.kind !== undefined && { kind: b.kind as BuildKind }),
    ...(HTTP_URL(b.url) && { url: b.url }), ...(HTTP_URL(b.logsUrl) && { logsUrl: b.logsUrl }),
    ...(trim(b.buildId, 200) && { buildId: trim(b.buildId, 200) }), ...(trim(b.externalId, 200) && { externalId: trim(b.externalId, 200) }),
    ...(trim(b.deploymentId, 200) && { deploymentId: trim(b.deploymentId, 200) }), ...(parseSteps(b.steps) && { steps: parseSteps(b.steps) }),
    ...(trim(b.error, 4000) && { error: trim(b.error, 4000) }), ...(trim(b.startedAt, 40) && { startedAt: trim(b.startedAt, 40) }),
    ...(trim(b.finishedAt, 40) && { finishedAt: trim(b.finishedAt, 40) }), ...(output && { output }),
  };
}

/** An agent reports only commits it submitted (a candidate of its realization) or its fork's current head. */
async function assertAgentCommit(env: Env, stub: ReturnType<typeof systemStub>, rec: RealizationRecord, commit: string): Promise<void> {
  if ((await stub.candidates({ realizationId: rec.realization.id })).some((c) => c.commit === commit)) return;
  const [head] = await withRepo(artifactsFor(env), rec.forkRepo, (repo) => repo.log({ limit: 1 }));
  if (head?.hash === commit) return;
  throw unprocessable("unknown-commit", `commit ${commit.slice(0, 12)} is neither a candidate of ${rec.realization.id} nor the head of ${rec.forkRepo}`);
}

/** The head System commit when `repo@commit` is one of its app artifacts, so a deployment of it records that commit. */
function headSystemCommit(state: { head: string | null; manifest?: { artifacts?: Record<string, { repo: string; commit: string }> } | null }, repo: string, commit: string): string | undefined {
  if (!state.head) return undefined;
  return Object.values(state.manifest?.artifacts ?? {}).some((a) => a.repo === repo && a.commit === commit) ? state.head : undefined;
}

/**
 * Record a build report. Realization reports are previews (an agent may report nothing else); System reports default
 * to production. `passed` + `url` for a realization re-enters `submit(…, {commit, previewUrl}, "ci")`, which stores the
 * preview on the candidate and re-runs the hooks (`C.webapp.health` against the stored runtime build identity). A report naming a
 * deployment sets it `live` (superseding the previous live one) or `failed`.
 */
export async function reportBuild(env: Env, systemId: string, rid: string | null, body: unknown, reporter: BuildReporter): Promise<BuildReportResponse> {
  const r = parseReport(body);
  const stub = systemStub(env, systemId);
  const state = await stub.state();
  if (!state) throw notFound(`system ${systemId} is not imported`);
  const rec = rid ? await stub.realization(rid) : null;
  if (rid && !rec) throw notFound(`unknown realization ${rid}`);
  const kind: BuildKind = r.kind ?? (rid ? "preview" : "production");
  if (rid && kind !== "preview" && reporter === "agent") throw new HttpError(403, "forbidden", "an agent reports preview builds only");
  // An agent reports only its own row and never touches deployments: client ids and deployment ids are ignored.
  const agent = reporter === "agent";
  const id = (!agent && r.id) || `build.${rid ?? "sys"}.${r.commit.slice(0, 7)}.${reporter}`;
  const deploymentId = agent ? undefined : r.deploymentId;
  const prev = await stub.build(id);
  if (prev && agent && prev.reporter === "ci") throw new HttpError(403, "forbidden", `build ${id} is reported by CI`);
  if (prev && (prev.realization !== (rid ?? null) || prev.commit !== r.commit)) {
    throw conflict("build-mismatch", `build ${id} belongs to ${prev.realization ?? "the System"} at ${prev.commit.slice(0, 12)}`);
  }
  if (prev?.output && r.output && (prev.output.locator !== r.output.locator || prev.output.digest !== r.output.digest)) {
    throw conflict("output-mismatch", `build ${id} already identifies realized output ${prev.output.id}`);
  }
  if (reporter === "agent" && rec) await assertAgentCommit(env, stub, rec, r.commit);
  let deployment = deploymentId ? await stub.deployment(deploymentId) : null;
  if (deploymentId && (!deployment || (rid && deployment.realization !== rid) || deployment.commit !== r.commit)) {
    throw notFound(`unknown deployment ${r.deploymentId} for this ${rid ? "realization" : "System"} at ${r.commit.slice(0, 12)}`);
  }
  // Production without a named deployment: the newest pending one of this commit, or a new record only for the head's
  // app commit. Anything else was never promoted, so it cannot become the System's live deployment.
  let pending: Deployment | null = null;
  if (!deployment && kind === "production" && r.status === "passed") {
    const matches = (await stub.deployments({ kind: "production" })).filter(d => d.status === "pending" && d.commit === r.commit && (!prev?.source || d.repo === prev.source.repo) && (!prev?.artifactId || !d.artifactId || d.artifactId === prev.artifactId));
    if (matches.length > 1) throw conflict("artifact-binding-required", "name the exact production deployment for this build report");
    pending = matches[0] ?? null;
    if (!pending && !Object.values(state.manifest?.artifacts ?? {}).some(a => a.commit === r.commit)) {
      throw conflict("not-promoted", `commit ${r.commit.slice(0, 12)} is not the System's app commit and has no pending production deployment`);
    }
  }
  let sourceRepo: string | undefined, genomeCommit: string | undefined, thingId: string | undefined, artifactId: string | undefined;
  if ((!rec || rec.target === "app") && prev?.source && prev.genomeCommit && prev.thingId && prev.artifactId) {
    ({ repo: sourceRepo } = prev.source); ({ genomeCommit, thingId, artifactId } = prev);
  } else if (rec?.target === "app") {
    sourceRepo = rec.forkRepo;
    genomeCommit = await realizationGenomeCommit(stub, rec);
    if (genomeCommit) {
      try { const pin = await stub.realizationPinnedGenome(rec.realization.id); const bindingId = await stub.realizationBindingId(rec.realization.id); ({ thingId, artifactId } = await appBinding(env, state, genomeCommit, bindingId ?? undefined, pin?.repo)); } catch { /* legacy report remains unknown unless it claims output */ }
    }
  } else if (!rec) {
    const lineageDeployment = deployment ?? pending;
    sourceRepo = lineageDeployment?.repo;
    let artifactHint: string | undefined;
    if (lineageDeployment?.systemCommit) {
      const sc = await stub.systemCommit(lineageDeployment.systemCommit);
      const matches = Object.entries(sc?.composition?.artifacts ?? {}).filter(([id, a]) => a.repo === sourceRepo && a.commit === r.commit && (!lineageDeployment.artifactId || id === lineageDeployment.artifactId));
      if (matches.length > 1) throw conflict("artifact-binding-required", "the deployment source matches more than one artifact binding");
      artifactHint = matches[0]?.[0];
      genomeCommit = matches[0]?.[1].realizedGenome ?? sc?.composition?.genomeCommit;
    } else {
      const matches = Object.entries(state.manifest?.artifacts ?? {}).filter(([id, a]) => a.commit === r.commit && (!sourceRepo || a.repo === sourceRepo) && (!lineageDeployment?.artifactId || id === lineageDeployment.artifactId));
      if (matches.length > 1) throw conflict("artifact-binding-required", "the reported source matches more than one artifact binding");
      if (matches[0]) { artifactHint = matches[0][0]; sourceRepo = matches[0][1].repo; genomeCommit = matches[0][1].realizedGenome ?? state.genomeCommit; }
    }
    if (genomeCommit) {
      try { ({ thingId, artifactId } = await appBinding(env, state, genomeCommit, artifactHint)); } catch { /* legacy report remains unknown unless it claims output */ }
    }
  }
  if (r.output && (!sourceRepo || !genomeCommit || !thingId || !artifactId)) {
    throw conflict("output-lineage-unknown", "the build output cannot be recorded until its source, Genome, Thing and artifact lineage are authoritative");
  }
  const candidateOf = async () => (rid ? (await stub.candidates({ realizationId: rid })).find((c) => c.commit === r.commit)?.id ?? null : null);
  const upsert = async (candidate: string | null) => (await stub.upsertBuild({
    id, realization: rid, candidate, commit: r.commit, kind, status: r.status, reporter,
    ...(sourceRepo && { sourceRepo }), ...(genomeCommit && { genomeCommit }), ...(thingId && { thingId }), ...(artifactId && { artifactId }),
    ...(r.output && { output: r.output }),
    ...(r.url && { url: r.url }), ...(r.buildId && { buildId: r.buildId }), ...(r.logsUrl && { logsUrl: r.logsUrl }), ...(r.externalId && { externalId: r.externalId }),
    ...(r.steps && { steps: r.steps }), ...(r.error && { error: r.error }), ...(r.startedAt && { startedAt: r.startedAt }), ...(r.finishedAt && { finishedAt: r.finishedAt }),
  })).build;
  let build: Build = await upsert(await candidateOf());
  const out: BuildReportResponse = { build };

  // A passed preview with a URL: the candidate gets its preview and the hooks re-run (submit is idempotent).
  if (build.status === "passed" && build.url && rec && kind === "preview" && rec.target === "app" && !TERMINAL_REALIZATION.includes(rec.realization.status)) {
    const sub = await submit(env, systemId, rec.realization.id, { commit: r.commit, previewUrl: build.url }, "ci");
    out.candidate = sub.candidate;
    out.evaluations = sub.evaluations;
    if (build.candidate !== sub.candidate.id) build = await upsert(sub.candidate.id);
  }

  if (!deployment && kind === "production" && build.status === "passed") {
    deployment = pending;
    if (!deployment) {
      if (!sourceRepo) throw conflict("no-app-source", "the System has no unambiguous source artifact to deploy");
      // Only the head's app commit gets here (see not-promoted above): the head is the System commit it deploys.
      const systemCommit = headSystemCommit(state, sourceRepo, r.commit);
      deployment = await stub.createDeployment({
        kind: "production", ...(artifactId && { artifactId }), repo: sourceRepo, commit: r.commit, ...(systemCommit && { systemCommit }), by: reporter, buildRow: id,
      });
    }
  }
  if (deployment) {
    const status = build.status === "passed" ? "live" : build.status === "failed" || build.status === "error" ? "failed" : undefined;
    await stub.setDeploymentResult(deployment.id, {
      ...(status && { status }), buildRow: id, ...(build.url && { url: build.url }), ...(build.buildId && { buildId: build.buildId }),
      ...(build.output && { realizedArtifactId: build.output.id }),
    });
  }
  await refreshRegistry(env, systemId);
  out.build = build;
  return out;
}

// ------------------------------------------------------------------ reads and admin

export async function buildsView(env: Env, systemId: string, q: { realization?: string; commit?: string; kind?: string }): Promise<BuildsResponse> {
  if (q.commit !== undefined && !COMMIT_RE.test(q.commit)) throw badRequest("commit must be a 40-character hex sha");
  if (q.kind !== undefined && q.kind !== "preview" && q.kind !== "production") throw badRequest("kind must be preview or production");
  return { builds: await systemStub(env, systemId).builds({ ...q, kind: q.kind as BuildKind | undefined }) };
}

export async function realizedArtifactsView(env: Env, systemId: string): Promise<RealizedArtifactsResponse> {
  return { artifacts: await systemStub(env, systemId).realizedArtifacts() };
}

export async function deploymentsView(env: Env, systemId: string): Promise<DeploymentsResponse> {
  const stub = systemStub(env, systemId);
  const [production, history] = await Promise.all([stub.liveProduction(), stub.deployments()]);
  return { production, history };
}

/**
 * Admin: record a deployment made outside CI (default: production of the head's app commit) as `live`. A pending
 * deployment of the same kind and commit (a promotion without CI) is the one recorded. The ingest token is returned
 * here only; the platform keeps its hash.
 */
export async function createDeployment(env: Env, systemId: string, body: unknown): Promise<DeploymentCreated> {
  const b = (body ?? {}) as DeploymentRequest & { url?: unknown; artifactId?: unknown };
  const stub = systemStub(env, systemId);
  const s = await stub.state();
  if (!s) throw notFound(`system ${systemId} is not imported`);
  const kind = b.kind ?? "production";
  if (kind !== "preview" && kind !== "production") throw badRequest("kind must be preview or production");
  const rec = b.realization !== undefined ? await stub.realization(String(b.realization)) : null;
  if (b.realization !== undefined && !rec) throw notFound(`unknown realization ${b.realization}`);
  if (kind === "preview" && !rec) throw badRequest("a preview deployment names its realization");
  if (b.outputId !== undefined && (typeof b.outputId !== "string" || !b.outputId.trim())) throw badRequest("outputId must be a non-empty string");
  const output = b.outputId ? await stub.realizedArtifact(b.outputId) : null;
  if (b.outputId && !output) throw notFound(`unknown realized output ${b.outputId}`);
  if (b.artifactId !== undefined && (typeof b.artifactId !== "string" || !Object.hasOwn(s.manifest?.artifacts ?? {}, b.artifactId))) throw badRequest("artifactId must identify a bound System artifact");
  const pinnedBinding = rec ? await stub.realizationBindingId(rec.realization.id) : null;
  if (pinnedBinding && b.artifactId !== undefined && b.artifactId !== pinnedBinding) throw conflict("artifact-binding-mismatch", "Task attempt belongs to a different artifact binding");
  const bindingId = pinnedBinding ?? (typeof b.artifactId === "string" ? b.artifactId : output?.artifactId);
  const bindings = Object.entries(s.manifest?.artifacts ?? {});
  const byCommit = b.commit ? bindings.filter(([, a]) => a.commit === b.commit) : [];
  const selected = bindingId ? bindings.find(([id]) => id === bindingId) : bindings.length === 1 ? bindings[0] : byCommit.length === 1 ? byCommit[0] : undefined;
  if (output && bindingId && output.artifactId !== bindingId) throw conflict("output-artifact-mismatch", "realized output belongs to a different artifact binding");
  if (!rec && !selected) throw conflict("artifact-binding-required", "select an artifact binding for this deployment");
  const commit = b.commit ?? output?.source.commit ?? (kind === "production" && !rec ? selected?.[1].commit : undefined);
  if (typeof commit !== "string" || !COMMIT_RE.test(commit)) throw badRequest("commit must be a 40-character hex sha");
  if (b.url !== undefined && !HTTP_URL(b.url)) throw badRequest("url must be an http(s) URL");
  const url = HTTP_URL(b.url) ? b.url : undefined;
  const repo = rec ? rec.forkRepo : selected![1].repo;
  if (output && (output.source.repo !== repo || output.source.commit !== commit)) throw conflict("output-source-mismatch", "realized output source does not match the deployment repository and commit");
  const build = output ? await stub.build(output.build) : null;
  if (output && (!build || build.status !== "passed" || build.commit !== commit || build.source?.repo !== repo)) throw conflict("output-build-mismatch", "realized output does not have a matching passed build");
  const lineage = output ? { realizedArtifactId: output.id, buildRow: output.build, ...(build?.buildId && { buildId: build.buildId }) } : { buildId: commit };
  const scopeArtifactId = pinnedBinding ?? selected?.[0] ?? output?.artifactId;
  const ingest = await mintIngestToken();
  const pending = !output && (await stub.deployments({ kind })).find((d) => d.status === "pending" && d.repo === repo && d.commit === commit && (!d.artifactId || d.artifactId === scopeArtifactId) && (!rec || d.realization === rec.realization.id));
  let deployment: Deployment | null;
  if (pending) {
    await stub.setDeploymentIngestHash(pending.id, ingest.hash);
    deployment = await stub.setDeploymentResult(pending.id, { status: "live", ...(url && { url }), buildId: commit });
  } else {
    const systemCommit = headSystemCommit(s, repo, commit);
    deployment = await stub.createDeployment({
      kind, status: "live", ...(scopeArtifactId && { artifactId: scopeArtifactId }), repo, commit, ...(systemCommit && { systemCommit }), ...(rec && { realization: rec.realization.id }), ...(url && { url }), ...lineage, by: "admin", ingestTokenHash: ingest.hash,
    });
  }
  await refreshRegistry(env, systemId);
  return { ...deployment!, ingestToken: ingest.token };
}

/** Admin: replace a deployment's ingest token; the old one stops working. */
export async function rotateIngestToken(env: Env, systemId: string, deploymentId: string): Promise<IngestTokenResponse> {
  const ingest = await mintIngestToken();
  const deployment = await systemStub(env, systemId).setDeploymentIngestHash(deploymentId, ingest.hash);
  if (!deployment) throw notFound(`unknown deployment ${deploymentId}`);
  return { deployment, ingestToken: ingest.token };
}
