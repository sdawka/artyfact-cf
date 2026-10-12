/** In-memory Artifacts namespace implementing ArtifactsRepoLike with git-like content-addressed objects. */
import type { ArtifactsNamespaceLike, ArtifactsRepoLike, CommitMeta, TreeEntry } from "../../worker/artifacts/client";

/** Deterministic 40-hex id (not SHA-1, but the same shape). */
export function fakeHash(text: string): string {
  let out = "";
  for (let seed = 0; out.length < 40; seed++) {
    let h = 0x811c9dc5 ^ seed;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
}

type Obj = { kind: "blob"; text: string } | { kind: "tree"; entries: TreeEntry[] } | { kind: "commit"; meta: CommitMeta };

class Store {
  objects = new Map<string, Obj>();
  put(o: Obj, key: string): string {
    const h = fakeHash(key);
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
    for (const [name, text] of here) entries.push({ name, mode: "100644", type: "blob", hash: this.put({ kind: "blob", text }, `blob:${text}`) });
    for (const [name, sub] of dirs) entries.push({ name, mode: "40000", type: "tree", hash: this.writeTree(sub, `${prefix}${name}/`) });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    return this.put({ kind: "tree", entries }, `tree:${JSON.stringify(entries)}`);
  }
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
    meta.hash = this.store.put({ kind: "commit", meta }, `commit:${treeHash}:${meta.parents.join(",")}:${message}:${n}`);
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
    return { id: this.name, name: this.name, defaultBranch: "main", remote: `https://fake/${this.name}.git`, source: this.source, readOnly: false, lastPushAt: null, status };
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
    return { id: name, name, defaultBranch: "main", remote: `https://fake/${name}.git`, token: "unused" };
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
    const o = this.store.objects.get(hash);
    return o?.kind === "blob" ? new Blob([o.text]) : null;
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
