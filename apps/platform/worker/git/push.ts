/**
 * Write a commit to an Artifacts repo from inside the Worker. The binding only reads, so a commit is built here
 * (blobs, rewritten trees, the commit) and sent over Git smart HTTP `git-receive-pack` (protocol v1) with a
 * short-lived write token. Untouched subtrees are reused by hash, so the pack carries only what changed.
 */
import type { ArtifactsRepoLike, TreeEntry } from "../artifacts/client";
import { buildPack } from "./pack";
import { concatBytes, encodeBlob, encodeCommit, encodeTree, hashObject, type EntryKind, type GitObject, type TreeItem } from "./objects";
import { FLUSH, demuxSideband, parsePkts, pkt, pktText } from "./pkt-line";

/** One edit: new file content, or null to delete the file. */
export interface FileChange { path: string; content: string | Uint8Array | null }

export type PushRejectCode = "stale-head" | "auth" | "rejected" | "unpack" | "protocol" | "no-change" | "missing-path" | "path-conflict" | "invalid-path";

export class PushRejected extends Error {
  constructor(readonly code: PushRejectCode, message: string, readonly status?: number) {
    super(message);
    this.name = "PushRejected";
  }
}

export const ZERO_ID = "0".repeat(40);
const EMPTY_TREE: GitObject = encodeTree([]);

export const MAX_PATH_BYTES = 4096;
export const MAX_SEGMENT_BYTES = 255;
const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/**
 * Why `path` cannot name a file in a tree, or null when it can: empty, absolute, too long, or a segment that is
 * empty, `.`, `..`, `.git` (any case), longer than 255 bytes, or contains a backslash or NUL.
 */
export function pathProblem(path: string): string | null {
  if (typeof path !== "string" || !path) return "is empty";
  if (path.startsWith("/")) return "is absolute";
  if (utf8Length(path) > MAX_PATH_BYTES) return `is longer than ${MAX_PATH_BYTES} bytes`;
  for (const seg of path.split("/")) {
    if (!seg) return "has an empty segment";
    if (seg === "." || seg === "..") return `has a ${seg} segment`;
    if (seg.toLowerCase() === ".git") return "has a .git segment";
    if (/[\\\0]/.test(seg)) return "contains a backslash or NUL";
    if (utf8Length(seg) > MAX_SEGMENT_BYTES) return `has a segment longer than ${MAX_SEGMENT_BYTES} bytes`;
  }
  return null;
}

type Node = { file: string | Uint8Array | null } | { dir: Map<string, Node> };

function changeTree(changes: FileChange[]): Map<string, Node> {
  const root = new Map<string, Node>();
  for (const c of changes) {
    const problem = pathProblem(c.path);
    if (problem) throw new PushRejected("invalid-path", `path ${JSON.stringify(String(c.path).slice(0, 200))} ${problem}`);
    const parts = c.path.split("/");
    let here = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const existing = here.get(name);
      if (i === parts.length - 1) {
        if (existing) throw new PushRejected("path-conflict", `path ${c.path} is changed twice, or both as a file and a directory`);
        here.set(name, { file: c.content });
      } else {
        if (existing && "file" in existing) throw new PushRejected("path-conflict", `path ${parts.slice(0, i + 1).join("/")} is changed both as a file and a directory`);
        if (!existing) here.set(name, { dir: new Map() });
        here = (here.get(name) as { dir: Map<string, Node> }).dir;
      }
    }
  }
  return root;
}

const asItem = (e: TreeEntry): TreeItem => ({ name: e.name, hash: e.hash, type: e.type as EntryKind, mode: e.mode });

/**
 * Apply `changes` to the tree `treeHash` (null = empty). Returns the new root tree id and the objects that must be
 * sent (new blobs and every rewritten tree along an edited path). Unchanged subtrees keep their ids and are not
 * read; a directory left empty is pruned; an executable or symlink file keeps its mode when its content changes.
 */
export async function rewriteTree(repo: ArtifactsRepoLike, treeHash: string | null, changes: FileChange[]): Promise<{ tree: string; objects: GitObject[]; changed: boolean }> {
  const objects = new Map<string, GitObject>();
  const add = async (o: GitObject) => {
    const h = await hashObject(o);
    objects.set(h, o);
    return h;
  };

  async function rewrite(tree: string | null, edits: Map<string, Node>, base: string): Promise<{ hash: string | null; changed: boolean }> {
    const listed = tree ? await repo.readTree(tree) : [];
    if (!listed) throw new Error(`tree ${tree} (at ${base || "/"}) not found`);
    const items = new Map<string, TreeItem>(listed.map((e) => [e.name, asItem(e)]));
    let changed = false;
    for (const [name, node] of edits) {
      const path = base + name;
      const cur = items.get(name);
      if ("file" in node) {
        if (node.file === null) {
          if (!cur || cur.type === "tree") throw new PushRejected("missing-path", `cannot delete ${path}: no such file`);
          items.delete(name);
          changed = true;
          continue;
        }
        // Writing a file where a directory stands would silently drop everything under it.
        if (cur?.type === "tree") throw new PushRejected("path-conflict", `${path} is a directory; it cannot be written as a file`);
        const hash = await add(encodeBlob(node.file));
        const type: EntryKind = cur?.type === "exec" || cur?.type === "symlink" ? cur.type : "blob";
        if (cur && cur.hash === hash && cur.type === type) continue;
        items.set(name, { name, hash, type });
        changed = true;
      } else {
        // Writing under an existing file would silently turn that file into a directory.
        if (cur && cur.type !== "tree") throw new PushRejected("path-conflict", `${path} is a file; nothing can be written under it`);
        const sub = await rewrite(cur?.type === "tree" ? cur.hash : null, node.dir, `${path}/`);
        if (!sub.changed && cur?.type === "tree") continue;
        changed = true;
        if (sub.hash) items.set(name, { name, hash: sub.hash, type: "tree" });
        else if (cur?.type === "tree") items.delete(name);
      }
    }
    if (!changed) return { hash: tree, changed: false };
    if (items.size === 0) return { hash: null, changed: true };
    return { hash: await add(encodeTree([...items.values()])), changed: true };
  }

  const out = await rewrite(treeHash, changeTree(changes), "");
  const tree = out.hash ?? (await add(EMPTY_TREE));
  return { tree, objects: [...objects.values()], changed: out.changed };
}

export type AuthScheme = "bearer" | "basic";

/** Artifacts documents Bearer write tokens; Basic `x-access-token:<token>` is the conventional Git fallback. */
export function authHeader(token: string, scheme: AuthScheme = "bearer"): string {
  return scheme === "basic" ? `Basic ${btoa(`x-access-token:${token}`)}` : `Bearer ${token}`;
}

export interface PushCommitOptions {
  /** The repo's Git remote, `https://…/<repo>.git`. */
  remote: string;
  token: string;
  /** Read handle on the same repo (parent commit and trees). */
  repo: ArtifactsRepoLike;
  parent: string;
  changes: FileChange[];
  author: { name: string; email: string };
  message: string;
  ref?: string;
  auth?: AuthScheme;
  fetch?: typeof fetch;
  /** Seconds since the epoch for author/committer time. */
  now?: number;
}

export interface PushCommitResult { commit: string; parent: string; tree: string; objects: number }

/** Parse a receive-pack ref advertisement into ref → id (capabilities dropped). */
export function parseAdvertisement(bytes: Uint8Array): Map<string, string> {
  const refs = new Map<string, string>();
  for (const p of parsePkts(bytes).pkts) {
    if (!p) continue;
    const line = pktText(p);
    if (line.startsWith("#")) continue;
    const [head] = line.split("\0");
    const m = /^([0-9a-f]{40}) (\S+)$/.exec(head);
    if (m && m[2] !== "capabilities^{}") refs.set(m[2], m[1]);
  }
  return refs;
}

/** Refusals meaning "the ref moved": git's own wording and Artifacts' (`ng refs/heads/main stale ref`). */
const STALE = /non-fast-forward|fetch first|\bstale\b|cannot lock|failed to lock/i;

/** Read a report-status response (plain or side-banded) and throw on anything but `unpack ok` + `ok <ref>`. */
export function checkReport(bytes: Uint8Array, ref: string): void {
  let { pkts } = parsePkts(bytes);
  if (pkts.some((p) => p && p.length && p[0] <= 3 && p[0] >= 1)) {
    const band = demuxSideband(pkts);
    if (band.error) throw new PushRejected("rejected", `remote error: ${band.error.trim()}`);
    pkts = parsePkts(band.data).pkts;
  }
  const lines = pkts.filter((p): p is Uint8Array => !!p).map(pktText);
  const unpack = lines.find((l) => l.startsWith("unpack "));
  if (!unpack) throw new PushRejected("protocol", `no report-status in the receive-pack response: ${JSON.stringify(lines.slice(0, 3))}`);
  if (unpack !== "unpack ok") throw new PushRejected("unpack", `remote could not unpack: ${unpack.slice(7)}`);
  const ng = lines.find((l) => l.startsWith(`ng ${ref} `));
  if (ng) {
    const reason = ng.slice(`ng ${ref} `.length);
    throw new PushRejected(STALE.test(reason) ? "stale-head" : "rejected", `push of ${ref} refused: ${reason}`);
  }
  if (!lines.includes(`ok ${ref}`)) throw new PushRejected("protocol", `receive-pack did not confirm ${ref}: ${JSON.stringify(lines)}`);
}

async function expectOk(res: Response, what: string): Promise<Uint8Array> {
  if (res.status === 401 || res.status === 403) throw new PushRejected("auth", `${what}: HTTP ${res.status} (write token refused)`, res.status);
  if (!res.ok) throw new PushRejected("protocol", `${what}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Build a commit of `changes` on top of `parent` and push it to `ref` (default `refs/heads/main`):
 * GET info/refs (the ref must still be `parent`, else `stale-head`), then POST git-receive-pack with the update
 * command and an undeltified pack, then check the report-status.
 */
export async function pushCommit(o: PushCommitOptions): Promise<PushCommitResult> {
  const ref = o.ref ?? "refs/heads/main";
  const transport = o.fetch ?? fetch;
  // A network failure is a push failure like any other (the caller still revokes its token).
  const doFetch: typeof fetch = async (input, init) => {
    try {
      return await transport(input, init);
    } catch (e) {
      throw new PushRejected("protocol", `could not reach the Git remote: ${(e as Error)?.message ?? e}`);
    }
  };
  const headers = { authorization: authHeader(o.token, o.auth), "user-agent": "git/artyfact" };
  const base = o.remote.replace(/\/+$/, "");

  const parentMeta = await o.repo.readCommit(o.parent);
  if (!parentMeta) throw new PushRejected("stale-head", `parent commit ${o.parent} not found`);
  const rewritten = await rewriteTree(o.repo, parentMeta.treeHash, o.changes);
  if (!rewritten.changed) throw new PushRejected("no-change", "the changes leave every file as it is");
  const at = o.now ?? Math.floor(Date.now() / 1000);
  const commitObj = encodeCommit({ tree: rewritten.tree, parents: [o.parent], author: { ...o.author, at }, message: o.message });
  const commit = await hashObject(commitObj);

  const adv = await expectOk(await doFetch(`${base}/info/refs?service=git-receive-pack`, { headers }), "ref advertisement");
  const current = parseAdvertisement(adv).get(ref) ?? ZERO_ID;
  if (current !== o.parent) throw new PushRejected("stale-head", `${ref} is at ${current.slice(0, 12)}, not ${o.parent.slice(0, 12)}`);

  const pack = await buildPack([...rewritten.objects, commitObj]);
  const body = concatBytes([pkt(`${o.parent} ${commit} ${ref}\0report-status\n`), FLUSH, pack]);
  const res = await doFetch(`${base}/git-receive-pack`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/x-git-receive-pack-request", accept: "application/x-git-receive-pack-result" },
    body,
  });
  checkReport(await expectOk(res, "receive-pack"), ref);
  return { commit, parent: o.parent, tree: rewritten.tree, objects: rewritten.objects.length + 1 };
}
