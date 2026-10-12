/**
 * Orchestration between Artifacts, the model, hooks and the SystemAuthority DO. Routes and the queue
 * consumer call these; all Artifacts I/O and model work happens here (never inside the DO).
 */
import { diffModels, type schema, type SystemModel } from "@artyfact/model";
import { templateFile } from "@artyfact/templates";
import { parse as parseYaml } from "yaml";
import type {
  CandidatesResponse, ConflictReport, Evaluation, Evolution, GenomeCandidateReview, ImportSystemResponse, ModelBundle, PacketResponse, PromoteResponse,
  ReadinessResponse, RealizationResponse, StartWorkRequest, StartWorkResponse, SubmitResponse, SyncResponse,
} from "../shared/api";
import { artifactsFor, forkAndWait, remoteUrl, withRepo, type ArtifactsRepoLike } from "./artifacts/client";
import { buildCandidateManifest, manifestHash, type CandidateManifest } from "./artifacts/candidates";
import { buildGenome, genomePrefix, listTree, memoGenome, readGenomeFiles, type LoadedGenome } from "./artifacts/genome-source";
import { loadSourceMap, nodesForPath, type SourceMapEntry } from "./artifacts/source-map";
import { REGISTRY, type SystemAuthority, type EvolutionSeed, type HeadState, type ManifestExtras, type RealizationRecord } from "./do/system-authority";
import { badRequest, conflict, fromRpc, HttpError, notFound, unprocessable } from "./errors";
import type { CandidateRef, FileMap, QueueContext, SubmissionContext } from "./hooks/contract";
import { hookRunner } from "./hooks/index";
import { buildGenomeReview } from "./genome/review";
import { readinessReport, serializeModel } from "./model-bundle";
import { buildTaskPacket, protectedPathsFor } from "./packets/task-packet";
import { gateCriteria, hooksOf, type GateCriterion } from "./promotion";

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

async function refreshRegistry(env: Env, systemId: string): Promise<void> {
  const summary = await systemStub(env, systemId).summary();
  if (summary) await registryStub(env).registerSystem(summary);
}

// ------------------------------------------------------------------ genomes

/**
 * The Genome at `genomeCommit`, from (1) the per-isolate memo, (2) the DO's cached files, or (3) Artifacts
 * (`repo`), caching files + serialised model + rules readiness in the DO afterwards.
 */
export async function genomeAt(env: Env, systemId: string, genomeCommit: string, repo: string): Promise<LoadedGenome> {
  const key = `${systemId}@${genomeCommit}`;
  const stub = systemStub(env, systemId);
  const cached = await stub.getModelCache(genomeCommit, "files");
  if (cached) return memoGenome(key, () => buildGenome(new Map(Object.entries(JSON.parse(cached) as Record<string, string>)), genomeCommit));
  const files = await withRepo(artifactsFor(env), repo, (r) => readGenomeFiles(r, genomeCommit));
  const g = memoGenome(key, () => buildGenome(files, genomeCommit));
  await stub.putModelCache(genomeCommit, {
    files: JSON.stringify(Object.fromEntries(files)),
    model: JSON.stringify(serializeModel(g.model)),
    rules: JSON.stringify(g.readiness),
  });
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

/** The Thing realized by the app repo and its template (for source-map defaults + scaffold commands). */
function appThing(m: SystemModel): { thing?: schema.ResolvedThing; template?: schema.Template } {
  const thing = m.things.find((t) => t.artifacts.some((a) => a.type === "worker-fullstack")) ?? m.things[0];
  const template = thing?.templateRef ? m.templates.find((t) => `${t.id}@${t.version}` === thing.templateRef) : undefined;
  return { thing, template };
}

function scaffoldCommands(m: SystemModel, target: "app" | "genome"): string[] {
  if (target === "genome") return ["npm install", "npm test"];
  const ref = appThing(m).thing?.templateRef;
  const text = ref ? templateFile(ref, "scaffold.yaml") : undefined;
  const cmds = (text ? (parseYaml(text) as { commands?: Record<string, string> })?.commands : undefined) ?? {};
  const list = Object.values(cmds).filter((c): c is string => typeof c === "string");
  return list.length ? list : ["npm install", "npm run dev", "npm test"];
}

async function sourceMapFor(m: SystemModel, repo: ArtifactsRepoLike, commit: string): Promise<SourceMapEntry[]> {
  const { thing, template } = appThing(m);
  const blob = await repo.readFile({ ref: commit, path: "source-map.yaml" });
  return loadSourceMap(template?.sourceMapDefaults, thing?.id, blob ? await blob.text() : undefined);
}

// ------------------------------------------------------------------ import

export async function importSystem(env: Env, body: { systemId?: unknown; genomeRepo?: unknown; appRepo?: unknown; force?: unknown }): Promise<ImportSystemResponse> {
  const { systemId, genomeRepo, appRepo } = body;
  if (typeof systemId !== "string" || typeof genomeRepo !== "string" || typeof appRepo !== "string" || !systemId || !genomeRepo || !appRepo) {
    throw badRequest("systemId, genomeRepo and appRepo are required strings");
  }
  if (systemId === REGISTRY) throw badRequest("reserved system id");
  const ns = artifactsFor(env);
  const headOf = async (name: string) => {
    const [c] = await withRepo(ns, name, (r) => r.log({ limit: 1 }));
    if (!c) throw unprocessable("empty-repo", `repo ${name} has no commits`);
    return c.hash;
  };
  const [genomeCommit, appCommit] = await Promise.all([headOf(genomeRepo), headOf(appRepo)]);
  const files = await withRepo(ns, genomeRepo, (r) => readGenomeFiles(r, genomeCommit));
  const g = memoGenome(`${systemId}@${genomeCommit}`, () => buildGenome(files, genomeCommit));
  if (g.model.system.id !== systemId) {
    throw unprocessable("system-mismatch", `Genome in ${genomeRepo} declares ${g.model.system.id}, not ${systemId}`);
  }
  const stub = systemStub(env, systemId);
  const system = await rpc(stub.bootstrap({
    systemId, title: g.model.system.name, phase: g.model.system.phase, genomeRepo, appRepo, genomeCommit, appCommit,
    evolutions: evolutionSeeds(g.model), ...manifestExtras(g.model), force: body.force === true,
  }));
  await stub.putModelCache(genomeCommit, {
    files: JSON.stringify(Object.fromEntries(files)),
    model: JSON.stringify(serializeModel(g.model)),
    rules: JSON.stringify(g.readiness),
  });
  await registryStub(env).registerSystem(system);
  return { system, head: system.head!, genomeCommit, appCommit, evolutions: g.model.evolutions.map((e) => e.id) };
}

// ------------------------------------------------------------------ model + readiness

interface ResolvedRevision { revision: string; genomeCommit: string; repo: string; candidateIds: string[] }

async function resolveRevision(env: Env, s: HeadState, rev: string | undefined): Promise<ResolvedRevision> {
  const stub = systemStub(env, s.systemId);
  if (!rev || rev === "canonical" || rev === "head" || rev === s.head) {
    const head = s.head ? await stub.systemCommit(s.head) : null;
    return { revision: rev ?? "canonical", genomeCommit: s.genomeCommit, repo: s.genomeSource, candidateIds: head?.candidates ?? [] };
  }
  if (rev.startsWith("sc-")) {
    const c = await stub.systemCommit(rev);
    if (!c) throw notFound(`unknown System commit ${rev}`);
    return { revision: rev, genomeCommit: c.genomeCommit, repo: s.genomeSource, candidateIds: c.candidates };
  }
  if (rev.startsWith("candidate.")) {
    const c = await stub.candidate(rev);
    if (!c) throw notFound(`unknown candidate ${rev}`);
    const rec = await stub.realization(c.realization);
    if (rec?.target === "genome") return { revision: rev, genomeCommit: c.commit, repo: rec.forkRepo, candidateIds: [rev] };
    return { revision: rev, genomeCommit: s.genomeCommit, repo: s.genomeSource, candidateIds: [rev] };
  }
  if (COMMIT_RE.test(rev)) return { revision: rev, genomeCommit: rev, repo: s.genomeSource, candidateIds: [] };
  throw badRequest(`unknown revision ${rev}`);
}

async function evaluationsFor(env: Env, systemId: string, candidateIds: string[]) {
  const stub = systemStub(env, systemId);
  return (await Promise.all(candidateIds.map((id) => stub.evaluations(id)))).flat();
}

export async function modelBundle(env: Env, systemId: string, rev?: string): Promise<ModelBundle> {
  const s = await headState(env, systemId);
  const r = await resolveRevision(env, s, rev);
  const g = await genomeAt(env, systemId, r.genomeCommit, r.repo);
  const evals = await evaluationsFor(env, systemId, r.candidateIds);
  return {
    systemId, revision: r.revision, genomeCommit: r.genomeCommit,
    model: serializeModel(g.model),
    readiness: readinessReport(g.model, g.readiness, evals),
    rules: g.readiness,
  };
}

export async function readiness(env: Env, systemId: string, rev?: string): Promise<ReadinessResponse> {
  const s = await headState(env, systemId);
  const r = await resolveRevision(env, s, rev);
  const g = await genomeAt(env, systemId, r.genomeCommit, r.repo);
  const evals = await evaluationsFor(env, systemId, r.candidateIds);
  return { systemId, revision: r.revision, genomeCommit: r.genomeCommit, readiness: readinessReport(g.model, g.readiness, evals), rules: g.readiness };
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

export async function startWork(env: Env, systemId: string, evolutionId: string, body: StartWorkRequest, platformUrl: string): Promise<StartWorkResponse> {
  if (body.target !== undefined && body.target !== "app" && body.target !== "genome") throw badRequest("target must be app or genome");
  const stub = systemStub(env, systemId);
  const s = await headState(env, systemId);
  const evoDto = await stub.evolution(evolutionId);
  if (!evoDto) throw notFound(`unknown evolution ${evolutionId}`);
  const g = await canonicalGenome(env, s);
  const evolution = modelEvolution(g.model, evoDto);
  const target = body.target ?? (evolution.kind === "genome-amendment" ? "genome" : "app");

  const reserved = await rpc(stub.reserveRealization({ evolutionId, target, agentLabel: body.agentLabel, role: body.role }));
  const rid = reserved.realization.id;
  let tokenId: string | undefined;
  try {
    await registryStub(env).registerRealization(rid, systemId, evolutionId, reserved.forkRepo);
    const ns = artifactsFor(env);
    const forked = await forkAndWait(ns, reserved.baseRepo, reserved.forkRepo);
    const token = await withRepo(ns, reserved.forkRepo, (r) => r.createToken("write", TOKEN_TTL_S));
    tokenId = token.id;
    const remote = remoteUrl(env, reserved.forkRepo, forked.remote);
    const { sourceMap, tree, prefix } = await withRepo(ns, reserved.baseRepo, async (r) => ({
      sourceMap: target === "app" ? await sourceMapFor(g.model, r, reserved.baseCommit) : [],
      tree: target === "app" ? [...(await listTree(r, reserved.baseCommit)).keys()] : [],
      prefix: target === "genome" ? await genomePrefix(r, reserved.baseCommit) : "",
    }));
    const packet = await buildTaskPacket({
      systemId, realizationId: rid, target, model: g.model, evolution,
      workspace: { repo: reserved.baseRepo, fork: reserved.forkRepo, baseCommit: reserved.baseCommit, remote },
      sourceMap, baseTreePaths: tree, commands: scaffoldCommands(g.model, target),
      concurrentWork: await concurrentWork(env, systemId, evolutionId, rid), platformUrl, genomePrefix: prefix,
    });
    const realization = await stub.activateRealization(rid, { tokenId: token.id, tokenExpires: token.expiresAt, remote, packet });
    await refreshRegistry(env, systemId);
    const cli = packet.startCommand.replace("<token>", token.plaintext);
    return {
      systemId, realization, packet, token: { value: token.plaintext, expiresAt: token.expiresAt, remote }, remote,
      startCommand: cli, cli,
    };
  } catch (e) {
    // Best-effort cleanup; never let it mask the original error. Never log the token itself.
    const cleanup: Promise<unknown>[] = [
      stub.abandonRealization(rid),
      registryStub(env).unregisterRealization(rid),
    ];
    if (tokenId) cleanup.push(withRepo(artifactsFor(env), reserved.forkRepo, (r) => r.revokeToken(tokenId!)));
    for (const r of await Promise.allSettled(cleanup)) {
      if (r.status === "rejected") console.error(`[startWork] cleanup for ${rid} failed: ${(r.reason as Error)?.message ?? r.reason}`);
    }
    throw e;
  }
}

async function record(env: Env, systemId: string, rid: string): Promise<RealizationRecord> {
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
  const candidate = rec.realization.candidate ? await stub.candidate(rec.realization.candidate) : null;
  const evaluations = candidate ? await stub.evaluations(candidate.id) : [];
  const conflicts = candidate ? await conflictsFor(env, systemId, candidate.id).catch(() => []) : [];
  return { ...rec.realization, systemId, realization: rec.realization, ...(candidate && { candidateDetail: candidate }), evaluations, conflicts };
}

export async function checkpoint(env: Env, systemId: string, rid: string, body: { summary?: unknown; message?: unknown; commit?: unknown }) {
  const summary = typeof body.summary === "string" ? body.summary : typeof body.message === "string" ? body.message : "";
  if (!summary.trim()) throw badRequest("summary (or message) is required");
  if (body.commit !== undefined && body.commit !== null && (typeof body.commit !== "string" || !COMMIT_RE.test(body.commit))) {
    throw badRequest("commit must be a 40-character hex sha");
  }
  const out = await rpc(systemStub(env, systemId).checkpoint(rid, { summary: summary.slice(0, 4000), ...(typeof body.commit === "string" && { commit: body.commit }) }));
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
      ...(m.pathNodes && { pathNodes: m.pathNodes }), ...(m.manifestHash && { manifestHash: m.manifestHash }), id: c.id, state: c.state,
    };
  }));
}

/** Stored candidate → the hooks' CandidateRef (Genome candidates carry their file map from the DO cache). */
async function hookRef(env: Env, systemId: string, c: StoredCandidate): Promise<CandidateRef> {
  const genomeFiles = c.target === "genome" ? await systemStub(env, systemId).getModelCache(c.commit, "files") : null;
  return {
    id: c.id, realizationId: c.realizationId, evolutionId: c.evolutionId, target: c.target, commit: c.commit, baseCommit: c.baseCommit,
    changedPaths: c.changedPaths, changedNodes: c.changedNodes, ...(c.pathNodes && { pathNodes: c.pathNodes }),
    ...(c.previewUrl && { previewUrl: c.previewUrl }), ...(genomeFiles && { genomeFiles: JSON.parse(genomeFiles) as FileMap }),
  };
}

async function canonicalFiles(env: Env, s: HeadState): Promise<FileMap> {
  return Object.fromEntries((await canonicalGenome(env, s)).files);
}

async function conflictsFor(env: Env, systemId: string, candidateId?: string): Promise<ConflictReport[]> {
  const s = await headState(env, systemId);
  const open = await Promise.all((await storedCandidates(env, systemId)).map((c) => hookRef(env, systemId, c)));
  const subjects = candidateId ? open.filter((c) => c.id === candidateId) : open;
  if (!subjects.length) return [];
  const genomeFiles = await canonicalFiles(env, s);
  const runner = hookRunner(env);
  const seen = new Set<string>();
  const out: ConflictReport[] = [];
  for (const candidate of subjects) {
    const reports = await runner.conflicts({ systemId, candidate, genomeCommit: s.genomeCommit, genomeFiles, openCandidates: open.filter((c) => c.id !== candidate.id) });
    for (const r of reports) {
      const key = `${r.kind}|${[...r.candidates].sort().join(",")}|${[...r.subjects].sort().join(",")}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(r);
      }
    }
  }
  return out;
}

export const conflicts = (env: Env, systemId: string) => conflictsFor(env, systemId);

/** Run hooks for a recorded candidate; returns evaluations in wire form and the realization status to set. */
async function evaluate(env: Env, s: HeadState, rec: RealizationRecord, cand: StoredCandidate, trigger: "submission" | "promotion") {
  const stub = systemStub(env, s.systemId);
  const [genomeFiles, candidate, others] = await Promise.all([
    canonicalFiles(env, s),
    hookRef(env, s.systemId, cand),
    storedCandidates(env, s.systemId).then((xs) => Promise.all(xs.filter((c) => c.id !== cand.id).map((c) => hookRef(env, s.systemId, c)))),
  ]);
  const { tree, exists, recomputedHash } = await withRepo(artifactsFor(env), rec.forkRepo, async (repo) => {
    const exists = !!(await repo.readCommit(cand.commit));
    const listing = exists ? await listTree(repo, cand.commit) : new Map<string, { hash: string }>();
    const tree = await Promise.all([...listing].map(async ([path, e]) => ({ path, size: (await repo.readBlob(e.hash))?.size ?? 0 })));
    const recomputedHash = trigger === "promotion" && exists
      ? await manifestHash(await buildCandidateManifest(repo, { realizationId: cand.realizationId, evolutionId: cand.evolutionId, target: cand.target, repo: cand.repo, baseRepo: cand.baseRepo, baseCommit: cand.baseCommit, commit: cand.commit }, []))
      : undefined;
    return { tree, exists, recomputedHash };
  });
  let promotionFacts: SubmissionContext["promotionFacts"];
  if (trigger === "promotion") {
    const submittedAt = (await stub.candidate(cand.id))?.submittedAt ?? "";
    const g = await canonicalGenome(env, s);
    promotionFacts = {
      currentBaseCommit: rec.target === "genome" ? s.genomeCommit : s.appSource.commit,
      manifestExact: !!cand.manifestHash && cand.manifestHash === recomputedHash,
      evidenceFresh: exists && evidenceFresh(g.model, candidate, await stub.evaluations(cand.id), submittedAt, s.genomeCommit),
    };
  }
  const ctx: SubmissionContext = {
    systemId: s.systemId, candidate, genomeCommit: s.genomeCommit, genomeFiles, tree,
    permittedPaths: rec.packet?.permittedPaths ?? [], protectedPaths: rec.packet?.protectedPaths ?? protectedPathsFor(rec.target),
    openCandidates: others, ...(promotionFacts && { promotionFacts }),
  };
  const runner = hookRunner(env);
  if (rec.target === "genome") {
    const r = await runner.runGenome(ctx);
    const base = await genomeAt(env, s.systemId, rec.baseCommit, rec.forkRepo);
    const candG = await genomeAt(env, s.systemId, cand.commit, rec.forkRepo).catch(() => null);
    const review = buildGenomeReview({
      candidate: cand.id, base: base.model, cand: candG?.model ?? null, delta: candG ? diffModels(base.model, candG.model) : null,
      readinessBase: base.readiness, run: r,
    });
    return { evaluations: r.evaluations, status: "awaiting-admin" as const, review };
  }
  return { evaluations: await runner.runSubmission(ctx), status: "evaluated" as const };
}

type Run = Awaited<ReturnType<typeof evaluate>>;

async function recordRun(env: Env, systemId: string, candidateId: string, run: Run): Promise<void> {
  const stub = systemStub(env, systemId);
  if (run.review) await stub.putReview(candidateId, JSON.stringify(run.review));
  await stub.recordEvaluations(candidateId, run.evaluations, run.status);
}

/**
 * `evidence-fresh`: every blocking criterion's latest evaluation was produced for this candidate's commit (its
 * `targetRef` binds the commit, the canonical Genome it ran on, or the candidate's preview) at or after submission.
 * Criteria whose hooks consume promotionFacts themselves (inputs.check) are excluded: they are re-run with the facts.
 */
function evidenceFresh(m: SystemModel, candidate: CandidateRef, evals: Evaluation[], submittedAt: string, genomeCommit: string): boolean {
  const byId = new Map(m.criteria.map((c) => [c.id, c] as const));
  const consumesFacts = (id: string) => {
    const c = byId.get(id);
    return !!c && hooksOf(m, c).some((h) => /base-current|manifest-exact|evidence-fresh/.test(h.inputs.check ?? ""));
  };
  const binds = (ref: string) =>
    ref === candidate.commit || ref.endsWith(`@${candidate.commit}`) || ref === `genome@${genomeCommit}` || (!!candidate.previewUrl && ref === candidate.previewUrl);
  const at = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";
  for (const g of gateCriteria(m, candidate)) {
    if (!g.blocking || consumesFacts(g.id)) continue;
    const latest = evals.filter((e) => e.criterion === g.id).sort((a, b) => at(b).localeCompare(at(a)))[0];
    if (!latest || latest.candidate !== candidate.id || !binds(latest.targetRef) || !latest.finishedAt || latest.finishedAt < submittedAt) return false;
  }
  return true;
}

export type SubmitSource = "cli" | "event" | "sync" | "ui";

export async function submit(
  env: Env, systemId: string, rid: string, body: { commit?: unknown; previewUrl?: unknown }, source: SubmitSource,
): Promise<SubmitResponse> {
  const commit = body.commit;
  if (typeof commit !== "string" || !COMMIT_RE.test(commit)) throw badRequest("commit must be a 40-character hex sha");
  const previewUrl = typeof body.previewUrl === "string" && /^https?:\/\//.test(body.previewUrl) ? body.previewUrl : undefined;
  const stub = systemStub(env, systemId);
  const s = await headState(env, systemId);
  const rec = await record(env, systemId, rid);
  const ns = artifactsFor(env);

  let existing = (await stub.candidates({ realizationId: rid })).find((c) => c.commit === commit);
  if (!existing) {
    const built = await withRepo(ns, rec.forkRepo, async (repo) => {
      if (!(await repo.readCommit(commit))) throw unprocessable("unknown-commit", `commit ${commit} not found in ${rec.forkRepo}; push before submitting`);
      const input = { realizationId: rid, evolutionId: rec.evolutionId, target: rec.target, repo: rec.forkRepo, baseRepo: rec.baseRepo, baseCommit: rec.baseCommit, commit, ...(previewUrl && { previewUrl }) };
      if (rec.target === "app") {
        const base = await canonicalGenome(env, s);
        const sm = await sourceMapFor(base.model, repo, rec.baseCommit);
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
        loadError = (e as Error).message;
      }
      const ids = genomeDelta ? [...genomeDelta.added, ...genomeDelta.removed, ...genomeDelta.changed.map((c) => c.id)] : [];
      return { ...m, changedNodes: [...new Set(ids)].sort(), genomeChanges: m.changedPaths, ...(genomeDelta && { genomeDelta }), ...(loadError && { loadError }) };
    });
    const manifest = { ...built, manifestHash: await manifestHash(built) };
    const out = await rpc(stub.recordCandidate({ realizationId: rid, commit, manifest, changedPaths: manifest.changedPaths, changedNodes: manifest.changedNodes }));
    if (out.created) {
      const ref = (await storedCandidates(env, systemId, { evolutionId: rec.evolutionId })).find((c) => c.id === out.candidate.id)!;
      await recordRun(env, systemId, out.candidate.id, await evaluate(env, s, rec, ref, "submission"));
    }
    existing = out.candidate;
  } else if ((await stub.evaluations(existing.id)).length === 0 && rec.realization.status === "evaluating") {
    // A retry after hooks failed mid-way: run them again.
    const ref = (await storedCandidates(env, systemId, { evolutionId: rec.evolutionId })).find((c) => c.id === existing!.id)!;
    await recordRun(env, systemId, existing.id, await evaluate(env, s, rec, ref, "submission"));
  } else {
    const fresh = await record(env, systemId, rid);
    return {
      created: false, realization: fresh.realization, candidate: (await stub.candidate(existing.id))!,
      evaluations: await stub.evaluations(existing.id), conflicts: await conflictsFor(env, systemId, existing.id),
    };
  }
  const conflictReports = await conflictsFor(env, systemId, existing.id);
  for (const c of conflictReports) await stub.publish({ type: "conflict.detected", conflict: c });
  await refreshRegistry(env, systemId);
  const fresh = await record(env, systemId, rid);
  return {
    created: true, realization: fresh.realization, candidate: (await stub.candidate(existing.id))!,
    evaluations: await stub.evaluations(existing.id), conflicts: conflictReports,
  };
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

export async function candidatesView(env: Env, systemId: string, evolutionId: string): Promise<CandidatesResponse> {
  const stub = systemStub(env, systemId);
  const candidates = await stub.candidates({ evolutionId });
  const evaluations = (await Promise.all(candidates.map((c) => stub.evaluations(c.id)))).flat();
  const all = candidates.length ? await conflictsFor(env, systemId) : [];
  const ids = new Set(candidates.map((c) => c.id));
  return { evolution: evolutionId, candidates, evaluations, conflicts: all.filter((c) => c.candidates.some((x) => ids.has(x))) };
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
  return { ...(JSON.parse(stored) as GenomeCandidateReview), evaluations };
}

// ------------------------------------------------------------------ promote + accept

export async function promote(
  env: Env, systemId: string, body: { candidates?: unknown; candidateIds?: unknown; expectedHead?: unknown; rationale?: unknown },
): Promise<PromoteResponse> {
  const ids = (Array.isArray(body.candidates) ? body.candidates : Array.isArray(body.candidateIds) ? body.candidateIds : []) as unknown[];
  if (!ids.length || !ids.every((x) => typeof x === "string")) throw badRequest("candidates (or candidateIds) must be a non-empty string array");
  if (!("expectedHead" in body) || (body.expectedHead !== null && typeof body.expectedHead !== "string")) throw badRequest("expectedHead is required (string or null)");
  const rationale = typeof body.rationale === "string" ? body.rationale : "";
  const stub = systemStub(env, systemId);
  const s = await headState(env, systemId);
  const g = await canonicalGenome(env, s);
  const gates: Record<string, GateCriterion[]> = {};
  for (const id of ids as string[]) {
    const c = await stub.candidate(id);
    if (!c) throw notFound(`unknown candidate ${id}`);
    const rec = await record(env, systemId, c.realization);
    const ref = (await storedCandidates(env, systemId, { evolutionId: rec.evolutionId })).find((x) => x.id === id)!;
    gates[id] = gateCriteria(g.model, await hookRef(env, systemId, ref));
    // Revalidate on the exact commit before the CAS: hooks re-run with promotionFacts (base-current, manifest-exact, evidence-fresh).
    if (["submitted", "evaluated", "selected"].includes(c.state) && s.head === body.expectedHead) {
      const { evaluations } = await evaluate(env, s, rec, ref, "promotion");
      if (evaluations.length) await stub.recordEvaluations(id, evaluations);
    }
  }
  const out = await stub.promote({ candidateIds: ids as string[], expectedHead: body.expectedHead as string | null, rationale, by: "admin", gates, ...manifestExtras(g.model) });
  if (!out.ok) {
    if (out.code === "stale-base") throw conflict("stale-base", "System head moved; reload and retry", { currentHead: out.currentHead });
    if ("blocking" in out) {
      const details = { blocking: out.blocking, advisories: out.advisories };
      if (out.code === "advisories-unacknowledged") {
        throw new HttpError(400, out.code, "advisory criteria are not green; acknowledge them with a non-empty rationale", details);
      }
      throw conflict("blocked", "blocking criteria (hard, with a bound hook) lack pass+completed evaluations", details);
    }
    if (out.code === "not-found") throw notFound(out.message);
    throw conflict(out.code, out.message);
  }
  await refreshRegistry(env, systemId);
  return { commit: out.commit, rejected: out.rejected, advisories: out.advisories };
}

export async function accept(
  env: Env, systemId: string, evolutionId: string,
  body: { realization?: unknown; realizationId?: unknown; rationale?: unknown; interpretation?: unknown },
) {
  const rid = typeof body.realizationId === "string" ? body.realizationId : typeof body.realization === "string" ? body.realization : undefined;
  if (!rid) throw badRequest("realizationId is required");
  const rationale = typeof body.interpretation === "string" ? body.interpretation : typeof body.rationale === "string" ? body.rationale : "";
  const stub = systemStub(env, systemId);
  const rec = await record(env, systemId, rid);
  if (rec.evolutionId !== evolutionId) throw badRequest(`realization ${rid} belongs to ${rec.evolutionId}`);
  if (rec.target !== "genome") throw conflict("invalid-state", "only genome realizations are accepted; promote app candidates");
  const candId = rec.realization.candidate;
  if (!candId) throw conflict("invalid-state", "realization has no submitted candidate");
  const cand = (await stub.candidate(candId))!;
  let g: LoadedGenome;
  try {
    g = await genomeAt(env, systemId, cand.commit, rec.forkRepo);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw unprocessable("invalid-genome", `candidate Genome does not load: ${(e as Error).message}`);
  }
  const out = await stub.accept({ realizationId: rid, rationale, by: "admin", evolutions: evolutionSeeds(g.model), ...manifestExtras(g.model) });
  if (!out.ok) {
    if (out.code === "not-found") throw notFound(out.message);
    throw conflict(out.code, out.message);
  }
  await refreshRegistry(env, systemId);
  return { genomeCommit: out.genomeCommit, realization: out.realization, commit: out.commit };
}

/** Admin: reject a realization (Genome amendments in the review panel). `reason` is required. */
export async function reject(env: Env, systemId: string, rid: string, body: { reason?: unknown }) {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw badRequest("reason is required");
  const realization = await rpc(systemStub(env, systemId).rejectRealization(rid, reason.slice(0, 4000)));
  await refreshRegistry(env, systemId);
  return { realization };
}

/** Find which System a realization id belongs to (registry index). */
export async function systemForRealization(env: Env, rid: string): Promise<string> {
  const hit = await registryStub(env).resolveRealization(rid);
  if (!hit) throw notFound(`unknown realization ${rid}`);
  return hit.systemId;
}

/** Queue consumer callbacks for the hooks slice's `createQueueHandler(queueContextFor)`. */
export function queueContextFor(env: Env): QueueContext {
  return {
    async resolveFork(namespace, repoName) {
      if (namespace !== env.ARTIFACTS_NAMESPACE) return null;
      return (await registryStub(env).resolveFork(repoName))?.realizationId ?? null;
    },
    submit: async (rid, commit, source) => submit(env, await systemForRealization(env, rid), rid, { commit }, source),
    markEventSeen: (id) => registryStub(env).markEventSeen(id),
  };
}
