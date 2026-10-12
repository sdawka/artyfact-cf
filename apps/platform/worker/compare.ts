/**
 * Revision resolution and comparisons across System commits, candidates and forks (Changelog, Compare, revision
 * pickers, the editor's commit base). All Artifacts reads happen here, never in the DO.
 */
import type { SystemCommit } from "../shared/api";
import { artifactsErrorCode, artifactsFor, withRepo } from "./artifacts/client";
import type { HeadState } from "./do/system-authority";
import { badRequest, notFound, unprocessable } from "./errors";
import { systemStub, type SystemApi } from "./service";

export type RefScope = "app" | "genome";

/**
 * A revision string resolved to a repo + commit for one scope (the app or the Genome). `systemCommit` is the System
 * commit the revision is (or is based on); `candidate` the candidate it names, when it names one.
 */
export interface ResolvedRef {
  ref: string;
  repo: string;
  commit: string;
  systemCommit?: string;
  candidate?: string;
}

const COMMIT_RE = /^[0-9a-f]{40}$/;
const SC_RE = /^sc-(\d+)(-[0-9a-f]{8})?$/;
const CANDIDATE_RE = /^candidate\.[\w.-]+$/;
const REALIZATION_RE = /^realization\.[\w.-]+$/;

/** The app binding of a System commit (the platform binds one worker-fullstack artifact). */
function appBinding(c: SystemCommit): { repo: string; commit: string } {
  const b = c.manifest[0] ?? Object.values(c.composition?.artifacts ?? {})[0];
  if (!b?.repo || !b.commit) throw unprocessable("no-app-binding", `System commit ${c.id} binds no app artifact`);
  return { repo: b.repo, commit: b.commit };
}

/**
 * Repo holding Genome commit `commit`: the fork of the Genome candidate that produced it (accepted amendments live in
 * their fork), else the imported Genome repo.
 */
async function genomeRepoFor(stub: SystemApi, head: HeadState, commit: string): Promise<string> {
  if (commit === head.genomeCommit) return head.genomeSource;
  const known = await stub.revisionOfCommit(commit);
  if (known && "candidate" in known) {
    const c = await stub.candidate(known.candidate);
    const rec = c && (await stub.realization(c.realization));
    if (rec?.target === "genome") return rec.forkRepo;
  }
  return head.genomeRepo;
}

/** A System commit by full id (`sc-3-1a2b3c4d`) or by sequence (`sc-3`). */
export async function findSystemCommit(stub: SystemApi, id: string): Promise<SystemCommit | null> {
  const exact = await stub.systemCommit(id);
  if (exact) return exact;
  const m = SC_RE.exec(id);
  if (!m || m[2]) return null;
  return (await stub.history()).find((c) => c.id.startsWith(`sc-${m[1]}-`)) ?? null;
}

async function atSystemCommit(stub: SystemApi, head: HeadState, scope: RefScope, ref: string, c: SystemCommit): Promise<ResolvedRef> {
  if (scope === "app") return { ref, ...appBinding(c), systemCommit: c.id };
  return { ref, repo: await genomeRepoFor(stub, head, c.genomeCommit), commit: c.genomeCommit, systemCommit: c.id };
}

function atHead(head: HeadState, scope: RefScope, ref: string): ResolvedRef {
  const sc = head.head ? { systemCommit: head.head } : {};
  if (scope === "app") return { ref, repo: head.appSource.repo, commit: head.appSource.commit, ...sc };
  return { ref, repo: head.genomeSource, commit: head.genomeCommit, ...sc };
}

/** Scope `scope` as of the System commit a realization was based on (the head when it has none). */
async function atBase(stub: SystemApi, head: HeadState, scope: RefScope, ref: string, baseRevision: string | null): Promise<ResolvedRef> {
  const base = baseRevision ? await stub.systemCommit(baseRevision) : null;
  return base ? atSystemCommit(stub, head, scope, ref, base) : atHead(head, scope, ref);
}

async function atCandidate(stub: SystemApi, head: HeadState, scope: RefScope, ref: string, id: string): Promise<ResolvedRef> {
  const c = await stub.candidate(id);
  if (!c) throw notFound(`unknown candidate ${id}`);
  const rec = await stub.realization(c.realization);
  if (!rec) throw notFound(`candidate ${id} names unknown realization ${c.realization}`);
  // A candidate of the other scope leaves this one as it was at the candidate's base.
  if (rec.target !== scope) return { ...(await atBase(stub, head, scope, ref, c.baseRevision || null)), candidate: id };
  return { ref, repo: rec.forkRepo, commit: c.commit, ...(c.baseRevision && { systemCommit: c.baseRevision }), candidate: id };
}

async function atRealization(env: Env, stub: SystemApi, head: HeadState, scope: RefScope, ref: string): Promise<ResolvedRef> {
  const rec = await stub.realization(ref);
  if (!rec) throw notFound(`unknown realization ${ref}`);
  const baseRevision = rec.realization.baseRevision ?? null;
  if (rec.target !== scope) return atBase(stub, head, scope, ref, baseRevision);
  // The realization's fork head; a fork that is gone or empty is still at its base commit.
  const [tip] = await withRepo(artifactsFor(env), rec.forkRepo, (r) => r.log({ limit: 1 })).catch((e: unknown) => {
    if (artifactsErrorCode(e) === "NOT_FOUND") return [];
    throw e;
  });
  const commit = tip?.hash ?? rec.baseCommit;
  const cand = (await stub.candidates({ realizationId: ref })).find((c) => c.commit === commit);
  return { ref, repo: tip ? rec.forkRepo : rec.baseRepo, commit, ...(baseRevision && { systemCommit: baseRevision }), ...(cand && { candidate: cand.id }) };
}

/** A recorded 40-hex commit: a candidate's, or one a System commit binds. Never read from Artifacts unrecorded. */
async function atCommit(stub: SystemApi, head: HeadState, scope: RefScope, sha: string): Promise<ResolvedRef> {
  const known = await stub.revisionOfCommit(sha);
  if (known && "candidate" in known) return atCandidate(stub, head, scope, sha, known.candidate);
  if (scope === "app" && sha === head.appSource.commit) return atHead(head, scope, sha);
  if (scope === "genome" && sha === head.genomeCommit) return atHead(head, scope, sha);
  // Oldest first: the System commit that first bound this commit.
  const history = (await stub.history()).reverse();
  const own = history.find((c) => (scope === "app" ? c.manifest.some((b) => b.commit === sha) : c.genomeCommit === sha));
  if (own) return { ...(await atSystemCommit(stub, head, scope, sha, own)), commit: sha };
  // A commit of the other scope names the System commit that bound it.
  const other = history.find((c) => (scope === "app" ? c.genomeCommit === sha : c.manifest.some((b) => b.commit === sha)));
  if (other) return atSystemCommit(stub, head, scope, sha, other);
  throw notFound(`commit ${sha} is not recorded in ${head.systemId} (System commits or candidates)`);
}

/**
 * Resolve `ref` for `scope`: `head` (or `canonical`), a System commit (`sc-N` or its full id), a candidate id, a
 * recorded 40-hex commit, or a realization id (its fork head). 400 for a malformed ref, 404 for an unknown one.
 */
export async function resolveRef(env: Env, head: HeadState, scope: RefScope, ref: string): Promise<ResolvedRef> {
  const stub = systemStub(env, head.systemId);
  if (ref === "head" || ref === "canonical" || (head.head && ref === head.head)) return atHead(head, scope, ref);
  if (SC_RE.test(ref)) {
    const c = await findSystemCommit(stub, ref);
    if (!c) throw notFound(`unknown System commit ${ref}`);
    return atSystemCommit(stub, head, scope, ref, c);
  }
  if (CANDIDATE_RE.test(ref)) return atCandidate(stub, head, scope, ref, ref);
  if (COMMIT_RE.test(ref)) return atCommit(stub, head, scope, ref);
  if (REALIZATION_RE.test(ref)) return atRealization(env, stub, head, scope, ref);
  throw badRequest(`malformed ref ${JSON.stringify(ref.slice(0, 80))}: use head, sc-N, a candidate id, a 40-hex commit or a realization id`);
}
