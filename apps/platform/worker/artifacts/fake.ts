/** In-memory Artifacts namespace (tests and the FAKE_ARTIFACTS=1 boot mode) implementing ArtifactsRepoLike with Git objects under their real ids. */
import { createHash } from "node:crypto";
import { encodeCommit, encodeTree, rawObject, type GitObject } from "../git/objects";
import type { ArtifactsNamespaceLike, ArtifactsRepoLike, CommitMeta, TreeEntry } from "./client";

/** Git's blob id (SHA-1 of `blob <size>\0<content>`), so seeded blobs and blobs pushed through the fake receive-pack share ids. */
export function gitBlobHash(text: string): string {
  const body = new TextEncoder().encode(text);
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

/**
 * `bytes`, when set, is the blob's exact content (binary-safe); `text` is its UTF-8 reading. `raw`, when set, is a
 * tree's or commit's exact Git body as it was pushed, so serving it back over git keeps its id.
 */
type Obj = { kind: "blob"; text: string; bytes?: Uint8Array } | { kind: "tree"; entries: TreeEntry[]; raw?: Uint8Array } | { kind: "commit"; meta: CommitMeta; raw?: Uint8Array };

/** The Git object a stored object stands for: its pushed body when known, else its canonical encoding. */
export function gitObjectOf(o: Obj): GitObject {
  if (o.kind === "blob") return { type: "blob", body: o.bytes ?? new TextEncoder().encode(o.text) };
  if (o.raw) return { type: o.kind, body: o.raw };
  if (o.kind === "tree") return encodeTree(o.entries.map((e) => ({ name: e.name, hash: e.hash, mode: e.mode })));
  const m = o.meta;
  return encodeCommit({
    tree: m.treeHash, parents: m.parents, message: m.message,
    author: { ...m.author, at: m.authoredAt }, committer: { ...m.committer, at: m.committedAt },
  });
}

class Store {
  objects = new Map<string, Obj>();
  /** Every object gets its real Git id (SHA-1), so the fake repos can be cloned and pushed with git itself. */
  put(o: Obj): string {
    const h = o.kind === "blob" ? gitBlobHash(o.text) : createHash("sha1").update(rawObject(gitObjectOf(o))).digest("hex");
    this.objects.set(h, o);
    return h;
  }
  writeTree(files: Map<string, string>, prefix = ""): string {
    const here = new Map<string, string>();
    const dirs = new Map<string, Map<string, string>>();
    for (const [p, t] of files) {
      const i = p.indexOf("/");
      if (i < 0) here.set(p, t);
      else {
        const d = p.slice(0, i);
        if (!dirs.has(d)) dirs.set(d, new Map());
        dirs.get(d)!.set(p.slice(i + 1), t);
      }
    }
    const entries: TreeEntry[] = [];
    for (const [name, text] of here) entries.push({ name, mode: "100644", type: "blob", hash: this.put({ kind: "blob", text }) });
    for (const [name, sub] of dirs) entries.push({ name, mode: "40000", type: "tree", hash: this.writeTree(sub, `${prefix}${name}/`) });
    return this.put({ kind: "tree", entries: encodeOrder(entries) });
  }
}

/** Git's tree order (a tree's name compares as `name/`). */
function encodeOrder(entries: TreeEntry[]): TreeEntry[] {
  const key = (e: TreeEntry) => (e.type === "tree" ? `${e.name}/` : e.name);
  return [...entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export class FakeRepo implements ArtifactsRepoLike {
  head: string | null = null;
  tokens: { id: string; scope: string; ttl?: number; revoked?: boolean }[] = [];
  calls: string[] = [];
  readyAfter = 0;
  constructor(readonly ns: FakeArtifacts, readonly name: string, readonly store: Store, readonly source: string | null = null) {}

  commit(files: Record<string, string> | Map<string, string>, message = "commit"): string {
    const map = files instanceof Map ? files : new Map(Object.entries(files));
    const treeHash = this.store.writeTree(map);
    const n = this.ns.clock++;
    const meta: CommitMeta = {
      hash: "", treeHash, message,
      author: { name: "t", email: "t@example.com" }, committer: { name: "t", email: "t@example.com" },
      parents: this.head ? [this.head] : [], authoredAt: n, committedAt: n,
    };
    meta.hash = this.store.put({ kind: "commit", meta });
    this.head = meta.hash;
    return meta.hash;
  }

  /** Drop a commit object (simulates a force-push/GC losing the submitted commit). */
  forget(hash: string): void {
    this.store.objects.delete(hash);
  }

  async info() {
    this.calls.push("info");
    const status = this.readyAfter > 0 ? (this.readyAfter--, "forking") : "ready";
    return { id: this.name, name: this.name, defaultBranch: "main", remote: this.ns.remoteOf(this.name), source: this.source, readOnly: false, lastPushAt: null, status };
  }
  async createToken(scope: "write" | "read" = "write", ttl?: number) {
    const id = `tok-${this.name}-${this.tokens.length + 1}`;
    this.tokens.push({ id, scope, ttl });
    return { id, plaintext: `secret-${id}`, scope, expiresAt: new Date(Date.now() + (ttl ?? 86400) * 1000).toISOString() };
  }
  async revokeToken(id: string) {
    const t = this.tokens.find((x) => x.id === id);
    if (t) t.revoked = true;
    return !!t;
  }
  async fork(name: string) {
    this.calls.push(`fork:${name}`);
    if (this.ns.repos.has(name)) throw Object.assign(new Error("exists"), { code: "ALREADY_EXISTS" });
    const f = new FakeRepo(this.ns, name, this.store, `artifacts:artyfact/${this.name}`);
    f.head = this.head;
    f.readyAfter = this.ns.forkDelayPolls;
    this.ns.repos.set(name, f);
    return { id: name, name, defaultBranch: "main", remote: this.ns.remoteOf(name), token: "unused" };
  }
  async log(opts: { ref?: string; limit?: number } = {}) {
    const out: CommitMeta[] = [];
    let h: string | undefined = opts.ref && opts.ref !== "HEAD" && opts.ref !== "main" ? opts.ref : this.head ?? undefined;
    while (h && out.length < (opts.limit ?? 50)) {
      const o = this.store.objects.get(h);
      if (o?.kind !== "commit") break;
      out.push(o.meta);
      h = o.meta.parents[0];
    }
    return out;
  }
  async readCommit(hash: string) {
    this.calls.push(`readCommit:${hash.slice(0, 7)}`);
    const o = this.store.objects.get(hash);
    return o?.kind === "commit" ? o.meta : null;
  }
  async readTree(hash: string) {
    this.calls.push(`readTree:${hash.slice(0, 7)}`);
    const o = this.store.objects.get(hash);
    return o?.kind === "tree" ? o.entries : null;
  }
  async readBlob(hash: string) {
    this.calls.push(`readBlob:${hash.slice(0, 7)}`);
    const o = this.store.objects.get(hash);
    return o?.kind === "blob" ? (o.bytes ? new Blob([o.bytes as Uint8Array<ArrayBuffer>]) : new Blob([o.text])) : null;
  }
  async readFile({ ref, path }: { ref: string; path: string }) {
    this.calls.push(`readFile:${path}`);
    const c = this.store.objects.get(ref === "main" || ref === "HEAD" ? this.head ?? "" : ref);
    if (c?.kind !== "commit") return null;
    let tree = c.meta.treeHash;
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const t = this.store.objects.get(tree);
      if (t?.kind !== "tree") return null;
      const e = t.entries.find((x) => x.name === parts[i]);
      if (!e) return null;
      if (i === parts.length - 1) return this.readBlob(e.hash);
      tree = e.hash;
    }
    return null;
  }
}

export class FakeArtifacts implements ArtifactsNamespaceLike {
  repos = new Map<string, FakeRepo>();
  store = new Store();
  clock = 1_700_000_000;
  forkDelayPolls = 0;
  /** The git remote of each repo is `<remoteBase>/<name>.git` (the FAKE_ARTIFACTS boot sets one the CLI accepts). */
  remoteBase = "https://fake";
  remoteOf(name: string): string {
    return `${this.remoteBase}/${name}.git`;
  }
  create(name: string): FakeRepo {
    const r = new FakeRepo(this, name, this.store);
    this.repos.set(name, r);
    return r;
  }
  repo(name: string): FakeRepo {
    const r = this.repos.get(name);
    if (!r) throw new Error(`no fake repo ${name}`);
    return r;
  }
  async get(name: string) {
    const r = this.repos.get(name);
    if (!r) throw Object.assign(new Error(`repo ${name} not found`), { code: "NOT_FOUND" });
    return r;
  }
}
