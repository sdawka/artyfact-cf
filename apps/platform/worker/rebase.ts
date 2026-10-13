/**
 * Rebase-on-promote (backend.md B.5). Tasks of one wave are file-disjoint, so once one task's candidate is promoted
 * another's is rebased by replaying its diff onto the new head: a new commit on the realization's fork whose parent
 * is the fork tip and whose tree is the head tree plus the candidate's changed paths (removed paths deleted). The
 * realization moves onto the head (DO `rebaseRealization`), then the commit is submitted so every hook runs again.
 */
import type { RebaseResponse } from "../shared/api";
import { artifactsFor, remoteUrl, withRepo, type ArtifactsRepoLike, type TreeEntry } from "./artifacts/client";
import { diffTrees, diffTreesAcross, type TreeDiff } from "./artifacts/candidates";
import { TERMINAL_REALIZATION } from "./do/system-authority";
import { editorTransport } from "./editor";
import { conflict, fromRpc, HttpError, notFound } from "./errors";
import { encodeBlob, encodeTree, type EntryKind, type GitObject } from "./git/objects";
import { pushCommit, PushRejected, type FileChange } from "./git/push";
import { PLATFORM_WRITTEN } from "./hooks/diff-scope";
import { eventIdOf } from "./hooks/queue";
import { registryStub, submit, systemStub } from "./service";

/** Write tokens for a rebase push live only as long as the push. */
export const REBASE_TOKEN_TTL_S = 300;
/** Trailer naming the candidate commit a rebase commit replays; lets a retry build on a stranded earlier attempt. */
export const REBASE_TRAILER = "Artyfact-Rebase-Of";
const OPEN = ["submitted", "evaluated", "selected"];

const platformWritten = (p: string) => PLATFORM_WRITTEN.some((g) => (g.endsWith("/**") ? p.startsWith(g.slice(0, -2)) : p === g));
const changed = (d: TreeDiff) => [...d.added, ...d.modified, ...d.removed];

async function rpc<T>(p: Promise<T> | T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw fromRpc(e) ?? e;
  }
}

const TRAILER_RE = new RegExp(`^${REBASE_TRAILER}: ([0-9a-f]{40})$`, "gm");

/** The candidate commit a rebase commit's message names (its last trailer), if any. */
export function rebasedFrom(message: string): string | null {
  return [...message.matchAll(TRAILER_RE)].at(-1)?.[1] ?? null;
}

/** A commit message without rebase trailers, for embedding in the next rebase's message. */
const withoutTrailers = (message: string) => message.replace(TRAILER_RE, "").replace(/\n{3,}/g, "\n\n").trim();

async function treeOf(repo: ArtifactsRepoLike, commit: string): Promise<string> {
  const meta = await repo.readCommit(commit);
  if (!meta) throw new HttpError(502, "missing-commit", `commit ${commit} not found`);
  return meta.treeHash;
}

/** The file entry at `path` under `tree` (one tree read per segment); null when absent or not a file. */
async function entryAt(repo: ArtifactsRepoLike, tree: string, path: string): Promise<TreeEntry | null> {
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

async function blobBytes(repo: ArtifactsRepoLike, hash: string, path: string): Promise<Uint8Array> {
  const blob = await repo.readBlob(hash);
  if (!blob) throw new HttpError(502, "missing-blob", `blob ${hash} (${path}) not found`);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Objects of `tree` (read from `src`) that the target repo may lack: every tree and blob not at the same path with
 * the same id in `have` (the fork tip's tree, which the fork holds). A fork does not see commits pushed to another
 * fork, so the head's objects travel in the pack; ones the repo already has are harmless.
 */
export async function carry(src: ArtifactsRepoLike, dst: ArtifactsRepoLike, tree: string, have: string | null, out: GitObject[], base = ""): Promise<void> {
  if (tree === have) return;
  const entries = await src.readTree(tree);
  if (!entries) throw new HttpError(502, "missing-tree", `tree ${tree} (${base || "/"}) not found`);
  const theirs = new Map(((have && (await dst.readTree(have))) || []).map((e) => [e.name, e] as const));
  out.push(encodeTree(entries.map((e) => ({ name: e.name, hash: e.hash, mode: e.mode, type: e.type as EntryKind }))));
  for (const e of entries) {
    const t = theirs.get(e.name);
    if (e.type === "tree") await carry(src, dst, e.hash, t?.type === "tree" ? t.hash : null, out, `${base}${e.name}/`);
    else if (e.type !== "gitlink" && t?.hash !== e.hash) out.push(encodeBlob(await blobBytes(src, e.hash, base + e.name)));
  }
}

function pushError(e: PushRejected): HttpError {
  switch (e.code) {
    case "stale-head": return conflict("stale-head", `${e.message}; the fork moved during the rebase, rebase again`);
    case "path-conflict": case "missing-path": return conflict("rebase-conflict", e.message, { paths: [] });
    case "auth": return new HttpError(502, "push-auth", `Artifacts refused the rebase's write token: ${e.message}`);
    default: return new HttpError(502, "push-failed", e.message);
  }
}

/**
 * `POST /systems/:id/realizations/:rid/rebase` (admin). Preconditions: an app realization that has not ended, an open
 * candidate (its latest), a base behind the System head (409 `up-to-date`), no stored `file` conflict against a
 * promoted candidate and no path the head changed since the candidate's base (409 `rebase-conflict` with `paths`;
 * the files the platform writes into every clone are exempt), and a fork tip that is the candidate commit or an
 * earlier rebase of it (409 `invalid-state` otherwise: unsubmitted work would be dropped).
 */
export async function rebase(env: Env, systemId: string, rid: string): Promise<RebaseResponse> {
  const stub = systemStub(env, systemId);
  const rec = await stub.realization(rid);
  if (!rec) throw notFound(`unknown realization ${rid}`);
  if (TERMINAL_REALIZATION.includes(rec.realization.status)) throw conflict("invalid-state", `realization ${rid} is ${rec.realization.status}`);
  if (rec.target !== "app") throw conflict("invalid-state", `realization ${rid} is a Genome realization; Genome amendments are accepted, not rebased`);
  const cand = (await stub.candidates({ realizationId: rid })).find((c) => OPEN.includes(c.state));
  if (!cand) throw conflict("invalid-state", `realization ${rid} has no open candidate; submit before rebasing`);
  const s = await stub.state();
  if (!s) throw notFound(`system ${systemId} is not imported`);
  if (!s.head || !s.appSource) throw conflict("invalid-state", `system ${systemId} has no promoted app to rebase onto`);
  if (rec.realization.baseRevision === s.head) {
    throw conflict("up-to-date", `${cand.id} is already built on the System head ${s.head?.slice(0, 12) ?? "(none)"}`);
  }
  const head = { systemCommit: s.head, repo: s.appSource.repo, commit: s.appSource.commit };
  const manifest = (await stub.candidateManifest(cand.id)) as { baseCommit?: string } | null;
  const candBase = manifest?.baseCommit || rec.baseCommit;
  const stored = await stub.rebaseConflictPaths(cand.id);
  const ns = artifactsFor(env);

  const pushed = await withRepo(ns, rec.forkRepo, (fork) => withRepo(ns, head.repo, async (headRepo) => {
    const diff = await diffTrees(fork, candBase, cand.commit);
    const moved = new Set(changed(await diffTreesAcross({ repo: fork, commit: candBase }, { repo: headRepo, commit: head.commit })));
    const overlap = changed(diff).filter((p) => moved.has(p) && !platformWritten(p));
    const paths = [...new Set([...stored, ...overlap])].sort();
    if (paths.length) {
      throw conflict("rebase-conflict", `${cand.id} and the System head both change ${paths.join(", ")}; rebase by hand and submit`, { paths });
    }

    const [tip] = await fork.log({ limit: 1 });
    if (!tip) throw new HttpError(502, "missing-commit", `${rec.forkRepo} has no commits`);
    if (tip.hash !== cand.commit && rebasedFrom(tip.message) !== cand.commit) {
      throw conflict("invalid-state", `${rec.forkRepo} has commits after ${cand.commit.slice(0, 12)} that were never submitted; submit them, then rebase`, { tip: tip.hash });
    }

    const candTree = await treeOf(fork, cand.commit);
    const headTree = await treeOf(headRepo, head.commit);
    const changes: FileChange[] = [];
    for (const p of [...diff.added, ...diff.modified]) {
      const e = await entryAt(fork, candTree, p);
      if (!e) throw conflict("rebase-conflict", `${p} is not a regular file, executable or symlink at ${cand.commit.slice(0, 12)} (a submodule?); rebase by hand`, { paths: [p] });
      // Always the candidate's kind: dropping the exec bit or replacing a symlink is part of its diff.
      changes.push({ path: p, content: await blobBytes(fork, e.hash, p), type: e.type as "blob" | "exec" | "symlink" });
    }
    // A path the head no longer has: only a platform-written file can get here (any other was an overlap above).
    for (const p of diff.removed) if (await entryAt(headRepo, headTree, p)) changes.push({ path: p, content: null });

    const include: GitObject[] = [];
    await carry(headRepo, fork, headTree, await treeOf(fork, tip.hash), include);
    const meta = (await fork.readCommit(cand.commit))!;
    const message = `Rebase ${cand.commit.slice(0, 12)} onto ${head.systemCommit}\n\n${withoutTrailers(meta.message)}\n\n${REBASE_TRAILER}: ${cand.commit}\n`;
    const transport = editorTransport();
    const token = await fork.createToken("write", REBASE_TOKEN_TTL_S);
    try {
      return await pushCommit({
        remote: remoteUrl(env, rec.forkRepo, rec.packet?.workspace.remote), token: token.plaintext, repo: fork, parent: tip.hash,
        changes, base: { repo: headRepo, tree: headTree }, include, author: meta.author, message,
        // The queue would otherwise submit this commit too, possibly before the realization moved onto the head.
        beforeSend: (commit) => registryStub(env).markEventSeen(eventIdOf({ namespace: env.ARTIFACTS_NAMESPACE, repoName: rec.forkRepo, ref: "refs/heads/main", after: commit })).then(() => undefined),
        ...(transport.fetch && { fetch: transport.fetch }), ...(transport.auth && { auth: transport.auth }),
      });
    } catch (e) {
      throw e instanceof PushRejected ? pushError(e) : e;
    } finally {
      await fork.revokeToken(token.id).catch((e: unknown) => console.error(`[rebase] revoking the push token for ${rid} failed: ${(e as Error)?.message ?? e}`));
    }
  }));

  await rpc(stub.rebaseRealization(rid, { baseCommit: head.commit, baseHead: head.systemCommit, baseRepo: head.repo }));
  const submitted = await submit(env, systemId, rid, { commit: pushed.commit }, "ui");
  return { realization: submitted.realization, commit: pushed.commit, submitted };
}
