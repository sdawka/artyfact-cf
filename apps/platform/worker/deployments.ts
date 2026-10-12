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
  Deployment, DeploymentCreated, DeploymentRequest, DeploymentsResponse, IngestTokenResponse, SystemCommit,
} from "../shared/api";
import { artifactsFor, withRepo } from "./artifacts/client";
import { newRealizationSecret } from "./auth";
import { buildSummary } from "./do/builds-store";
import { TERMINAL_REALIZATION, type HeadState, type RealizationRecord } from "./do/system-authority";
import { badRequest, conflict, HttpError, notFound, unprocessable } from "./errors";
import { genomeAt, refreshRegistry, submit, systemStub } from "./service";
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

/** The app Thing, its worker-fullstack artifact and the CI commands from its template's `scaffold.yaml`. */
async function appInfo(env: Env, s: HeadState): Promise<AppInfo> {
  const fallback: AppInfo = { thingId: "unknown", artifactId: "artifact.webapp", commands: { install: "npm install", test: "npm test", deploy: "npx wrangler deploy" } };
  try {
    const m = (await genomeAt(env, s.systemId, s.genomeCommit, s.genomeSource)).model;
    const thing = m.things.find((t) => t.artifacts.some((a) => a.type === "worker-fullstack")) ?? m.things[0];
    const artifact = thing?.artifacts.find((a) => a.type === "worker-fullstack");
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
    const app = await appInfo(env, s);
    const ingest = await mintIngestToken();
    await stub.upsertBuild({ id: buildId, realization: rid, candidate: candidate.id, commit: candidate.commit, kind: "preview", status: "queued", reporter: "ci" });
    const deployment = await stub.createDeployment({
      kind: "preview", repo: rec.forkRepo, commit: candidate.commit, realization: rid, buildRow: buildId, by: "ci", ingestTokenHash: ingest.hash,
    });
    return await startCi(env, ci, {
      buildId, systemId: s.systemId, realizationId: rid, candidateId: candidate.id, namespace: env.ARTIFACTS_NAMESPACE, repo: rec.forkRepo,
      commit: candidate.commit, kind: "preview", workerName: previewWorkerName(s.systemId, rec.realization.n ?? Number(/--r(\d+)$/.exec(rec.forkRepo)?.[1] ?? 0)),
      vars: {
        BUILD_ID: candidate.commit, ARTYFACT_PLATFORM_URL: platformUrl(env), ARTYFACT_SYSTEM_ID: s.systemId, ARTYFACT_THING_ID: app.thingId,
        ARTYFACT_ARTIFACT_ID: app.artifactId, ARTYFACT_REALIZATION_ID: rid, ARTYFACT_DEPLOYMENT_ID: deployment.id, ARTYFACT_INGEST_TOKEN: ingest.token,
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
      kind: "production", repo: app.repo, commit: app.commit, systemCommit: commit.id, ...(realization && { realization }), by: "admin", ingestTokenHash: ingest.hash,
    });
    const ci = ciFor(env);
    if (!ci) return deployment;
    const s = await stub.state();
    if (!s) return deployment;
    const info = await appInfo(env, s);
    const buildId = `build.${deployment.id}`;
    await stub.upsertBuild({ id: buildId, realization: null, candidate: null, commit: app.commit, kind: "production", status: "queued", reporter: "ci" });
    await stub.setDeploymentResult(deployment.id, { buildRow: buildId });
    await startCi(env, ci, {
      buildId, systemId, realizationId: null, candidateId: null, namespace: env.ARTIFACTS_NAMESPACE, repo: app.repo, commit: app.commit,
      kind: "production", workerName: productionWorkerName(systemId),
      vars: {
        BUILD_ID: app.commit, ARTYFACT_PLATFORM_URL: platformUrl(env), ARTYFACT_SYSTEM_ID: systemId, ARTYFACT_THING_ID: info.thingId,
        ARTYFACT_ARTIFACT_ID: info.artifactId, ARTYFACT_SYSTEM_COMMIT: commit.id, ARTYFACT_DEPLOYMENT_ID: deployment.id, ARTYFACT_INGEST_TOKEN: ingest.token,
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
  return {
    status: b.status as BuildStatus, commit: b.commit,
    ...(b.id !== undefined && { id: b.id as string }), ...(b.kind !== undefined && { kind: b.kind as BuildKind }),
    ...(HTTP_URL(b.url) && { url: b.url }), ...(HTTP_URL(b.logsUrl) && { logsUrl: b.logsUrl }),
    ...(trim(b.buildId, 200) && { buildId: trim(b.buildId, 200) }), ...(trim(b.externalId, 200) && { externalId: trim(b.externalId, 200) }),
    ...(trim(b.deploymentId, 200) && { deploymentId: trim(b.deploymentId, 200) }), ...(parseSteps(b.steps) && { steps: parseSteps(b.steps) }),
    ...(trim(b.error, 4000) && { error: trim(b.error, 4000) }), ...(trim(b.startedAt, 40) && { startedAt: trim(b.startedAt, 40) }),
    ...(trim(b.finishedAt, 40) && { finishedAt: trim(b.finishedAt, 40) }),
  };
}

/** An agent reports only commits it submitted (a candidate of its realization) or its fork's current head. */
async function assertAgentCommit(env: Env, stub: ReturnType<typeof systemStub>, rec: RealizationRecord, commit: string): Promise<void> {
  if ((await stub.candidates({ realizationId: rec.realization.id })).some((c) => c.commit === commit)) return;
  const [head] = await withRepo(artifactsFor(env), rec.forkRepo, (repo) => repo.log({ limit: 1 }));
  if (head?.hash === commit) return;
  throw unprocessable("unknown-commit", `commit ${commit.slice(0, 12)} is neither a candidate of ${rec.realization.id} nor the head of ${rec.forkRepo}`);
}

/**
 * Record a build report. Realization reports are previews (an agent may report nothing else); System reports default
 * to production. `passed` + `url` for a realization re-enters `submit(…, {commit, previewUrl}, "ci")`, which stores the
 * preview on the candidate and re-runs the hooks (`C.webapp.health` against `BUILD_ID=<commit>`). A report naming a
 * deployment sets it `live` (superseding the previous live one) or `failed`.
 */
export async function reportBuild(env: Env, systemId: string, rid: string | null, body: unknown, reporter: BuildReporter): Promise<BuildReportResponse> {
  const r = parseReport(body);
  const stub = systemStub(env, systemId);
  if (!(await stub.state())) throw notFound(`system ${systemId} is not imported`);
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
  if (reporter === "agent" && rec) await assertAgentCommit(env, stub, rec, r.commit);
  let deployment = deploymentId ? await stub.deployment(deploymentId) : null;
  if (deploymentId && (!deployment || (rid && deployment.realization !== rid) || deployment.commit !== r.commit)) {
    throw notFound(`unknown deployment ${r.deploymentId} for this ${rid ? "realization" : "System"} at ${r.commit.slice(0, 12)}`);
  }
  // Production without a named deployment: the newest pending one of this commit, or a new record only for the head's
  // app commit. Anything else was never promoted, so it cannot become the System's live deployment.
  let pending: Deployment | null = null;
  if (!deployment && kind === "production" && r.status === "passed") {
    pending = (await stub.deployments({ kind: "production" })).find((d) => d.status === "pending" && d.commit === r.commit) ?? null;
    const s = await stub.state();
    if (!pending && s?.appSource.commit !== r.commit) {
      throw conflict("not-promoted", `commit ${r.commit.slice(0, 12)} is not the System's app commit and has no pending production deployment`);
    }
  }
  const candidateOf = async () => (rid ? (await stub.candidates({ realizationId: rid })).find((c) => c.commit === r.commit)?.id ?? null : null);
  const upsert = async (candidate: string | null) => (await stub.upsertBuild({
    id, realization: rid, candidate, commit: r.commit, kind, status: r.status, reporter,
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
      const s = await stub.state();
      deployment = await stub.createDeployment({ kind: "production", repo: s!.appSource.repo, commit: r.commit, by: reporter, buildRow: id });
    }
  }
  if (deployment) {
    const status = build.status === "passed" ? "live" : build.status === "failed" || build.status === "error" ? "failed" : undefined;
    await stub.setDeploymentResult(deployment.id, { ...(status && { status }), buildRow: id, ...(build.url && { url: build.url }), ...(build.buildId && { buildId: build.buildId }) });
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
  const b = (body ?? {}) as DeploymentRequest & { url?: unknown };
  const stub = systemStub(env, systemId);
  const s = await stub.state();
  if (!s) throw notFound(`system ${systemId} is not imported`);
  const kind = b.kind ?? "production";
  if (kind !== "preview" && kind !== "production") throw badRequest("kind must be preview or production");
  const rec = b.realization !== undefined ? await stub.realization(String(b.realization)) : null;
  if (b.realization !== undefined && !rec) throw notFound(`unknown realization ${b.realization}`);
  if (kind === "preview" && !rec) throw badRequest("a preview deployment names its realization");
  const commit = b.commit ?? (kind === "production" && !rec ? s.appSource.commit : undefined);
  if (typeof commit !== "string" || !COMMIT_RE.test(commit)) throw badRequest("commit must be a 40-character hex sha");
  if (b.url !== undefined && !HTTP_URL(b.url)) throw badRequest("url must be an http(s) URL");
  const url = HTTP_URL(b.url) ? b.url : undefined;
  const ingest = await mintIngestToken();
  const pending = (await stub.deployments({ kind })).find((d) => d.status === "pending" && d.commit === commit && (!rec || d.realization === rec.realization.id));
  let deployment: Deployment | null;
  if (pending) {
    await stub.setDeploymentIngestHash(pending.id, ingest.hash);
    deployment = await stub.setDeploymentResult(pending.id, { status: "live", ...(url && { url }), buildId: commit });
  } else {
    const repo = rec ? rec.forkRepo : s.appSource.commit === commit ? s.appSource.repo : s.appRepo;
    deployment = await stub.createDeployment({
      kind, status: "live", repo, commit, ...(rec && { realization: rec.realization.id }), ...(url && { url }), buildId: commit, by: "admin", ingestTokenHash: ingest.hash,
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
