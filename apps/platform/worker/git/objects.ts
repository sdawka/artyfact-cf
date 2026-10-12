/**
 * Git loose-object encoding (blob, tree, commit) and SHA-1 object ids, for building commits inside the Worker.
 * Artifacts accepts writes only over Git smart HTTP, so the editor builds real objects and pushes them (see push.ts).
 */

export type ObjectType = "blob" | "tree" | "commit";
/** An object's type and body (no `<type> <len>\0` header); its id is `hashObject`. */
export interface GitObject { type: ObjectType; body: Uint8Array }

const enc = new TextEncoder();
const dec = new TextDecoder();

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2) throw new Error(`not hex: ${hex}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha1Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", data));
}

export async function sha1Hex(data: Uint8Array | string): Promise<string> {
  return toHex(await sha1Bytes(typeof data === "string" ? enc.encode(data) : data));
}

/** The object as stored loose (before zlib): `<type> <len>\0<body>`. */
export function rawObject(o: GitObject): Uint8Array {
  return concatBytes([enc.encode(`${o.type} ${o.body.length}\0`), o.body]);
}

export function hashObject(o: GitObject): Promise<string> {
  return sha1Hex(rawObject(o));
}

export function encodeBlob(content: string | Uint8Array): GitObject {
  return { type: "blob", body: typeof content === "string" ? enc.encode(content) : content };
}

/** Binding tree-entry types (client.ts `TreeEntryType`) and the canonical Git mode of each. */
export type EntryKind = "tree" | "blob" | "exec" | "symlink" | "gitlink";
const MODE_OF: Record<EntryKind, string> = { tree: "40000", blob: "100644", exec: "100755", symlink: "120000", gitlink: "160000" };

export interface TreeItem { name: string; hash: string; mode?: string; type?: EntryKind }

/**
 * The canonical Git mode for an entry. The binding's `type` decides the kind (exec and symlink preserved); a raw
 * `mode` is normalised the way Git does (`040000` → `40000`, any non-exec regular file → `100644`).
 */
export function normalizeMode(e: { mode?: string; type?: EntryKind }): string {
  if (e.type) return MODE_OF[e.type];
  const m = (e.mode ?? "").replace(/^0+/, "");
  if (m === "40000") return m;
  if (m === "120000" || m === "160000") return m;
  if (/^100\d{3}$/.test(m)) return parseInt(m.slice(3), 8) & 0o111 ? "100755" : "100644";
  throw new Error(`unsupported tree entry mode ${e.mode ?? "(none)"}`);
}

export function kindOfMode(mode: string): EntryKind {
  const m = normalizeMode({ mode });
  return (Object.entries(MODE_OF).find(([, v]) => v === m)![0]) as EntryKind;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Git's tree order: byte-wise by name, where a tree's name compares as `name/`. */
export function sortTreeItems<T extends TreeItem>(items: T[]): T[] {
  const key = (e: T) => enc.encode(normalizeMode(e) === "40000" ? `${e.name}/` : e.name);
  return [...items].sort((a, b) => compareBytes(key(a), key(b)));
}

export function encodeTree(items: TreeItem[]): GitObject {
  const seen = new Set<string>();
  const parts: Uint8Array[] = [];
  for (const e of sortTreeItems(items)) {
    if (!e.name || e.name.includes("/") || e.name.includes("\0") || e.name === "." || e.name === "..") throw new Error(`invalid tree entry name ${JSON.stringify(e.name)}`);
    if (seen.has(e.name)) throw new Error(`duplicate tree entry ${e.name}`);
    seen.add(e.name);
    parts.push(enc.encode(`${normalizeMode(e)} ${e.name}\0`), fromHex(e.hash));
  }
  return { type: "tree", body: concatBytes(parts) };
}

export function parseTree(body: Uint8Array): { name: string; mode: string; type: EntryKind; hash: string }[] {
  const out: { name: string; mode: string; type: EntryKind; hash: string }[] = [];
  let i = 0;
  while (i < body.length) {
    const sp = body.indexOf(0x20, i);
    const nul = body.indexOf(0, sp);
    if (sp < 0 || nul < 0 || nul + 21 > body.length) throw new Error("truncated tree object");
    const mode = dec.decode(body.subarray(i, sp));
    out.push({ mode, type: kindOfMode(mode), name: dec.decode(body.subarray(sp + 1, nul)), hash: toHex(body.subarray(nul + 1, nul + 21)) });
    i = nul + 21;
  }
  return out;
}

export interface Signature { name: string; email: string; /** Seconds since the epoch. */ at: number; /** `+hhmm` / `-hhmm`, default `+0000`. */ tz?: string }
export interface CommitInput { tree: string; parents: string[]; author: Signature; committer?: Signature; message: string }

/** Names and emails may not carry the characters that delimit them in the header. */
const clean = (s: string) => s.replace(/[<>\n\r\0]/g, "").trim();
const sig = (s: Signature) => `${clean(s.name) || "unknown"} <${clean(s.email)}> ${Math.floor(s.at)} ${s.tz ?? "+0000"}`;

export function encodeCommit(c: CommitInput): GitObject {
  const lines = [`tree ${c.tree}`, ...c.parents.map((p) => `parent ${p}`), `author ${sig(c.author)}`, `committer ${sig(c.committer ?? c.author)}`];
  const message = c.message.endsWith("\n") ? c.message : `${c.message}\n`;
  return { type: "commit", body: enc.encode(`${lines.join("\n")}\n\n${message}`) };
}

export interface ParsedCommit {
  tree: string;
  parents: string[];
  author: { name: string; email: string; at: number; tz: string };
  committer: { name: string; email: string; at: number; tz: string };
  message: string;
}

export function parseCommit(body: Uint8Array): ParsedCommit {
  const text = dec.decode(body);
  const split = text.indexOf("\n\n");
  const header = split < 0 ? text : text.slice(0, split);
  const message = split < 0 ? "" : text.slice(split + 2);
  const parseSig = (v: string) => {
    const m = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(v);
    if (!m) throw new Error(`bad signature ${v}`);
    return { name: m[1], email: m[2], at: Number(m[3]), tz: m[4] };
  };
  let tree = "";
  const parents: string[] = [];
  let author: ParsedCommit["author"] | undefined, committer: ParsedCommit["committer"] | undefined;
  for (const line of header.split("\n")) {
    const sp = line.indexOf(" ");
    const k = line.slice(0, sp), v = line.slice(sp + 1);
    if (k === "tree") tree = v;
    else if (k === "parent") parents.push(v);
    else if (k === "author") author = parseSig(v);
    else if (k === "committer") committer = parseSig(v);
  }
  if (!tree || !author || !committer) throw new Error("malformed commit object");
  return { tree, parents, author, committer, message };
}
