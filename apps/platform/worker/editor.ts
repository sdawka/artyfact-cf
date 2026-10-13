/**
 * The in-browser editor's backend: list and read files at any ref, and turn a manual edit into a candidate on the
 * realization's fork through the same path agents use (push → checkpoint → submit → gates and CI dispatch).
 */
import type { EditorCommitRequest, EditorCommitResponse, FileResponse, FileScope, FilesResponse } from "../shared/api";
import { artifactsFor, remoteUrl, withRepo, type ArtifactsRepoLike, type TreeEntry } from "./artifacts/client";
import { genomePrefix, listTree } from "./artifacts/genome-source";
import { globMatch, nodesForPath, sourceMapFor } from "./artifacts/source-map";
import { declaredNodes, resolveRef, type ResolvedRef } from "./compare";
import { TERMINAL_REALIZATION, type HeadState } from "./do/system-authority";
import { badRequest, conflict, HttpError, notFound, unprocessable } from "./errors";
import { pathProblem, pushCommit, PushRejected, type AuthScheme, type FileChange } from "./git/push";
import { protectedPathsFor } from "./packets/task-packet";
import { eventIdOf } from "./hooks/queue";
import { checkpoint, genomeAt, registryStub, submit, systemStub } from "./service";

export const MAX_CHANGES = 50;
export const MAX_CHANGE_BYTES = 1_000_000;
/** Total content bytes per commit, and the request body cap: keeps the push's in-memory copies well under 128 MB. */
export const MAX_COMMIT_BYTES = 8_000_000;
export const READ_CAP_BYTES = 512 * 1024;
/** Write tokens for an editor commit live only as long as the push. */
export const COMMIT_TOKEN_TTL_S = 300;
const COMMIT_RE = /^[0-9a-f]{40}$/;

/** Git transport for pushes; tests install a fake receive-pack, a deployment may switch to Basic auth. */
let transport: { fetch?: typeof fetch; auth?: AuthScheme } = {};
export const gitTransport = () => ({ ...transport });
export function setEditorTransport(t: { fetch?: typeof fetch; auth?: AuthScheme } | undefined): void {
  transport = t ?? {};
}

async function headState(env: Env, systemId: string): Promise<HeadState> {
  const s = await systemStub(env, systemId).state();
  if (!s) throw notFound(`system ${systemId} is not imported`);
  return s;
}

export function parseScope(v: string | undefined): FileScope {
  if (v === undefined || v === "" || v === "app") return "app";
  if (v === "genome") return "genome";
  throw badRequest("scope must be app or genome");
}

/** A repo-relative file path the git layer accepts (see `pathProblem`). */
export function validPath(p: unknown): p is string {
  return typeof p === "string" && pathProblem(p) === null;
}

// ------------------------------------------------------------------ reads

export async function listFiles(env: Env, systemId: string, scope: FileScope, ref = "head"): Promise<FilesResponse> {
  const resolved = await resolveRef(env, await headState(env, systemId), scope, ref);
  const listing = await withRepo(artifactsFor(env), resolved.repo, (r) => listTree(r, resolved.commit));
  const files = [...listing].map(([path, e]) => ({ path, hash: e.hash })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const nodes = scope === "genome" ? await genomeNodes(env, systemId, resolved, files.map((f) => f.path)) : undefined;
  return { ref: resolved, files: nodes ? files.map((f) => ({ ...f, nodes: nodes[f.path] ?? [] })) : files };
}

/** Per Genome path, the node ids the Genome at `ref` declares in it; undefined when that Genome does not load. */
async function genomeNodes(env: Env, systemId: string, ref: ResolvedRef, paths: string[]): Promise<Record<string, string[]> | undefined> {
  try {
    return declaredNodes((await genomeAt(env, systemId, ref.commit, ref.repo)).model, paths);
  } catch {
    return undefined; // degraded: the files still list, without nodes
  }
}

/** The tree entry at `path` under `commit`, walking one tree per segment; null when absent or a directory. */
async function entryAt(repo: ArtifactsRepoLike, commit: string, path: string): Promise<TreeEntry | null> {
  const meta = await repo.readCommit(commit);
  if (!meta) throw unprocessable("unknown-commit", `commit ${commit} not found`);
  let tree = meta.treeHash;
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    const e = (await repo.readTree(tree))?.find((x) => x.name === parts[i]);
    if (!e) return null;
    if (i === parts.length - 1) return e.type === "tree" || e.type === "gitlink" ? null : e;
    if (e.type !== "tree") return null;
    tree = e.hash;
  }
  return null;
}

/** Binary when a NUL appears in the first 8000 bytes (git's heuristic) or the bytes are not valid UTF-8. */
export function sniffBinary(bytes: Uint8Array): boolean {
  if (bytes.subarray(0, 8000).includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return false;
  } catch {
    // A cut multi-byte character at the cap is not binary.
    if (bytes.length >= READ_CAP_BYTES) {
      for (let cut = 1; cut <= 3; cut++) {
        try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, bytes.length - cut)); return false; } catch { /* keep trying */ }
      }
    }
    return true;
  }
}

export async function readFileAt(env: Env, systemId: string, scope: FileScope, ref: string, path: string): Promise<FileResponse> {
  if (!validPath(path)) throw badRequest("path must be a repo-relative file path");
  const s = await headState(env, systemId);
  const resolved = await resolveRef(env, s, scope, ref);
  const out = await withRepo(artifactsFor(env), resolved.repo, async (repo) => {
    const e = await entryAt(repo, resolved.commit, path);
    if (!e) throw notFound(`no file ${path} at ${resolved.commit.slice(0, 12)} in ${resolved.repo}`);
    const blob = await repo.readBlob(e.hash);
    if (!blob) throw notFound(`blob ${e.hash} for ${path} is missing`);
    const size = blob.size;
    const head = new Uint8Array(await blob.slice(0, READ_CAP_BYTES).arrayBuffer());
    const binary = sniffBinary(head);
    const text = binary ? null : new TextDecoder().decode(head);
    let nodes: string[] | undefined;
    if (scope === "app") {
      const g = await genomeAt(env, systemId, s.genomeCommit, s.genomeSource);
      nodes = nodesForPath(sourceMapFor(g.model), path).filter((n) => !n.startsWith("unmapped:"));
    }
    return { hash: e.hash, size, text, binary, truncated: size > READ_CAP_BYTES, ...(nodes && { nodes }) };
  });
  const nodes = scope === "genome" ? (await genomeNodes(env, systemId, resolved, [path]))?.[path] : undefined;
  return { ref: resolved, path, ...out, ...(nodes && { nodes }) };
}

// ------------------------------------------------------------------ commit

interface ValidCommit { message: string; why: string; changes: FileChange[]; expectedHead?: string }

function validateCommit(body: Record<string, unknown>): ValidCommit {
  const b = body as Partial<EditorCommitRequest>;
  if (typeof b.message !== "string" || !b.message.trim()) throw badRequest("message is required");
  if (b.message.length > 4000) throw badRequest("message is longer than 4000 characters");
  if (b.why !== undefined && b.why !== null && typeof b.why !== "string") throw badRequest("why must be a string");
  if (b.expectedHead !== undefined && b.expectedHead !== null && (typeof b.expectedHead !== "string" || !COMMIT_RE.test(b.expectedHead))) {
    throw badRequest("expectedHead must be a 40-character hex sha");
  }
  if (!Array.isArray(b.changes) || b.changes.length === 0) throw badRequest("changes must be a non-empty array");
  if (b.changes.length > MAX_CHANGES) throw unprocessable("too-many-changes", `at most ${MAX_CHANGES} changes per commit (got ${b.changes.length})`);
  const seen = new Set<string>();
  let total = 0;
  const changes: FileChange[] = b.changes.map((c, i) => {
    const ch = c as { path?: unknown; content?: unknown } | null;
    if (!ch || typeof ch !== "object") throw badRequest(`changes[${i}] must be an object`);
    if (!validPath(ch.path)) throw unprocessable("invalid-path", `changes[${i}].path ${JSON.stringify(ch.path)} is not a repo-relative file path`);
    if (seen.has(ch.path)) throw unprocessable("invalid-path", `${ch.path} is changed twice`);
    seen.add(ch.path);
    if (ch.content !== null && typeof ch.content !== "string") throw badRequest(`changes[${i}].content must be a string or null`);
    if (typeof ch.content === "string") {
      const n = new TextEncoder().encode(ch.content).length;
      if (n > MAX_CHANGE_BYTES) throw unprocessable("file-too-large", `${ch.path} is ${n} bytes; the limit is ${MAX_CHANGE_BYTES}`);
      total += n;
      if (total > MAX_COMMIT_BYTES) throw unprocessable("commit-too-large", `the changes total more than ${MAX_COMMIT_BYTES} bytes`);
    }
    return { path: ch.path, content: ch.content };
  });
  return {
    message: b.message.trim(), why: (b.why ?? "").trim(), changes, ...(b.expectedHead && { expectedHead: b.expectedHead }),
  };
}

function pushError(e: PushRejected): HttpError {
  switch (e.code) {
    case "stale-head": return conflict("stale-head", `${e.message}; reload the file and commit again`);
    case "no-change": return unprocessable("no-change", e.message);
    case "path-conflict": return unprocessable("path-conflict", e.message);
    case "missing-path": case "invalid-path": return unprocessable("invalid-path", e.message);
    case "auth": return new HttpError(502, "push-auth", `Artifacts refused the commit's write token: ${e.message}`);
    default: return new HttpError(502, "push-failed", e.message);
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "editor";

/**
 * Commit an editor change to realization `rid`'s fork and submit it. The realization must be live; paths are checked
 * against the target (Genome prefix for a Genome realization, never a protected path). A write token is minted for
 * this push only (ttl 300 s) and always revoked. `why` is recorded on the candidate as its rationale.
 */
export async function commitEdit(env: Env, systemId: string, rid: string, body: Record<string, unknown>, by: string): Promise<EditorCommitResponse> {
  if(await systemStub(env,systemId).realizationPlanId(rid))throw conflict('invalid-state','Task Attempts must use lifecycle endpoints; direct editor writes are not allowed');
  const input = validateCommit(body);
  const stub = systemStub(env, systemId);
  const rec = await stub.realization(rid);
  if (!rec) throw notFound(`unknown realization ${rid}`);
  if (TERMINAL_REALIZATION.includes(rec.realization.status)) throw conflict("invalid-state", `realization ${rid} is ${rec.realization.status}`);
  const ns = artifactsFor(env);
  const protectedPaths = rec.packet?.protectedPaths ?? protectedPathsFor(rec.target);

  const pushed = await withRepo(ns, rec.forkRepo, async (repo) => {
    const [tip] = await repo.log({ limit: 1 });
    const parent = tip?.hash ?? rec.baseCommit;
    if (input.expectedHead && input.expectedHead !== parent) {
      throw conflict("stale-head", `the fork is at ${parent.slice(0, 12)}, not ${input.expectedHead.slice(0, 12)}; reload and commit again`, { head: parent });
    }
    const prefix = rec.target === "genome" ? await genomePrefix(repo, rec.baseCommit) : "";
    for (const c of input.changes) {
      const guarded = protectedPaths.find((g) => globMatch(g, c.path));
      if (guarded) throw unprocessable("protected-path", `${c.path} is protected (${guarded}) in a ${rec.target} realization`);
      if (prefix && !c.path.startsWith(`${prefix}/`)) throw unprocessable("outside-genome", `${c.path} is outside the Genome (${prefix}/)`);
    }
    // The editor reads at most READ_CAP_BYTES of a file; saving such a read back would truncate the file.
    for (const c of input.changes) {
      if (c.content === null) continue;
      const e = await entryAt(repo, parent, c.path);
      const size = e ? (await repo.readBlob(e.hash))?.size ?? 0 : 0;
      if (size > READ_CAP_BYTES) throw unprocessable("file-too-large-to-edit", `${c.path} is ${size} bytes; files over ${READ_CAP_BYTES} bytes cannot be edited in the browser`);
    }
    // The Git author is the realization's own label (`human:<name>`), never a name the caller picks.
    const name = rec.realization.agent.id.replace(/^human:/, "") || by;
    const token = await repo.createToken("write", COMMIT_TOKEN_TTL_S);
    try {
      return await pushCommit({
        remote: remoteUrl(env, rec.forkRepo, rec.packet?.workspace.remote), token: token.plaintext, repo, parent,
        changes: input.changes, author: { name, email: `${slug(name)}@editor.artyfact.invalid` }, message: input.message,
        ...(transport.fetch && { fetch: transport.fetch }), ...(transport.auth && { auth: transport.auth }),
      });
    } catch (e) {
      throw e instanceof PushRejected ? pushError(e) : e;
    } finally {
      await repo.revokeToken(token.id).catch((e: unknown) => console.error(`[editor] revoking the commit token for ${rid} failed: ${(e as Error)?.message ?? e}`));
    }
  });

  await checkpoint(env, systemId, rid, { summary: input.message, commit: pushed.commit });
  const submitted = await submit(env, systemId, rid, { commit: pushed.commit }, "ui");
  // Only now, with the candidate recorded, is the queue's delivery of this push redundant. If checkpoint or submit
  // failed above, the event stays unseen and the queue submits the commit (submit is idempotent per commit).
  await registryStub(env).markEventSeen(eventIdOf({ namespace: env.ARTIFACTS_NAMESPACE, repoName: rec.forkRepo, ref: "refs/heads/main", after: pushed.commit }));
  if (!(await stub.setCandidateRationale(submitted.candidate.id, input.why || null))) {
    console.error(`[editor] candidate ${submitted.candidate.id} of ${rid} vanished before its rationale was recorded`);
  }
  return { commit: pushed.commit, parent: pushed.parent, tree: pushed.tree, submitted };
}
