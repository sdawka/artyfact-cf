import { acceptedTemplateResolver } from './ontology-packages/store';
/**
 * Orchestration between Artifacts, the model, hooks and the SystemAuthority DO. Routes and the queue
 * consumer call these; all Artifacts I/O and model work happens here (never inside the DO).
 */
import { diffModels, type Readiness, type schema, type SystemModel } from "@artyfact/model";
import { templateFile } from "@artyfact/templates";
import { parse as parseYaml } from "yaml";
import type {
  Candidate, CandidatesResponse, ConflictReport, CreateEvolutionResponse, EvaluateCandidateResponse, Finding, PlatformRef, ScaffoldSource, ConflictsResponse, DeleteSystemResponse, Evaluation, Evolution, GateItem, GenomeCandidateReview, ImportSystemResponse, ModelBundle, PacketResponse, PromoteResponse,
  ReadinessResponse, RealizationResponse, SystemSummary, SerializedModel, StartWorkRequest, StartWorkResponse, SubmitResponse, SubmitSource, SyncResponse,
} from "../shared/api";
import { newRealizationSecret } from "./auth";
import { sha256Hex } from "./util";
import { isName, systemRepoNames } from "@artyfact/cli/naming";
import { readPlatform, unreadableWarning, unsyncedWarning } from "./artifacts/platform";
import { artifactsErrorCode, artifactsFor, forkAndWait, remoteUrl, withRepo, type ArtifactsRepoLike } from "./artifacts/client";
import { buildCandidateManifest, manifestHash, type CandidateManifest } from "./artifacts/candidates";
import { buildGenome, byteLength, GENOME_MAX_BYTES, genomePrefix, listTree, memoGenome, readGenomeFiles, readGenomeSourceFiles, type LoadedGenome } from "./artifacts/genome-source";
import { nodesForPath, sourceMapFor } from "./artifacts/source-map";
import { REGISTRY, TERMINAL_REALIZATION, type EndedCredential, type SystemAuthority, type EvolutionSeed, type HeadState, type ManifestExtras, type RealizationRecord } from "./do/system-authority";
import { badRequest, conflict, fromRpc, HttpError, notFound, unprocessable } from "./errors";
import type { CandidateRef, FileMap, QueueContext, SubmissionContext } from "./hooks/contract";
import { hookRunner } from "./hooks/index";
import { buildGenomeReview } from "./genome/review";
import { readinessReport, serializeModel } from "./model-bundle";
import { buildTaskPacket, protectedPathsFor } from "./packets/task-packet";
import { ensurePushSubscription, removePushSubscription } from "./artifacts/subscriptions";
import { dispatchPreviewBuild, requestProductionDeploy } from "./deployments";
import { gateCriteria, hooksOf, type GateCriterion } from "./promotion";
import { recordImportReview } from "./import-review";

const TOKEN_TTL_S = 21_600;
const COMMIT_RE = /^[0-9a-f]{40}$/;

/**
 * Typed view of the DO stub. Workers' generated `Rpc` types map `unknown`-typed DTO fields (e.g.
 * `Evaluation.observations`) to `never`; every RPC value here is plain JSON, so we type calls by the class.
 */
type Methods<T> = { [K in keyof T as T[K] extends (...a: never[]) => unknown ? K : never]: T[K] };
export type SystemApi = {
  [K in keyof Methods<SystemAuthority>]: SystemAuthority[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
};

export const systemStub = (env: Env, id: string) => env.SYSTEMS.getByName(id) as unknown as SystemApi;
export const registryStub = (env: Env) => systemStub(env, REGISTRY);

/** Run a DO RPC call, mapping `[code] message` errors to HTTP errors. */
async function rpc<T>(p: Promise<T> | T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw fromRpc(e) ?? e;
  }
}

async function headState(env: Env, systemId: string): Promise<HeadState> {
  const s = await systemStub(env, systemId).state();
  if (!s) throw notFound(`system ${systemId} is not imported`);
  return s;
}

/**
 * Recompute the System's summary, announce it on its SSE stream (`system.updated`) and copy it into the registry
 * (`GET /api/systems`). Called after every state change the Home page shows.
 */
export async function refreshRegistry(env: Env, systemId: string): Promise<SystemSummary | null> {
  const summary = await systemStub(env, systemId).publishSummary();
  if (summary) await registryStub(env).registerSystem(summary);
  return summary;
}

const BACKFILL_CONCURRENCY = 4;

/**
 * `GET /api/systems`. Registry rows written before the summary gained signifiers (B5) are recomputed once, here,
 * through {@link refreshRegistry}, a few at a time; a System whose refresh fails keeps its old row.
 */
export async function listSystems(env: Env): Promise<SystemSummary[]> {
  const rows = await registryStub(env).listSystems();
  const stale = rows.filter((s) => !Array.isArray(s.signifiers));
  if (!stale.length) return rows;
  const fresh = new Map<string, SystemSummary>();
  for (let i = 0; i < stale.length; i += BACKFILL_CONCURRENCY) {
    await Promise.all(stale.slice(i, i + BACKFILL_CONCURRENCY).map(async (s) => {
      try {
        const out = await refreshRegistry(env, s.systemId);
        if (out) fresh.set(s.systemId, out);
      } catch (e) {
        console.error(`[systems] backfilling the summary of ${s.systemId} failed: ${(e as Error)?.message ?? e}`);
      }
    }));
  }
  return rows.map((s) => fresh.get(s.systemId) ?? s);
}

/**
 * Admin `DELETE /api/systems/:id`: wipe the System's DO, then remove it from the registry (so `GET /api/systems` and
 * every `:id` route stop seeing it, and no later `refreshRegistry` can re-insert a row for a wiped object). The wipe is
 * best effort: when it fails the row still goes and the DO keeps its stale state, idle, reported as `stateCleared: false`
 * (retry the DELETE, or re-import with `force`). Artifacts repos, forks and push subscriptions are left alone.
 */
export async function deleteSystem(env: Env, systemId: string): Promise<DeleteSystemResponse> {
  const registry = registryStub(env);
  if (!(await registry.hasSystem(systemId))) throw notFound(`system ${systemId} is not imported`);
  let stateCleared = true;
  try {
    await systemStub(env, systemId).clearState();
  } catch (e) {
    stateCleared = false;
    console.error(`[systems] clearing the state of ${systemId} failed: ${(e as Error)?.message ?? e}`);
  }
  await registry.unregisterSystem(systemId);
  return { systemId, stateCleared };
}

// ------------------------------------------------------------------ genomes

/** One model-cache part is one SQLite row (2 MB cap); a part above this is refused like an oversized Genome. */
const CACHE_PART_MAX_BYTES = 1_900_000;

function cacheParts(genomeCommit: string, parts: Record<string, string>): Record<string, string> {
  for (const [part, text] of Object.entries(parts)) {
    const n = byteLength(text);
    if (n > CACHE_PART_MAX_BYTES) {
      throw unprocessable("genome-too-large", `the Genome at ${genomeCommit.slice(0, 12)} is too large to cache: its ${part} is ${n} bytes, the limit is ${CACHE_PART_MAX_BYTES} bytes (Genome YAML is limited to ${GENOME_MAX_BYTES} bytes)`);
    }
  }
  return parts;
}

/**
 * The Genome at `genomeCommit`, from (1) the per-isolate memo, (2) the DO's cached files, or (3) Artifacts
 * (`repo`), caching files + serialised model + rules readiness in the DO afterwards.
 */
export async function genomeAt(env: Env, systemId: string, genomeCommit: string, repo: string): Promise<LoadedGenome> {
  const stub = systemStub(env, systemId);
  const resolver=acceptedTemplateResolver(await stub.ontologyAcceptedPackages());
  const key = `${systemId}@${genomeCommit}@${resolver.digest}`;
  const cached = await stub.getModelCache(genomeCommit, "files");
  if (cached) return memoGenome(key, () => buildGenome(new Map(Object.entries(JSON.parse(cached) as Record<string, string>)), genomeCommit, resolver.templates));
  const files = await withRepo(artifactsFor(env), repo, (r) => readGenomeFiles(r, genomeCommit));
  let g: LoadedGenome;
  try {
    g = memoGenome(key, () => buildGenome(files, genomeCommit, resolver.templates));
  } catch (e) {
    // A Genome that does not load still caches its files: the hooks read a candidate's files from here and report the
    // load error (degraded review) instead of refusing the run. The next genomeAt rebuilds from them and throws again.
    await stub.putModelCache(genomeCommit, cacheParts(genomeCommit, { files: JSON.stringify(Object.fromEntries(files)) }));
    throw e;
  }
  await stub.putModelCache(genomeCommit, cacheParts(genomeCommit, {
    files: JSON.stringify(Object.fromEntries(files)),
    model: JSON.stringify(serializeModel(g.model)),
    rules: JSON.stringify(g.readiness),
  }));
  return g;
}

const canonicalGenome = (env: Env, s: HeadState) => genomeAt(env, s.systemId, s.genomeCommit, s.genomeSource);

function evolutionSeeds(m: SystemModel): EvolutionSeed[] {
  return m.evolutions.map((e) => ({
    id: e.id, title: e.title, intent: e.intent, state: e.state, kind: e.kind, affectedNodes: e.affectedNodes,
    affectedClaims: e.affectedClaims, genomeDelta: e.genomeDelta, acceptanceCriteria: e.acceptanceCriteria,
    requiredEvidence: e.requiredEvidence, dependsOn: e.dependsOn, risk: e.risk, ...(e.baseRevision && { baseRevision: e.baseRevision }),
  }));
}

function manifestExtras(m: SystemModel): ManifestExtras {
  const app = m.things.flatMap((t) => t.artifacts).find((a) => a.type === "worker-fullstack");
  return {
    artifactId: app?.artifact ?? "artifact.webapp",
    templateVersions: Object.fromEntries(m.templates.map((t) => [t.id, t.version])),
    hookVersions: Object.fromEntries(m.hooks.map((h) => [h.id, String(h.version)])),
  };
}

/**
 * The Thing whose worker-fullstack artifact the app repo builds (else the first Thing): its template gives the scaffold
 * commands, CI commands and template upgrades. The source map does not use it; it covers every node (`sourceMapFor`).
 */
export function appThing(m: SystemModel): schema.ResolvedThing | undefined {
  return m.things.find((t) => t.artifacts.some((a) => a.type === "worker-fullstack")) ?? m.things[0];
}

/**
 * The Thing an app packet works in: the one Thing at or above every affected node (nodes outside every Thing do not
 * count), else `appThing`. A scope spanning two Things is refused (422 `scope-spans-things`): one packet, one Thing.
 */
export function packetThing(m: SystemModel, affected: string[]): schema.ResolvedThing | undefined {
  const owners = new Set(affected.flatMap((id) => {
    const thing = m.index.path(id).reverse().find((x) => m.index.byId[x]?.type === "thing");
    return thing ? [thing] : [];
  }));
  if (owners.size > 1) throw unprocessable("scope-spans-things", `the affected nodes belong to several Things (${[...owners].sort().join(", ")}); split the Evolution per Thing`);
  const [only] = owners;
  return only ? m.things.find((t) => t.id === only) : appThing(m);
}

/** The packet's commands: the scaffold commands of the Thing it works in (`packetThing`). */
function scaffoldCommands(m: SystemModel, target: "app" | "genome", affected: string[]): string[] {
  if (target === "genome") return ["npm install", "npm test"];
  const ref = packetThing(m, affected)?.templateRef;
  const text = ref ? templateFile(ref, "scaffold.yaml") : undefined;
  const cmds = (text ? (parseYaml(text) as { commands?: Record<string, string> })?.commands : undefined) ?? {};
  const list = Object.values(cmds).filter((c): c is string => typeof c === "string");
  return list.length ? list : ["npm install", "npm run dev", "npm test"];
}

// ------------------------------------------------------------------ import

function scaffoldSource(v: unknown): ScaffoldSource | undefined {
  if (v === undefined || v === null) return undefined;
  const o = v as Partial<ScaffoldSource>;
  if (typeof o !== "object" || !isName(o.repo) || typeof o.commit !== "string" || !COMMIT_RE.test(o.commit)
    || (o.path !== undefined && (typeof o.path !== "string" || o.path.split("/").includes("..")))) {
    throw badRequest("scaffoldFrom must be {repo, commit (40 hex), path?}");
  }
  return { repo: o.repo, commit: o.commit, ...(o.path && { path: o.path }) };
}

/**
 * `platform`'s head and pin warnings for the canonical Genome. Never fails the import: when `platform` or the canonical
 * Genome cannot be read, the recorded provenance is kept and a `platform.unreadable` warning says why.
 */
async function platformCheck(
  env: Env, ns: ReturnType<typeof artifactsFor>, systemId: string, imported: SystemModel,
  canonical: { commit: string; repo: string } | null, recorded: PlatformRef | null,
): Promise<{ platform: PlatformRef | null; warnings: Finding[] }> {
  try {
    const model = canonical ? (await genomeAt(env, systemId, canonical.commit, canonical.repo)).model : imported;
    return await readPlatform(ns, systemId, model);
  } catch (e) {
    return { platform: recorded, warnings: [unreadableWarning(systemId, e)] };
  }
}

/** `genomeRepo`/`appRepo` are optional: omitted ones default to `<slug>.genome` / `<slug>.app`. */
export async function importSystem(env: Env, body: { systemId?: unknown; genomeRepo?: unknown; appRepo?: unknown; scaffoldFrom?: unknown; force?: unknown; review?: unknown; integrityRunId?: unknown; integrityUnreviewedReason?: unknown }): Promise<ImportSystemResponse> {
  const { systemId } = body;
  if (typeof systemId !== "string" || !systemId) throw badRequest("systemId is a required string");
  if (systemId === REGISTRY) throw badRequest("reserved system id");
  let derived: ReturnType<typeof systemRepoNames>;
  try {
    derived = systemRepoNames(systemId);
  } catch (e) {
    throw new HttpError(400, "invalid-system-id", (e as Error).message);
  }
  const repoName = (v: unknown, name: string): string | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (!isName(v)) throw badRequest(`${name} must be a repo name`);
    return v;
  };
  const givenApp = repoName(body.appRepo, "appRepo");
  const genomeRepo = repoName(body.genomeRepo, "genomeRepo") ?? derived.genomeRepo;
  const scaffoldFrom = scaffoldSource(body.scaffoldFrom);
  const ns = artifactsFor(env);
  const headOf = async (name: string) => {
    const [c] = await withRepo(ns, name, (r) => r.log({ limit: 1 })).catch((e: unknown) => {
      if (artifactsErrorCode(e) === "NOT_FOUND") throw unprocessable("repo-not-found", `repo ${name} not found in namespace ${env.ARTIFACTS_NAMESPACE}; push it first ('npx artyfact init')`);
      throw e;
    });
    if (!c) throw unprocessable("empty-repo", `repo ${name} has no commits`);
    return c.hash;
  };
  const genomeCommit = await headOf(genomeRepo);
  const [files, sourceFiles] = await withRepo(ns, genomeRepo, async (r) =>
    Promise.all([readGenomeFiles(r, genomeCommit), readGenomeSourceFiles(r, genomeCommit)]));
  const resolver=acceptedTemplateResolver(await systemStub(env,systemId).ontologyAcceptedPackages());
  const g = memoGenome(`${systemId}@${genomeCommit}@${resolver.digest}`, () => buildGenome(files, genomeCommit, resolver.templates));
  if (g.model.system.id !== systemId) {
    throw unprocessable("system-mismatch", `Genome in ${genomeRepo} declares ${g.model.system.id}, not ${systemId}`);
  }
  // With several worker-fullstack artifacts the app repo is named after the bound (first) one.
  const appArtifacts = g.model.things.flatMap((t) => t.artifacts).filter((a) => a.type === "worker-fullstack").map((a) => a.artifact);
  const appRepo = givenApp ?? systemRepoNames(systemId, appArtifacts).appRepo;
  const appCommit = appArtifacts.length ? await headOf(appRepo) : null;
  const bindingWarnings:Finding[]=[];
  const artifactBindings:Record<string,import('../shared/api').ArtifactBinding>={};
  for(const binding of g.model.things.flatMap(t=>t.artifacts)) {
    const repo=binding.artifact===appArtifacts[0]?appRepo:binding.repo;
    if(!repo)continue;
    if(!isName(repo))throw unprocessable('invalid-binding',`artifact ${binding.artifact} names an invalid source repository`);
    const commit=binding.artifact===appArtifacts[0]&&repo===appRepo&&appCommit?appCommit:await headOf(repo).catch(e=>{if(e instanceof HttpError&&e.code==='repo-not-found')return null;throw e;});
    if(!commit){bindingWarnings.push({level:'warning',rule:'binding.unbound',subject:binding.artifact,message:`Source binding ${binding.artifact} is unbound: repository ${repo} has not been imported. Push its source before planning implementation.`,facts:[],derivation:{relation:'binding.unbound',tuple:[binding.artifact],edb:true,children:[]}});continue;}
    artifactBindings[binding.artifact]={repo,commit,...(binding.artifact===appArtifacts[0]&&scaffoldFrom&&{scaffoldFrom})};
  }

  const stub = systemStub(env, systemId);
  if (body.integrityRunId !== undefined && (typeof body.integrityRunId !== "string" || !body.integrityRunId.startsWith("integrity."))) {
    throw badRequest("integrityRunId must be an integrity run id");
  }
  if (body.integrityUnreviewedReason !== undefined && (typeof body.integrityUnreviewedReason !== "string"
    || !body.integrityUnreviewedReason.trim() || body.integrityUnreviewedReason.length > 500)) {
    throw badRequest("integrityUnreviewedReason must be a nonblank string of at most 500 characters");
  }
  if (body.integrityRunId !== undefined && body.integrityUnreviewedReason !== undefined) {
    throw badRequest("integrityRunId and integrityUnreviewedReason are mutually exclusive");
  }
  const intentAuthored = sourceFiles.has("intent/brief.md") || sourceFiles.has("intent/manifest.json");
  const unreviewedReason = typeof body.integrityUnreviewedReason === "string" ? body.integrityUnreviewedReason.trim() : undefined;
  if (intentAuthored && body.integrityRunId === undefined && unreviewedReason === undefined) {
    throw unprocessable("integrity-required", "an intent-authored initial import needs an eligible integrity agreement or an explicit unreviewed reason");
  }
  if (!intentAuthored && unreviewedReason !== undefined) throw badRequest("integrityUnreviewedReason is only valid for an intent-authored import");
  const integrity = typeof body.integrityRunId === "string"
    ? await stub.integrityBinding(body.integrityRunId,
      (await stub.integrityPreview(systemId, Object.fromEntries(sourceFiles), "imported")).hash)
    : undefined;
  // Pins are checked against the Genome that will be canonical after this import, before the DO applies it: an import
  // of exactly the last-imported commits keeps the current head (after an accepted amendment, not the imported Genome).
  const [base, prior] = await Promise.all([stub.importBase(), stub.state()]);
  const keepsHead = !!base && !!prior && base.genomeRepo === genomeRepo && base.genomeCommit === genomeCommit && base.appRepo === appRepo && base.appCommit === appCommit;
  const canonical = keepsHead && prior.genomeCommit !== genomeCommit ? { commit: prior.genomeCommit, repo: prior.genomeSource } : null;
  const { platform, warnings } = await platformCheck(env, ns, systemId, g.model, canonical, prior?.platform ?? null);
  warnings.push(...bindingWarnings);
  const booted = await rpc(stub.bootstrap({
    systemId, title: g.model.system.name, phase: g.model.system.phase, genomeRepo, appRepo, genomeCommit, appCommit,
    evolutions: evolutionSeeds(g.model), ...manifestExtras(g.model), artifactBindings, platform, ...(scaffoldFrom && { scaffoldFrom }), force: body.force === true,
  }));
  if ("alreadyImported" in booted) throw conflict("already-imported", booted.alreadyImported);
  await stub.putModelCache(genomeCommit, cacheParts(genomeCommit, {
    files: JSON.stringify(Object.fromEntries(files)),
    model: JSON.stringify(serializeModel(g.model)),
    rules: JSON.stringify(g.readiness),
  }));
  if (intentAuthored || integrity) {
    const snapshot = await stub.integrityPreview(systemId, Object.fromEntries(sourceFiles), "imported");
    await stub.integrityLinkSource(genomeCommit, snapshot.id);
  }
  // B.10: a new System commit is a new import to review unless `review: false` (worker/import-review.ts).
  await recordImportReview(env, systemId, {
    review: body.review, head: booted.head, priorHead: prior?.head, genome: g, genomeCommit, integrity,
    ...(unreviewedReason && { integrityUnreviewed: { reason: unreviewedReason, at: new Date().toISOString() } }),
  });
  // Re-read the summary now that the rules readiness is cached (B5: readiness counts and signifiers).
  const system = (await systemStub(env, systemId).summary()) ?? booted;
  await registryStub(env).registerSystem(system);
  return { system, integrity: await stub.integrityCurrent(genomeCommit), head: system.head!, genomeRepo, appRepo, genomeCommit, appCommit, evolutions: g.model.evolutions.map((e) => e.id), platform, warnings };
}

// ------------------------------------------------------------------ model + readiness

interface ResolvedRevision { revision: string; genomeCommit: string; repo: string; candidateIds: string[] }

/**
 * Evidence scope of a revision: a System commit (or the head) counts the candidates promoted into it and its ancestors,
 * as the UI's `promotedCandidates` does; a candidate counts itself. A 40-hex `rev` must be a commit this System
 * recorded (a candidate's, or a Genome commit in History); any other is 404 and never read from Artifacts.
 */
async function resolveRevision(env: Env, s: HeadState, rev: string | undefined): Promise<ResolvedRevision> {
  const stub = systemStub(env, s.systemId);
  if (!rev || rev === "canonical" || rev === "head" || rev === s.head) {
    return { revision: rev ?? "canonical", genomeCommit: s.genomeCommit, repo: s.genomeSource, candidateIds: s.head ? await stub.promotedCandidates(s.head) : [] };
  }
  if (rev.startsWith("sc-")) {
    const c = await stub.systemCommit(rev);
    if (!c) throw notFound(`unknown System commit ${rev}`);
    return { revision: rev, genomeCommit: c.genomeCommit, repo: s.genomeSource, candidateIds: await stub.promotedCandidates(rev) };
  }
  const candidateRevision = async (id: string, revision: string): Promise<ResolvedRevision> => {
    const c = await stub.candidate(id);
    if (!c) throw notFound(`unknown candidate ${id}`);
    const rec = await stub.realization(c.realization);
    if (rec?.target === "genome") return { revision, genomeCommit: c.commit, repo: rec.forkRepo, candidateIds: [id] };
    return { revision, genomeCommit: s.genomeCommit, repo: s.genomeSource, candidateIds: [id] };
  };
  if (rev.startsWith("candidate.")) return candidateRevision(rev, rev);
  if (COMMIT_RE.test(rev)) {
    const known = await stub.revisionOfCommit(rev);
    if (!known) throw notFound(`commit ${rev} is not recorded in ${s.systemId} (History or candidates)`);
    if ("candidate" in known) return candidateRevision(known.candidate, rev);
    return { revision: rev, genomeCommit: rev, repo: s.genomeSource, candidateIds: [] };
  }
  throw badRequest(`unknown revision ${rev}`);
}

async function evaluationsFor(env: Env, systemId: string, candidateIds: string[]) {
  const stub = systemStub(env, systemId);
  return (await Promise.all(candidateIds.map((id) => stub.evaluations(id)))).flat();
}

/**
 * Serialised model + full rules Readiness at a Genome commit, straight from the DO cache when present (no
 * loadGenome/validate on a cold isolate); on a miss, built once and written through.
 */
async function genomeView(env: Env, systemId: string, genomeCommit: string, repo: string): Promise<{ model: SerializedModel; readiness: Readiness }> {
  const stub = systemStub(env, systemId);
  const [model, rules] = await Promise.all([stub.getModelCache(genomeCommit, "model"), stub.getModelCache(genomeCommit, "rules")]);
  if (model && rules) return { model: JSON.parse(model) as SerializedModel, readiness: JSON.parse(rules) as Readiness };
  const g = await genomeAt(env, systemId, genomeCommit, repo);
  const view = { model: serializeModel(g.model), readiness: g.readiness };
  await stub.putModelCache(genomeCommit, cacheParts(genomeCommit, { model: JSON.stringify(view.model), rules: JSON.stringify(view.readiness) }));
  return view;
}

/** `platform.unsynced` is a readiness warning (never a blocker) while the System has no recorded `platform` commit. */
export function withPlatform<R extends { findings: Finding[]; modelReadiness: { findings: Finding[]; blockers: Finding[] } }>(s: HeadState, r: R): R {
  if (s.platform) return r;
  const w = unsyncedWarning(s.systemId);
  return { ...r, findings: [...r.findings, w], modelReadiness: { ...r.modelReadiness, findings: [...r.modelReadiness.findings, w] } };
}

export async function modelBundle(env: Env, systemId: string, rev?: string): Promise<ModelBundle> {
  const s = await headState(env, systemId);
  const r = await resolveRevision(env, s, rev);
  const [v, evals] = await Promise.all([genomeView(env, systemId, r.genomeCommit, r.repo), evaluationsFor(env, systemId, r.candidateIds)]);
  return { systemId, revision: r.revision, genomeCommit: r.genomeCommit, model: v.model, readiness: { ...withPlatform(s, readinessReport(v.model, v.readiness, evals)), integrity: await systemStub(env, systemId).integrityCurrent(r.genomeCommit) } };
}

export async function readiness(env: Env, systemId: string, rev?: string): Promise<ReadinessResponse> {
  const s = await headState(env, systemId);
  const r = await resolveRevision(env, s, rev);
  const [v, evals] = await Promise.all([genomeView(env, systemId, r.genomeCommit, r.repo), evaluationsFor(env, systemId, r.candidateIds)]);
  return { ...withPlatform(s, readinessReport(v.model, v.readiness, evals)), integrity: await systemStub(env, systemId).integrityCurrent(r.genomeCommit), systemId, revision: r.revision, genomeCommit: r.genomeCommit };
}

// ------------------------------------------------------------------ start work

function modelEvolution(m: SystemModel, dto: Evolution): schema.Evolution {
  return m.evolutions.find((e) => e.id === dto.id) ?? ({ ...dto } as unknown as schema.Evolution);
}

async function concurrentWork(env: Env, systemId: string, evolutionId: string, exclude: string) {
  const stub = systemStub(env, systemId);
  const reals = (await stub.realizations(evolutionId)).filter((r) => r.id !== exclude && !["promoted", "rejected", "abandoned"].includes(r.status));
  const cands = await stub.candidates({ evolutionId });
  return reals.map((r) => ({
    realization: r.id,
    agentLabel: r.agent.id,
    status: r.status,
    changedSubjects: cands.find((c) => c.realization === r.id)?.changedSubjects ?? [],
  }));
}

/**
 * `opts.expectedBase`: refuse with 409 `stale-base` unless the realization would fork from this commit.
 * `opts.permittedExtra`: Genome-relative globs added to the packet's permitted paths (under the Genome prefix), for
 * nodes the realization will create and the base model cannot know.
 */
export async function startWork(
  env: Env, systemId: string, evolutionId: string, body: StartWorkRequest, platformUrl: string, opts: { expectedBase?: string; permittedExtra?: string[] } = {},
): Promise<StartWorkResponse> {
  if (body.target !== undefined && body.target !== "app" && body.target !== "genome") throw badRequest("target must be app or genome");
  if (body.origin !== undefined && body.origin !== "cli" && body.origin !== "editor") throw badRequest("origin must be cli or editor");
  const stub = systemStub(env, systemId);
  const s = await headState(env, systemId);
  const evoDto = await stub.evolution(evolutionId);
  if (!evoDto) throw notFound(`unknown evolution ${evolutionId}`);
  const g = await canonicalGenome(env, s);
  const evolution = modelEvolution(g.model, evoDto);
  const target = body.target ?? (evolution.kind === "genome-amendment" ? "genome" : "app");
  const commands = scaffoldCommands(g.model, target, evolution.affectedNodes);

  await skipTakenForkNames(env, stub, target);
  const reserved = await rpc(stub.reserveRealization({ evolutionId, target, agentLabel: body.agentLabel, role: body.role, origin: body.origin, ...(opts.expectedBase && { expectedBase: opts.expectedBase }) }));
  const rid = reserved.realization.id;
  let tokenId: string | undefined;
  try {
    await registryStub(env).registerRealization(rid, systemId, evolutionId, reserved.forkRepo);
    const ns = artifactsFor(env);
    const forked = await forkAndWait(ns, reserved.baseRepo, reserved.forkRepo, { baseCommit: reserved.baseCommit });
    const token = await withRepo(ns, reserved.forkRepo, (r) => r.createToken("write", TOKEN_TTL_S));
    tokenId = token.id;
    const remote = remoteUrl(env, reserved.forkRepo, forked.remote);
    const { tree, prefix } = await withRepo(ns, reserved.baseRepo, async (r) => ({
      tree: target === "app" ? [...(await listTree(r, reserved.baseCommit)).keys()] : [],
      prefix: target === "genome" ? await genomePrefix(r, reserved.baseCommit) : "",
    }));
    const packet = await buildTaskPacket({
      systemId, realizationId: rid, target, model: g.model, evolution,
      workspace: { repo: reserved.baseRepo, fork: reserved.forkRepo, baseCommit: reserved.baseCommit, remote },
      baseTreePaths: tree, commands,
      concurrentWork: await concurrentWork(env, systemId, evolutionId, rid), platformUrl, genomePrefix: prefix,
      ...(target === "genome" && opts.permittedExtra?.length && { permittedExtra: opts.permittedExtra.map((g) => (prefix ? `${prefix.replace(/\/+$/, "")}/${g}` : g)) }),
    });
    // The realization secret authorizes the agent's platform calls; only its SHA-256 is stored.
    const secret = newRealizationSecret();
    const activated = await stub.activateRealization(rid, { tokenId: token.id, tokenExpires: token.expiresAt, remote, packet, secretHash: await sha256Hex(secret) });
    if ("refused" in activated) {
      // Rejected (or otherwise ended) while the fork was being made: the fresh token must not outlive it.
      await withRepo(ns, reserved.forkRepo, (r) => r.revokeToken(token.id)).catch((e: unknown) =>
        console.error(`[startWork] revoking the token of ended ${rid} failed: ${(e as Error)?.message ?? e}`));
      tokenId = undefined;
      throw conflict("invalid-state", `realization ${rid} is ${activated.refused ?? "gone"}; it was not activated and its token was revoked`);
    }
    const realization = activated;
    // B3: the fork's push subscription feeds the queue safety net (best effort; a no-op without CF_API_TOKEN).
    const subscription = await ensurePushSubscription(env, reserved.forkRepo);
    if (subscription) await stub.setRealizationSubscription(rid, subscription);
    await refreshRegistry(env, systemId);
    const cli = packet.startCommand.replace("<token>", token.plaintext).replace("<secret>", secret);
    return {
      systemId, realization, packet: { ...packet, workspace: { ...packet.workspace, secret } },
      token: { value: token.plaintext, expiresAt: token.expiresAt, remote }, secret, remote, startCommand: cli, cli,
    };
  } catch (e) {
    // Best-effort cleanup; never let it mask the original error. Never log the token itself. A realization that ended
    // meanwhile (rejected during the fork) keeps its status and its registry entry.
    const ended = TERMINAL_REALIZATION.includes((await stub.realization(rid).catch(() => null))?.realization.status ?? "claimed");
    const cleanup: Promise<unknown>[] = ended ? [] : [
      stub.abandonRealization(rid),
      registryStub(env).unregisterRealization(systemId, rid),
    ];
    if (tokenId) cleanup.push(withRepo(artifactsFor(env), reserved.forkRepo, (r) => r.revokeToken(tokenId!)));
    for (const r of await Promise.allSettled(cleanup)) {
      if (r.status === "rejected") console.error(`[startWork] cleanup for ${rid} failed: ${(r.reason as Error)?.message ?? r.reason}`);
    }
    throw e;
  }
}

/**
 * Fork names are `<repo>--r<N>` with N System-wide. A fresh platform state on a namespace that already holds forks from
 * an earlier one would collide; skip the numbers whose fork repo exists instead of failing (nothing is deleted).
 * Best effort: a race past this check still ends in forkAndWait's 409 `fork-exists`.
 */
async function skipTakenForkNames(env: Env, stub: SystemApi, target: "app" | "genome"): Promise<void> {
  const ns = artifactsFor(env);
  for (let i = 0; i < 100; i++) {
    const next = await stub.nextForkName(target);
    if (!next) return;
    const taken = await withRepo(ns, next.forkRepo, (r) => r.info()).then(() => true, (e: unknown) => {
      const code = artifactsErrorCode(e);
      if (code === "NOT_FOUND") return false;
      if (code === "FORK_IN_PROGRESS" || code === "CREATE_IN_PROGRESS") return true;
      throw e;
    });
    if (!taken) return;
    await stub.skipRealizationNumber(next.n);
  }
}

async function record(env: Env, systemId: string, rid: string): Promise<RealizationRecord> {
  if(await systemStub(env,systemId).realizationPlanId(rid))throw conflict('invalid-state','Task Attempts must use the scoped lifecycle endpoints with fenced generation');
  const rec = await systemStub(env, systemId).realization(rid);
  if (!rec) throw notFound(`unknown realization ${rid}`);
  return rec;
}

export async function packet(env: Env, systemId: string, rid: string): Promise<PacketResponse> {
  const rec = await record(env, systemId, rid);
  if (!rec.packet) throw conflict("not-ready", `realization ${rid} has no packet (status ${rec.realization.status})`);
  return { systemId, realization: rec.realization, packet: rec.packet, remote: rec.packet.workspace.remote };
}

export async function realizationView(env: Env, systemId: string, rid: string): Promise<RealizationResponse> {
  const stub = systemStub(env, systemId);
  const rec = await record(env, systemId, rid);
  const stored0 = rec.realization.candidate ? await stub.candidate(rec.realization.candidate) : null;
  const candidate = stored0 ? (await withBuilds(stub, [stored0]))[0] : null;
  const evaluations = candidate ? await stub.evaluations(candidate.id) : [];
  const stored = candidate ? await stub.storedConflicts(candidate.id) : null;
  return {
    ...rec.realization, systemId, realization: rec.realization, ...(candidate && { candidateDetail: candidate }), evaluations,
    conflicts: stored?.conflicts ?? [], conflictsComputedAt: stored?.computedAt ?? null,
    ...(stored?.errors.length && { conflictsError: stored.errors.map((e) => e.error).join("; ") }),
  };
}

export async function checkpoint(env: Env, systemId: string, rid: string, body: { summary?: unknown; message?: unknown; commit?: unknown }) {
  const summary = typeof body.summary === "string" ? body.summary : typeof body.message === "string" ? body.message : "";
  if (!summary.trim()) throw badRequest("summary (or message) is required");
  if (body.commit !== undefined && body.commit !== null && (typeof body.commit !== "string" || !COMMIT_RE.test(body.commit))) {
    throw badRequest("commit must be a 40-character hex sha");
  }
  const out = await rpc(systemStub(env, systemId).checkpoint(rid, { summary: summary.slice(0, 4000), ...(typeof body.commit === "string" && { commit: body.commit }) }));
  await refreshRegistry(env, systemId);
  return out;
}

// ------------------------------------------------------------------ submit

/** A candidate as stored: DO row + the manifest recorded at submission. */
interface StoredCandidate extends CandidateManifest {
  id: string;
  state: string;
  pathNodes?: Record<string, string[]>;
  manifestHash?: string;
}

async function storedCandidates(env: Env, systemId: string, filter: { open?: boolean; evolutionId?: string } = { open: true }): Promise<StoredCandidate[]> {
  const stub = systemStub(env, systemId);
  const cands = await stub.candidates(filter);
  return Promise.all(cands.map(async (c) => {
    const m = ((await stub.candidateManifest(c.id)) ?? {}) as Partial<StoredCandidate>;
    return {
      realizationId: c.realization, evolutionId: c.evolution, target: m.target ?? "app", repo: m.repo ?? "", baseRepo: m.baseRepo ?? "",
      baseCommit: m.baseCommit ?? "", commit: c.commit, changedPaths: c.changedPaths, changedNodes: c.changedSubjects,
      diff: m.diff ?? { added: [], modified: [], removed: [] }, ...(m.previewUrl && { previewUrl: m.previewUrl }),
      ...(Array.isArray(m.screenshots) && m.screenshots.length && { screenshots: m.screenshots }),
      ...(m.pathNodes && { pathNodes: m.pathNodes }), ...(m.manifestHash && { manifestHash: m.manifestHash }), id: c.id, state: c.state,
    };
  }));
}

/** Stored candidate → the hooks' CandidateRef (Genome candidates carry their file map from the DO cache). */
async function hookRef(env: Env, systemId: string, c: StoredCandidate): Promise<CandidateRef> {
  const stub = systemStub(env, systemId);
  const genomeFiles = c.target === "genome" ? await stub.getModelCache(c.commit, "files") : null;
  const previewBuilds = c.previewUrl ? (await stub.builds({ realization: c.realizationId, commit: c.commit, kind: "preview" }))
    .filter((b) => b.status === "passed" && b.url === c.previewUrl && b.buildId && (b.candidate === c.id || b.candidate === null)) : [];
  // A first passed report creates its candidate inside submit; its trusted build is linked just after hooks run.
  const passedBuild = previewBuilds.find((b) => b.candidate === c.id) ?? previewBuilds.find((b) => b.candidate === null);
  return {
    id: c.id, realizationId: c.realizationId, evolutionId: c.evolutionId, target: c.target, commit: c.commit, baseCommit: c.baseCommit,
    changedPaths: c.changedPaths, changedNodes: c.changedNodes, ...(c.pathNodes && { pathNodes: c.pathNodes }),
    ...(c.previewUrl && { previewUrl: c.previewUrl }), ...(c.screenshots?.length && { screenshots: c.screenshots }), ...(passedBuild?.buildId && { expectedBuildId: passedBuild.buildId }), ...(genomeFiles && { genomeFiles: JSON.parse(genomeFiles) as FileMap }),
  };
}

async function canonicalFiles(env: Env, s: HeadState): Promise<FileMap> {
  return Object.fromEntries((await canonicalGenome(env, s)).files);
}

/**
 * Run the hooks' conflict check for one candidate against the other open candidates and store the result in the
 * DO (submit and promote only; reads serve stored results). A failing run is stored as an error, never hidden.
 */
async function computeConflicts(env: Env, systemId: string, candidateId: string): Promise<ConflictReport[]> {
  const stub = systemStub(env, systemId);
  const s = await headState(env, systemId);
  const open = await Promise.all((await storedCandidates(env, systemId)).map((c) => hookRef(env, systemId, c)));
  const candidate = open.find((c) => c.id === candidateId);
  if (!candidate) return [];
  try {
    const reports = await hookRunner(env,acceptedTemplateResolver(await stub.ontologyAcceptedPackages()).templates).conflicts({
      // A realization's earlier commits are superseded by its latest submit, never in conflict with it.
      systemId, candidate, genomeCommit: s.genomeCommit, genomeFiles: await canonicalFiles(env, s), openCandidates: open.filter((c) => c.realizationId !== candidate.realizationId),
    });
    await stub.storeConflicts(candidateId, reports, null);
    return reports;
  } catch (e) {
    const error = (e as Error)?.message ?? String(e);
    console.error(`[conflicts] ${candidateId}: ${error}`);
    await stub.storeConflicts(candidateId, [], error);
    return [];
  }
}

export async function conflicts(env: Env, systemId: string): Promise<ConflictsResponse> {
  return systemStub(env, systemId).storedConflicts();
}

/** Run hooks for a recorded candidate; returns evaluations in wire form and the realization status to set. */
/** `promoting` is the full candidate set of the promotion (its composed manifest must bind exactly their commits). */
async function evaluate(env: Env, s: HeadState, rec: RealizationRecord, cand: StoredCandidate, trigger: "submission" | "promotion", promoting: string[] = [cand.id]) {
  const stub = systemStub(env, s.systemId);
  const [genomeFiles, candidate, others, evo] = await Promise.all([
    canonicalFiles(env, s),
    hookRef(env, s.systemId, cand),
    storedCandidates(env, s.systemId).then((xs) => Promise.all(xs.filter((c) => c.realizationId !== cand.realizationId).map((c) => hookRef(env, s.systemId, c)))),
    stub.evolution(rec.evolutionId),
  ]);
  const required = requiredFiles((await canonicalGenome(env, s)).model);
  const { tree, exists, recomputedHash } = await withRepo(artifactsFor(env), rec.forkRepo, async (repo) => {
    const exists = !!(await repo.readCommit(cand.commit));
    const listing = exists ? await listTree(repo, cand.commit) : new Map<string, { hash: string }>();
    const tree = await treeWithSizes(stub, repo, listing, required);
    const recomputedHash = trigger === "promotion" && exists
      ? await manifestHash(await buildCandidateManifest(repo, { realizationId: cand.realizationId, evolutionId: cand.evolutionId, target: cand.target, repo: cand.repo, baseRepo: cand.baseRepo, baseCommit: cand.baseCommit, commit: cand.commit }, []))
      : undefined;
    return { tree, exists, recomputedHash };
  });
  let promotionFacts: SubmissionContext["promotionFacts"];
  if (trigger === "promotion") {
    const submittedAt = (await stub.candidate(cand.id))?.submittedAt ?? "";
    const g = await canonicalGenome(env, s);
    const composed = await stub.composedManifestExact(promoting, manifestExtras(g.model).artifactId);
    let fresh = false;
    try {
      fresh = exists && !!evo && evidenceFresh(g.model, evo, candidate, await stub.evaluations(cand.id), submittedAt, s.genomeCommit);
    } catch (e) {
      console.error(`[promote] evidence-fresh for ${cand.id} could not be established: ${(e as Error)?.message}`); // fail closed
    }
    promotionFacts = {
      currentBaseCommit: rec.target === "genome" ? s.genomeCommit : s.appSource?.commit ?? "",
      // The composed manifest binds exactly the promoted commits, and this candidate's commit still hashes to what was submitted.
      manifestExact: composed.exact && !!cand.manifestHash && cand.manifestHash === recomputedHash,
      evidenceFresh: fresh,
    };
  }
  const ctx: SubmissionContext = {
    systemId: s.systemId, candidate, genomeCommit: s.genomeCommit, genomeFiles, tree,
    permittedPaths: rec.packet?.permittedPaths ?? [], protectedPaths: rec.packet?.protectedPaths ?? protectedPathsFor(rec.target),
    openCandidates: others, ...(promotionFacts && { promotionFacts }), trigger,
    // API-created Evolutions exist only in the DO: hook selection falls back to this record when the Genome lacks it.
    ...(evo && { evolution: { id: evo.id, kind: evo.kind, acceptanceCriteria: evo.acceptanceCriteria, affectedNodes: evo.affectedNodes, state: evo.state } }),
  };
  const runner = hookRunner(env,acceptedTemplateResolver(await stub.ontologyAcceptedPackages()).templates);
  if (rec.target === "genome") {
    const r = await runner.runGenome(ctx);
    const base = await genomeAt(env, s.systemId, rec.baseCommit, rec.forkRepo);
    let loadError: string | undefined;
    const candG = await genomeAt(env, s.systemId, cand.commit, rec.forkRepo).catch((e: unknown) => {
      loadError = (e as Error)?.message ?? String(e);
      return null;
    });
    const review = buildGenomeReview({
      candidate: cand.id, base: base.model, cand: candG?.model ?? null, loadError, delta: candG ? diffModels(base.model, candG.model) : null,
      readinessBase: base.readiness, run: r,
    });
    return { evaluations: r.evaluations, status: "awaiting-admin" as const, review };
  }
  return { evaluations: await runner.runSubmission(ctx), status: "evaluated" as const };
}

/** Paths every `manifest` hook requires (`inputs.requiredFiles`), normalised. */
function requiredFiles(m: SystemModel): Set<string> {
  const norm = (p: string) => p.trim().replace(/^\.?\//, "");
  return new Set(m.hooks.filter((h) => h.engine === "manifest").flatMap((h) => (h.inputs.requiredFiles ?? "").split(",").map(norm)).filter(Boolean));
}

/**
 * Candidate tree for the hooks. Sizes come from the DO's blob-size cache; only `required` files that are not
 * cached are read (and cached). Any other blob whose size is not cached yet is reported with `size: -1`
 * ("not measured"): only the manifest engine reads sizes, and only for required files.
 */
async function treeWithSizes(stub: SystemApi, repo: ArtifactsRepoLike, listing: Map<string, { hash: string }>, required: Set<string>) {
  const known = await stub.blobSizes([...new Set([...listing.values()].map((e) => e.hash))]);
  const measured: Record<string, number> = {};
  await Promise.all([...listing].filter(([p, e]) => required.has(p) && known[e.hash] === undefined).map(async ([, e]) => {
    const blob = await repo.readBlob(e.hash);
    if (blob) measured[e.hash] = blob.size;
  }));
  if (Object.keys(measured).length) await stub.putBlobSizes(measured);
  return [...listing].map(([path, e]) => ({ path, size: known[e.hash] ?? measured[e.hash] ?? -1 }));
}

type Run = Awaited<ReturnType<typeof evaluate>>;

async function recordRun(env: Env, systemId: string, candidateId: string, run: Run, replace = false): Promise<void> {
  const stub = systemStub(env, systemId);
  // A replacing run stores its review only once the DO accepted the evaluations (the candidate is still open).
  if (run.review && !replace) await stub.putReview(candidateId, JSON.stringify(run.review));
  await rpc(stub.recordEvaluations(candidateId, run.evaluations, run.status, replace));
  if (run.review && replace) await stub.putReview(candidateId, JSON.stringify(run.review));
}

/**
 * Whether an evaluation's `targetRef` is evidence about this candidate: its bare commit, `<target>@<commit>`, the
 * canonical Genome it ran on (`genome@<genomeCommit>`, model-rules hooks) or the candidate's preview URL (http hooks).
 */
export function evidenceBinds(ref: string, candidate: Pick<CandidateRef, "commit" | "previewUrl">, genomeCommit: string): boolean {
  return ref === candidate.commit || ref.endsWith(`@${candidate.commit}`) || ref === `genome@${genomeCommit}` || (!!candidate.previewUrl && ref === candidate.previewUrl);
}

/**
 * `evidence-fresh`: every blocking criterion's latest evaluation was produced for this candidate's commit (its
 * `targetRef` binds the commit, the canonical Genome it ran on, or the candidate's preview) at or after submission.
 * Criteria whose hooks consume promotionFacts themselves (inputs.check) are excluded: they are re-run with the facts.
 */
export function evidenceFresh(
  m: SystemModel, evolution: Pick<schema.Evolution, "acceptanceCriteria">, candidate: CandidateRef, evals: Evaluation[], submittedAt: string, genomeCommit: string,
): boolean {
  const byId = new Map(m.criteria.map((c) => [c.id, c] as const));
  const consumesFacts = (id: string) => {
    const c = byId.get(id);
    return !!c && hooksOf(m, c).some((h) => /base-current|manifest-exact|evidence-fresh/.test(h.inputs.check ?? ""));
  };
  const binds = (ref: string) => evidenceBinds(ref, candidate, genomeCommit);
  const at = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";
  for (const g of gateCriteria(m, evolution, candidate)) {
    if (!g.blocking || consumesFacts(g.id)) continue;
    const latest = evals.filter((e) => e.criterion === g.id).sort((a, b) => at(b).localeCompare(at(a)))[0];
    if (!latest || latest.candidate !== candidate.id || !binds(latest.targetRef) || !latest.finishedAt || latest.finishedAt < submittedAt) return false;
  }
  return true;
}

/** B3: each candidate with the latest build of its commit (`Candidate.build`). */
async function withBuilds<C extends Candidate>(stub: SystemApi, cands: C[]): Promise<C[]> {
  if (!cands.length) return cands;
  const builds = await stub.candidateBuilds(cands.map((c) => ({ id: c.id, realization: c.realization, commit: c.commit })));
  return cands.map((c) => (builds[c.id] ? { ...c, build: builds[c.id] } : c));
}

export async function submit(
  env: Env, systemId: string, rid: string, body: { commit?: unknown; previewUrl?: unknown }, source: SubmitSource,
): Promise<SubmitResponse> {
  const commit = body.commit;
  if (typeof commit !== "string" || !COMMIT_RE.test(commit)) throw badRequest("commit must be a 40-character hex sha");
  const previewUrl = typeof body.previewUrl === "string" && /^https?:\/\//.test(body.previewUrl) ? body.previewUrl : undefined;
  const stub = systemStub(env, systemId);
  if(await stub.realizationPlanId(rid)) {
    if(source!=='ci')throw conflict('invalid-state','Task Attempts must use scoped lifecycle submit with fenced generation');
    const {refreshLifecycleCandidate}=await import('./lifecycle-service');return refreshLifecycleCandidate(env,systemId,rid,commit,previewUrl);
  }
  const s = await headState(env, systemId);
  const rec = await record(env, systemId, rid);
  const ns = artifactsFor(env);

  let existing = (await stub.candidates({ realizationId: rid })).find((c) => c.commit === commit);
  let created = true;
  if (!existing) {
    const built = await withRepo(ns, rec.forkRepo, async (repo) => {
      if (!(await repo.readCommit(commit))) throw unprocessable("unknown-commit", `commit ${commit} not found in ${rec.forkRepo}; push before submitting`);
      const input = { realizationId: rid, evolutionId: rec.evolutionId, target: rec.target, repo: rec.forkRepo, baseRepo: rec.baseRepo, baseCommit: rec.baseCommit, commit, ...(previewUrl && { previewUrl }) };
      if (rec.target === "app") {
        const base = await canonicalGenome(env, s);
        const sm = sourceMapFor(base.model);
        const m = await buildCandidateManifest(repo, input, sm);
        return { ...m, pathNodes: Object.fromEntries(m.changedPaths.map((p) => [p, nodesForPath(sm, p).filter((n) => !n.startsWith("unmapped:"))])) };
      }
      // Genome realization: changed nodes are the semantic delta's ids.
      const m = await buildCandidateManifest(repo, input, []);
      const baseG = await genomeAt(env, systemId, rec.baseCommit, rec.forkRepo);
      let genomeDelta: ReturnType<typeof diffModels> | undefined;
      let loadError: string | undefined;
      try {
        const candG = await genomeAt(env, systemId, commit, rec.forkRepo);
        genomeDelta = diffModels(baseG.model, candG.model);
      } catch (e) {
        // An oversized Genome is refused outright (422), never recorded as a candidate that cannot be cached or reviewed.
        if (e instanceof HttpError && e.code === "genome-too-large") throw e;
        loadError = (e as Error).message;
      }
      const ids = genomeDelta ? [...genomeDelta.added, ...genomeDelta.removed, ...genomeDelta.changed.map((c) => c.id)] : [];
      return { ...m, changedNodes: [...new Set(ids)].sort(), genomeChanges: m.changedPaths, ...(genomeDelta && { genomeDelta }), ...(loadError && { loadError }) };
    });
    const manifest = { ...built, manifestHash: await manifestHash(built) };
    const out = await rpc(stub.recordCandidate({ realizationId: rid, commit, manifest, changedPaths: manifest.changedPaths, changedNodes: manifest.changedNodes }));
    created = out.created;
    if (out.created) {
      const ref = (await storedCandidates(env, systemId, { evolutionId: rec.evolutionId })).find((c) => c.id === out.candidate.id)!;
      await recordRun(env, systemId, out.candidate.id, await evaluate(env, s, rec, ref, "submission"));
      // B3: every app candidate gets a preview build (no-op without the CI binding).
      await dispatchPreviewBuild(env, s, rec, out.candidate);
    }
    existing = out.candidate;
  } else {
    created = false;
    // The CLI's preview URL arrives after a queue submit created the candidate: store it and re-run the hooks
    // (the http health hook needs it). Otherwise re-run only after hooks failed mid-way, and only one retry at a time.
    const addedPreview = !!previewUrl && (await stub.setPreviewUrl(existing.id, previewUrl));
    const retry = !addedPreview && (await stub.evaluations(existing.id)).length === 0 && rec.realization.status === "evaluating";
    if (addedPreview || (retry && (await stub.claimEvaluation(existing.id)))) {
      try {
        const ref = (await storedCandidates(env, systemId, { evolutionId: rec.evolutionId })).find((c) => c.id === existing!.id)!;
        await recordRun(env, systemId, existing.id, await evaluate(env, s, rec, ref, "submission"));
      } finally {
        if (retry) await stub.releaseEvaluation(existing.id);
      }
    }
  }
  // A concurrent submit of the same commit may have created the candidate: only the creator recomputes.
  const conflictReports = created ? await computeConflicts(env, systemId, existing.id) : (await stub.storedConflicts(existing.id)).conflicts;
  if (created) for (const c of conflictReports) await stub.publish({ type: "conflict.detected", conflict: c });
  await refreshRegistry(env, systemId);
  const fresh = await record(env, systemId, rid);
  const [candidate] = await withBuilds(stub, [(await stub.candidate(existing.id))!]);
  return {
    created, realization: fresh.realization, candidate,
    evaluations: await stub.evaluations(existing.id), conflicts: conflictReports,
  };
}

/**
 * Admin re-run of an open candidate's submission hooks with its current preview URL and passed build (the path a
 * submit or a preview URL arrival takes). The new evaluations replace the old ones. 409 for promoted or rejected
 * candidates and while another run of the same candidate holds the claim.
 */
export async function reevaluate(env: Env, systemId: string, candidateId: string): Promise<EvaluateCandidateResponse> {
  const stub = systemStub(env, systemId);
  const s = await headState(env, systemId);
  const cand = await stub.candidate(candidateId);
  if (!cand) throw notFound(`unknown candidate ${candidateId}`);
  if (cand.state === "promoted" || cand.state === "rejected") throw conflict("invalid-state", `candidate ${candidateId} is ${cand.state}`);
  const rec = await record(env, systemId, cand.realization);
  if (!(await stub.claimEvaluation(candidateId))) throw conflict("evaluation-running", `candidate ${candidateId} is being evaluated; try again shortly`);
  try {
    const ref = (await storedCandidates(env, systemId, { evolutionId: rec.evolutionId })).find((c) => c.id === candidateId);
    if (!ref) throw conflict("invalid-state", `candidate ${candidateId} is no longer open`);
    await recordRun(env, systemId, candidateId, await evaluate(env, s, rec, ref, "submission"), true);
  } finally {
    await stub.releaseEvaluation(candidateId);
  }
  await refreshRegistry(env, systemId);
  const [candidate] = await withBuilds(stub, [(await stub.candidate(candidateId))!]);
  return { realization: (await record(env, systemId, cand.realization)).realization, candidate, evaluations: await stub.evaluations(candidateId) };
}

/** Re-read the fork head; submit it if it is new and not the base commit. */
export async function sync(env: Env, systemId: string, rid: string): Promise<SyncResponse> {
  const rec = await record(env, systemId, rid);
  const [head] = await withRepo(artifactsFor(env), rec.forkRepo, (r) => r.log({ limit: 1 }));
  if (!head || head.hash === rec.baseCommit) return { head: head?.hash ?? null, submitted: null };
  const known = (await systemStub(env, systemId).candidates({ realizationId: rid })).some((c) => c.commit === head.hash);
  if (known) return { head: head.hash, submitted: null };
  return { head: head.hash, submitted: await submit(env, systemId, rid, { commit: head.hash }, "sync") };
}

/**
 * Each candidate's promotion gate as prepareGate computes it (canonical Genome, the DO's Evolution record, the
 * candidate's target), so the UI's coverage table shows the set the server enforces instead of recomputing it.
 */
async function candidateGates(env: Env, systemId: string, evolutionId: string, candidates: { id: string; realization: string }[]): Promise<{ gates?: Record<string, GateCriterion[]>; gatesError?: string }> {
  const stub = systemStub(env, systemId);
  try {
    const g = await canonicalGenome(env, await headState(env, systemId));
    const evo = await stub.evolution(evolutionId);
    if (!evo) return { gatesError: `evolution ${evolutionId} is unknown` };
    const gates: Record<string, GateCriterion[]> = {};
    for (const c of candidates) gates[c.id] = gateCriteria(g.model, evo, { target: (await stub.realization(c.realization))?.target ?? "app" });
    return { gates };
  } catch (e) {
    return { gatesError: `the promotion gate cannot be computed: ${(e as Error)?.message ?? e}` };
  }
}

export async function candidatesView(env: Env, systemId: string, evolutionId: string): Promise<CandidatesResponse> {
  const stub = systemStub(env, systemId);
  const candidates = await withBuilds(stub, await stub.candidates({ evolutionId }));
  const evaluations = (await Promise.all(candidates.map((c) => stub.evaluations(c.id)))).flat();
  const stored = await stub.storedConflicts();
  const ids = new Set(candidates.map((c) => c.id));
  return {
    evolution: evolutionId, candidates, evaluations,
    conflicts: stored.conflicts.filter((c) => c.candidates.some((x) => ids.has(x))), conflictsComputedAt: stored.computedAt,
    ...(await candidateGates(env, systemId, evolutionId, candidates)),
  };
}

/** Genome candidate review panel: semantic delta, base vs candidate readiness, DeltaReviews, evaluations. */
export async function review(env: Env, systemId: string, rid: string): Promise<GenomeCandidateReview> {
  const stub = systemStub(env, systemId);
  const rec = await record(env, systemId, rid);
  if (rec.target !== "genome") throw conflict("invalid-state", "review is for genome realizations");
  const candId = rec.realization.candidate;
  if (!candId) throw conflict("not-ready", "realization has no submitted candidate");
  const [stored, evaluations] = await Promise.all([stub.review(candId), stub.evaluations(candId)]);
  if (!stored) throw conflict("not-ready", `candidate ${candId} has no review yet (hooks have not run)`);
  const commit = (await stub.candidate(candId))?.commit;
  // `candidate` + `commit` are what accept must name: the review the admin read.
  return { ...(JSON.parse(stored) as GenomeCandidateReview), candidate: candId, ...(commit && { commit }), evaluations };
}

// ------------------------------------------------------------------ promote + accept

/**
 * The promotion gate for `ids`, computed from the canonical Genome, failing closed. When the head is still
 * `expectedHead`, the candidates' hooks re-run first with promotionFacts (base-current, manifest-exact, evidence-fresh).
 * Shared by promote and accept.
 */
async function prepareGate(
  env: Env, systemId: string, s: HeadState, ids: string[], expectedHead: string | null,
): Promise<{ g: LoadedGenome; gates: Record<string, GateCriterion[]> }> {
  const stub = systemStub(env, systemId);
  // Fail closed: if the gate cannot be computed, refuse; never treat an exception as "no gates".
  const unavailable = (why: string) => conflict("gate-unavailable", `promotion gate unavailable: ${why}`);
  let g: LoadedGenome;
  try {
    g = await canonicalGenome(env, s);
  } catch (e) {
    throw unavailable(`the Genome at ${s.genomeCommit} does not load (${(e as Error)?.message ?? e})`);
  }
  const gates: Record<string, GateCriterion[]> = {};
  for (const id of ids) {
    const c = await stub.candidate(id);
    if (!c) throw notFound(`unknown candidate ${id}`);
    const rec = await record(env, systemId, c.realization);
    const ref = (await storedCandidates(env, systemId, { evolutionId: rec.evolutionId })).find((x) => x.id === id)!;
    const evo = await stub.evolution(rec.evolutionId);
    if (!evo) throw unavailable(`evolution ${rec.evolutionId} is unknown`);
    try {
      gates[id] = gateCriteria(g.model, evo, await hookRef(env, systemId, ref));
    } catch (e) {
      throw unavailable(`criteria for ${id} could not be computed (${(e as Error)?.message ?? e})`);
    }
    // Revalidate on the exact commit before the CAS: hooks re-run with promotionFacts (base-current, manifest-exact, evidence-fresh).
    if (["submitted", "evaluated", "selected"].includes(c.state) && s.head === expectedHead) {
      // Never overlap an admin re-run of the same candidate: one would overwrite the other's evidence.
      if (!(await stub.claimEvaluation(id))) throw conflict("evaluation-running", `candidate ${id} is being re-evaluated; promote once its checks finish`);
      try {
        await computeConflicts(env, systemId, id);
        const { evaluations } = await evaluate(env, s, rec, ref, "promotion", ids);
        if (evaluations.length) await stub.recordEvaluations(id, evaluations);
      } finally {
        await stub.releaseEvaluation(id);
      }
    }
  }
  return { g, gates };
}

/** Map a DO gate refusal to its HTTP error: the same for legacy promote and accept and for plan promote. */
export function gateRefusal(out: { code: string; blocking: GateItem[]; advisories: GateItem[] }): HttpError {
  const details = { criteria: out.blocking, advisories: out.advisories };
  if (out.code === "advisories-unacknowledged") {
    return new HttpError(400, out.code, "advisory criteria are not green; acknowledge them with a non-empty rationale", details);
  }
  return conflict("blocked", "blocking criteria (hard, with a bound hook) lack pass+completed evaluations", details);
}

/**
 * After promotion or acceptance: revoke the fork write tokens of the realizations it ended (secrets are already nulled)
 * and remove their push subscriptions.
 */
export async function revokeEnded(env: Env, systemId: string, ended: EndedCredential[]): Promise<void> {
  await Promise.all([
    ...ended.filter((x) => x.tokenId && x.forkRepo).map((x) =>
      withRepo(artifactsFor(env), x.forkRepo, (r) => r.revokeToken(x.tokenId!)).catch((e: unknown) =>
        console.error(`[promote] revoking the write token of ${x.realizationId} failed: ${(e as Error)?.message ?? e}`))),
    ...ended.map((x) => unsubscribe(env, systemId, x.realizationId)),
  ]);
}

/** B3: remove a realization's push subscription (best effort) and forget it once it is gone. */
async function unsubscribe(env: Env, systemId: string, rid: string): Promise<void> {
  const stub = systemStub(env, systemId);
  const id = await stub.realizationSubscription(rid);
  if (id && (await removePushSubscription(env, id))) await stub.setRealizationSubscription(rid, null);
}

export async function promote(
  env: Env, systemId: string, body: { candidates?: unknown; candidateIds?: unknown; expectedHead?: unknown; rationale?: unknown },
): Promise<PromoteResponse> {
  const ids = (Array.isArray(body.candidates) ? body.candidates : Array.isArray(body.candidateIds) ? body.candidateIds : []) as unknown[];
  if (!ids.length || !ids.every((x) => typeof x === "string")) throw badRequest("candidates (or candidateIds) must be a non-empty string array");
  if (!("expectedHead" in body) || (body.expectedHead !== null && typeof body.expectedHead !== "string")) throw badRequest("expectedHead is required (string or null)");
  const rationale = typeof body.rationale === "string" ? body.rationale : "";
  const stub = systemStub(env, systemId);
  const s = await headState(env, systemId);
  // Genome candidates are accepted, never promoted (interpretation, Evolution reseed, the candidate Genome's provenance).
  const genome: string[] = [];
  for (const id of ids as string[]) {
    const c = await stub.candidate(id);
    if (c && (await stub.realization(c.realization))?.target === "genome") genome.push(id);
  }
  if (genome.length) {
    throw conflict("use-accept", `${genome.join(", ")} ${genome.length === 1 ? "is a Genome candidate" : "are Genome candidates"}; accept Genome amendments with POST /api/systems/${systemId}/evolutions/<evolution>/accept`);
  }
  const { g, gates } = await prepareGate(env, systemId, s, ids as string[], body.expectedHead as string | null);
  const out = await stub.promote({ candidateIds: ids as string[], expectedHead: body.expectedHead as string | null, rationale, by: "admin", gates, ...manifestExtras(g.model) });
  if (!out.ok) {
    if (out.code === "stale-base") {
      const why = out.currentHead === body.expectedHead
        ? "a candidate was built on an earlier System head; rebase it on the current head and resubmit"
        : "System head moved; reload and retry";
      throw conflict("stale-base", why, { currentHead: out.currentHead });
    }
    if ("blocking" in out) throw gateRefusal(out);
    if (out.code === "not-found") throw notFound(out.message);
    throw conflict(out.code, out.message);
  }
  await revokeEnded(env, systemId, out.ended);
  // B3: production deploy of the promoted app binding (pending record; CI deploys it when bound).
  const promotedFrom = (await stub.candidate(ids[0] as string))?.realization;
  await requestProductionDeploy(env, systemId, out.commit, manifestExtras(g.model).artifactId, promotedFrom);
  await refreshRegistry(env, systemId);
  return { commit: out.commit, rejected: out.rejected, advisories: out.advisories };
}

export async function accept(
  env: Env, systemId: string, evolutionId: string,
  body: { realization?: unknown; realizationId?: unknown; candidateId?: unknown; commit?: unknown; rationale?: unknown; interpretation?: unknown },
) {
  const rid = typeof body.realizationId === "string" ? body.realizationId : typeof body.realization === "string" ? body.realization : undefined;
  if (!rid) throw badRequest("realizationId is required");
  const candId = typeof body.candidateId === "string" && body.candidateId ? body.candidateId : undefined;
  const reviewed = typeof body.commit === "string" && COMMIT_RE.test(body.commit) ? body.commit : undefined;
  if (!candId || !reviewed) throw badRequest("candidateId and commit (40 hex) are required: name the candidate you reviewed");
  const rationale = typeof body.interpretation === "string" ? body.interpretation : typeof body.rationale === "string" ? body.rationale : "";
  const stub = systemStub(env, systemId);
  const rec = await record(env, systemId, rid);
  if (rec.evolutionId !== evolutionId) throw badRequest(`realization ${rid} belongs to ${rec.evolutionId}`);
  if (rec.target !== "genome") throw conflict("invalid-state", "only genome realizations are accepted; promote app candidates");
  const latest = rec.realization.candidate;
  if (!latest) throw conflict("invalid-state", "realization has no submitted candidate");
  const cand = await stub.candidate(candId);
  if (latest !== candId || !cand || cand.commit !== reviewed) {
    const why = latest !== candId ? `the latest is ${latest}` : `it is at ${cand?.commit.slice(0, 12) ?? "no commit"}`;
    throw conflict("stale-candidate", `candidate ${candId} at ${reviewed.slice(0, 12)} is not what ${rid} would accept (${why}); reload the review`);
  }
  let g: LoadedGenome;
  try {
    g = await genomeAt(env, systemId, cand.commit, rec.forkRepo);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw unprocessable("invalid-genome", `candidate Genome does not load: ${(e as Error).message}`);
  }
  // The same blocking gate as promotion: hard criteria with a bound hook (scope included) must be pass+completed.
  const s = await headState(env, systemId);
  const { gates } = await prepareGate(env, systemId, s, [candId], s.head);
  const out = await stub.accept({
    realizationId: rid, candidateId: candId, commit: reviewed, rationale, by: "admin", evolutions: evolutionSeeds(g.model), gates: gates[candId], ...manifestExtras(g.model),
  });
  if (!out.ok) {
    if ("blocking" in out) throw gateRefusal(out);
    if (out.code === "not-found") throw notFound(out.message);
    throw conflict(out.code, out.message);
  }
  await revokeEnded(env, systemId, out.ended);
  await refreshRegistry(env, systemId);
  return { genomeCommit: out.genomeCommit, realization: out.realization, commit: out.commit, advisories: out.advisories };
}

/** Admin: reject a realization (Genome amendments in the review panel). `reason` is required. */
export async function reject(env: Env, systemId: string, rid: string, body: { reason?: unknown }) {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw badRequest("reason is required");
  const rec = await record(env, systemId, rid);
  const realization = await rpc(systemStub(env, systemId).rejectRealization(rid, reason.slice(0, 4000)));
  // A rejected realization's agent must not keep pushing: revoke the fork's write token (by id; the secret is never stored).
  if (rec.tokenId) {
    await withRepo(artifactsFor(env), rec.forkRepo, (r) => r.revokeToken(rec.tokenId!)).catch((e: unknown) =>
      console.error(`[reject] revoking the write token of ${rid} failed: ${(e as Error)?.message ?? e}`));
  }
  await unsubscribe(env, systemId, rid);
  await refreshRegistry(env, systemId);
  return { realization };
}

/** Every System the registry lists for a realization id (none when unknown); never throws on ambiguity. */
export async function systemsHoldingRealization(env: Env, rid: string): Promise<string[]> {
  const hit = await registryStub(env).resolveRealization(rid);
  return !hit ? [] : "ambiguous" in hit ? hit.ambiguous : [hit.systemId];
}

/** Find which System a realization id belongs to (registry index). */
export async function systemForRealization(env: Env, rid: string): Promise<string> {
  const hit = await registryStub(env).resolveRealization(rid);
  if (!hit) throw notFound(`unknown realization ${rid}`);
  if ("ambiguous" in hit) {
    throw conflict("ambiguous", `realization ${rid} exists in more than one System; use /systems/:systemId/realizations/${rid}`, { systems: hit.ambiguous });
  }
  return hit.systemId;
}

/** Queue consumer callbacks for the hooks slice's `createQueueHandler(queueContextFor)`. */
export function queueContextFor(env: Env): QueueContext {
  // resolveFork knows the System; remember it so submit never has to guess between Systems with the same rid.
  const systemOf = new Map<string, string>();
  return {
    async resolveFork(namespace, repoName) {
      if (namespace !== env.ARTIFACTS_NAMESPACE) return null;
      const hit = await registryStub(env).resolveFork(repoName);
      if (!hit) return null;
      systemOf.set(hit.realizationId, hit.systemId);
      return hit.realizationId;
    },
    submit: async (rid, commit, source) => {
      const systemId = systemOf.get(rid) ?? (await systemForRealization(env, rid));
      // A push to a promoted, rejected or abandoned realization can never become a candidate: ack instead of retrying.
      const status = (await record(env, systemId, rid)).realization.status;
      if (TERMINAL_REALIZATION.includes(status)) {
        console.info(`[queue] ${rid} is ${status}; push of ${commit.slice(0, 12)} ignored`);
        return { ignored: status };
      }
      return submit(env, systemId, rid, { commit }, source);
    },
    markEventSeen: (id) => registryStub(env).markEventSeen(id),
  };
}

// ------------------------------------------------------------------ B5 describe-a-change

const EVOLUTION_KINDS: schema.Evolution["kind"][] = ["genome-amendment"];
const RISKS: schema.Evolution["risk"][] = ["low", "medium", "high"];
/**
 * Default acceptance criteria of a new Evolution: the System's criteria whose `targetKind` matches its target. An
 * `implementation` targets the app (`artifact`, `runtime`), a `genome-amendment` the model. Without an explicit kind
 * (the Work form and the editor send none) or for `mixed`, the target is unknown and only `model` criteria apply:
 * an acceptance criterion stays blocking whatever the candidate's target (see gateCriteria), and artifact or runtime
 * criteria could never pass on a Genome candidate.
 */
function defaultCriteria(m: SystemModel, kind: schema.Evolution["kind"] | undefined): string[] {
  const keep = (c: schema.Criterion) =>
    kind === "implementation" ? c.targetKind === "artifact" || c.targetKind === "runtime" : c.targetKind === "model";
  return m.criteria.filter(keep).map((c) => c.id);
}

function stringList(v: unknown, field: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) throw badRequest(`${field} must be an array of ids`);
  return [...new Set(v as string[])];
}

/**
 * `POST /api/systems/:id/evolutions` (admin): describe a change in words and get an `actionable` Evolution to start
 * work on. Affected nodes and acceptance criteria must exist in the canonical Genome (an unknown criterion would
 * block promotion forever). Without `affectedNodes` the scope is empty, which means unconstrained (the Task Packet
 * permits every path except the protected ones). Without `acceptanceCriteria` it defaults to the System's criteria
 * whose `targetKind` matches the Evolution's target (see defaultCriteria). `newNodes` are affected nodes the change
 * itself adds (an accepted intent), exempt from the existence check.
 */
export async function createEvolution(
  env: Env, systemId: string, body: Record<string, unknown>, opts: { newNodes?: string[] } = {},
): Promise<CreateEvolutionResponse> {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const intent = typeof body.intent === "string" ? body.intent.trim() : "";
  if (!title || title.length > 200) throw badRequest("title is required (at most 200 characters)");
  if (!intent || intent.length > 4000) throw badRequest("intent is required (at most 4000 characters)");
  const kind = (body.kind ?? "genome-amendment") as schema.Evolution["kind"];
  if (!EVOLUTION_KINDS.includes(kind)) throw badRequest(`kind must be one of ${EVOLUTION_KINDS.join(", ")}`);
  const risk = (body.risk ?? "medium") as schema.Evolution["risk"];
  if (!RISKS.includes(risk)) throw badRequest(`risk must be one of ${RISKS.join(", ")}`);
  const affectedNodes = stringList(body.affectedNodes, "affectedNodes");
  const s = await headState(env, systemId);
  const m = (await canonicalGenome(env, s)).model;
  const acceptanceCriteria = body.acceptanceCriteria === undefined
    ? defaultCriteria(m, kind)
    : stringList(body.acceptanceCriteria, "acceptanceCriteria");
  const unknownNodes = affectedNodes.filter((id) => !m.index.byId[id] && !opts.newNodes?.includes(id));
  if (unknownNodes.length) throw badRequest(`unknown nodes: ${unknownNodes.join(", ")}`);
  const criteria = new Set(m.criteria.map((c) => c.id));
  const unknownCriteria = acceptanceCriteria.filter((id) => !criteria.has(id));
  if (unknownCriteria.length) throw badRequest(`unknown criteria: ${unknownCriteria.join(", ")}`);
  const evolution = await rpc(systemStub(env, systemId).createEvolution({
    title, intent, kind, risk, affectedNodes, acceptanceCriteria,
    affectedClaims: [], genomeDelta: [], requiredEvidence: [], dependsOn: [], ...(s.head && { baseRevision: s.head }),
  }));
  await refreshRegistry(env, systemId);
  return { evolution };
}
