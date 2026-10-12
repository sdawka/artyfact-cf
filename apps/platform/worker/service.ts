/**
 * Orchestration between Artifacts, the model, hooks and the SystemAuthority DO. Routes and the queue
 * consumer call these; all Artifacts I/O and model work happens here (never inside the DO).
 */
import { diffModels, type schema, type SystemModel } from "@artyfact/model";
import { templateFile } from "@artyfact/templates";
import { parse as parseYaml } from "yaml";
import type {
  CandidatesResponse, ConflictReport, Evolution, ImportSystemResponse, ModelBundle, PacketResponse, PromoteResponse,
  ReadinessResponse, RealizationResponse, StartWorkRequest, StartWorkResponse, SubmitResponse, SyncResponse,
} from "../shared/api";
import { artifactsFor, forkAndWait, remoteUrl, withRepo, type ArtifactsRepoLike } from "./artifacts/client";
import { buildCandidateManifest, type CandidateManifest } from "./artifacts/candidates";
import { buildGenome, genomePrefix, listTree, memoGenome, readGenomeFiles, type LoadedGenome } from "./artifacts/genome-source";
import { loadSourceMap, type SourceMapEntry } from "./artifacts/source-map";
import { REGISTRY, type SystemAuthority, type EvolutionSeed, type HeadState, type ManifestExtras, type RealizationRecord } from "./do/system-authority";
import { badRequest, conflict, fromRpc, HttpError, notFound, unprocessable } from "./errors";
import type { CandidateRef, ModelAtBase, SubmitSource } from "./hooks/contract";
import { hookRunner } from "./hooks/index";
import { readinessReport, serializeModel } from "./model-bundle";
import { buildTaskPacket, protectedPathsFor, requiredCriteria } from "./packets/task-packet";

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

export async function importSystem(env: Env, body: { systemId?: unknown; genomeRepo?: unknown; appRepo?: unknown }): Promise<ImportSystemResponse> {
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
  const system = await stub.bootstrap({
    systemId, title: g.model.system.name, phase: g.model.system.phase, genomeRepo, appRepo, genomeCommit, appCommit,
    evolutions: evolutionSeeds(g.model), ...manifestExtras(g.model),
  });
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
    return { revision: rev, genomeCommit: c.manifest.genomeCommit, repo: s.genomeSource, candidateIds: c.candidates };
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
  return m.evolutions.find((e) => e.id === dto.id) ?? ({ ...dto, decision: dto.decision?.rationale } as unknown as schema.Evolution);
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
  try {
    await registryStub(env).registerRealization(rid, systemId, reserved.forkRepo);
    const ns = artifactsFor(env);
    const forked = await forkAndWait(ns, reserved.baseRepo, reserved.forkRepo);
    const token = await withRepo(ns, reserved.forkRepo, (r) => r.createToken("write", TOKEN_TTL_S));
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
    return { systemId, realization, packet, token: { value: token.plaintext, expiresAt: token.expiresAt, remote }, remote };
  } catch (e) {
    await stub.abandonRealization(rid);
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
  return { systemId, realization: rec.realization, ...(candidate && { candidate }), evaluations, conflicts };
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

async function candidateRefs(env: Env, systemId: string, filter: { open?: boolean; evolutionId?: string } = { open: true }): Promise<CandidateRef[]> {
  const stub = systemStub(env, systemId);
  const cands = await stub.candidates(filter);
  return Promise.all(cands.map(async (c) => {
    const m = ((await stub.candidateManifest(c.id)) ?? {}) as Partial<CandidateManifest> & { genomeDelta?: CandidateRef["genomeDelta"] };
    return {
      realizationId: c.realization, evolutionId: c.evolution, target: m.target ?? "app", repo: m.repo ?? "", baseRepo: m.baseRepo ?? "",
      baseCommit: m.baseCommit ?? "", commit: c.commit, changedPaths: c.changedPaths, changedNodes: c.changedSubjects,
      diff: m.diff ?? { added: [], modified: [], removed: [] }, ...(m.previewUrl && { previewUrl: m.previewUrl }),
      ...(m.genomeDelta && { genomeDelta: m.genomeDelta }),
      id: c.id, state: c.state, submittedAt: c.submittedAt,
    };
  }));
}

async function baseModel(env: Env, s: HeadState): Promise<ModelAtBase> {
  const g = await canonicalGenome(env, s);
  return { genomeCommit: s.genomeCommit, model: g.model, readiness: g.readiness };
}

async function conflictsFor(env: Env, systemId: string, candidateId?: string): Promise<ConflictReport[]> {
  const s = await headState(env, systemId);
  const open = await candidateRefs(env, systemId);
  const candidate = candidateId ? open.find((c) => c.id === candidateId) : undefined;
  if (candidateId && !candidate) return [];
  return hookRunner(env).conflicts({ env, systemId, base: await baseModel(env, s), ...(candidate && { candidate }), openCandidates: open });
}

export const conflicts = (env: Env, systemId: string) => conflictsFor(env, systemId);

/** Run hooks for a recorded candidate and store their evaluations. */
async function evaluate(env: Env, s: HeadState, rec: RealizationRecord, cand: CandidateRef, trigger: "submission" | "promotion") {
  const stub = systemStub(env, s.systemId);
  const base = await baseModel(env, s);
  const evoDto = await stub.evolution(rec.evolutionId);
  const evolution = modelEvolution(base.model, evoDto ?? ({ id: rec.evolutionId, acceptanceCriteria: [], affectedNodes: [] } as unknown as Evolution));
  const critById = new Map(base.model.criteria.map((c) => [c.id, c] as const));
  const others = (await candidateRefs(env, s.systemId)).filter((c) => c.id !== cand.id);
  const runner = hookRunner(env);
  const ns = artifactsFor(env);
  return withRepo(ns, rec.forkRepo, async (repo) => {
    const common = {
      env, systemId: s.systemId, trigger, candidate: cand, realization: rec.realization, evolution, base,
      acceptanceCriteria: evolution.acceptanceCriteria.map((id) => critById.get(id)).filter((c): c is schema.Criterion => !!c),
      requiredCriteria: requiredCriteria(base.model, evolution, rec.target),
      permittedPaths: rec.packet?.permittedPaths ?? [], protectedPaths: rec.packet?.protectedPaths ?? protectedPathsFor(rec.target),
      sourceMap: rec.target === "app" ? await sourceMapFor(base.model, repo, rec.baseCommit) : [],
      otherCandidates: others, ...(cand.previewUrl && { previewUrl: cand.previewUrl }), repo,
    };
    if (rec.target === "genome") {
      const [baseFiles, candidateFiles] = await Promise.all([readGenomeFiles(repo, rec.baseCommit), readGenomeFiles(repo, cand.commit)]);
      const review = await runner.runGenome({ ...common, baseFiles, candidateFiles });
      return { evaluations: review.evaluations, status: "awaiting-admin" as const };
    }
    let listing: Map<string, { hash: string }> | undefined;
    const files = async () => (listing ??= await listTree(repo, cand.commit));
    const evaluations = await runner.runSubmission({
      ...common,
      listFiles: async () => [...(await files()).keys()],
      readFile: async (path) => (await (await repo.readFile({ ref: cand.commit, path }))?.text()) ?? null,
      fileSize: async (path) => {
        const e = (await files()).get(path);
        return e ? ((await repo.readBlob(e.hash))?.size ?? null) : null;
      },
    });
    return { evaluations, status: "evaluated" as const };
  });
}

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
    const manifest = await withRepo(ns, rec.forkRepo, async (repo) => {
      if (!(await repo.readCommit(commit))) throw unprocessable("unknown-commit", `commit ${commit} not found in ${rec.forkRepo}; push before submitting`);
      const input = { realizationId: rid, evolutionId: rec.evolutionId, target: rec.target, repo: rec.forkRepo, baseRepo: rec.baseRepo, baseCommit: rec.baseCommit, commit, ...(previewUrl && { previewUrl }) };
      if (rec.target === "app") {
        const base = await canonicalGenome(env, s);
        return { ...(await buildCandidateManifest(repo, input, await sourceMapFor(base.model, repo, rec.baseCommit))) };
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
    const out = await rpc(stub.recordCandidate({ realizationId: rid, commit, manifest, changedPaths: manifest.changedPaths, changedNodes: manifest.changedNodes }));
    if (out.created) {
      const ref = (await candidateRefs(env, systemId, { evolutionId: rec.evolutionId })).find((c) => c.id === out.candidate.id)!;
      const { evaluations, status } = await evaluate(env, s, rec, ref, "submission");
      await stub.recordEvaluations(out.candidate.id, evaluations, status);
    }
    existing = out.candidate;
  } else if ((await stub.evaluations(existing.id)).length === 0 && rec.realization.status === "evaluating") {
    // A retry after hooks failed mid-way: run them again.
    const ref = (await candidateRefs(env, systemId, { evolutionId: rec.evolutionId })).find((c) => c.id === existing!.id)!;
    const { evaluations, status } = await evaluate(env, s, rec, ref, "submission");
    await stub.recordEvaluations(existing.id, evaluations, status);
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
  const required: Record<string, string[]> = {};
  for (const id of ids as string[]) {
    const c = await stub.candidate(id);
    if (!c) throw notFound(`unknown candidate ${id}`);
    const rec = await record(env, systemId, c.realization);
    const evoDto = await stub.evolution(rec.evolutionId);
    const evolution = modelEvolution(g.model, evoDto!);
    required[id] = requiredCriteria(g.model, evolution, rec.target);
    // Revalidate on the exact commit before the CAS (exists + scope, per hooks with a promotion trigger).
    if (["submitted", "evaluated", "selected"].includes(c.state) && s.head === body.expectedHead) {
      const ref = (await candidateRefs(env, systemId, { evolutionId: rec.evolutionId })).find((x) => x.id === id)!;
      const { evaluations } = await evaluate(env, s, rec, ref, "promotion");
      if (evaluations.length) await stub.recordEvaluations(id, evaluations);
    }
  }
  const out = await stub.promote({ candidateIds: ids as string[], expectedHead: body.expectedHead as string | null, rationale, by: "admin", required, ...manifestExtras(g.model) });
  if (!out.ok) {
    if (out.code === "stale-base") throw conflict("stale-base", "System head moved; reload and retry", { currentHead: out.currentHead });
    if (out.code === "blocked") throw conflict("blocked", "required criteria lack pass+completed evaluations", { blocking: out.blocking });
    if (out.code === "not-found") throw notFound(out.message);
    throw conflict(out.code, out.message);
  }
  await refreshRegistry(env, systemId);
  return { commit: out.commit, rejected: out.rejected };
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

/** Find which System a realization id belongs to (registry index). */
export async function systemForRealization(env: Env, rid: string): Promise<string> {
  const hit = await registryStub(env).resolveRealization(rid);
  if (!hit) throw notFound(`unknown realization ${rid}`);
  return hit.systemId;
}
