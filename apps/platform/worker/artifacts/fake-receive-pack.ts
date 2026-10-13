/**
 * A fake Git smart-HTTP server over FakeArtifacts. Receive-pack parses the pushed pack (node:zlib, deltas included),
 * stores every object under its real SHA-1 in the fake store, checks connectivity, and moves the repo head, so the
 * binding reads (`readCommit/readTree/readBlob/readFile`) serve what was pushed. Upload-pack serves a repo's objects
 * as an undeltified pack, so `git clone` and `git fetch` work against the FAKE_ARTIFACTS platform (protocol v0, no
 * side-band, no multi-ack).
 */
import { gunzipSync, inflateSync } from "node:zlib";
import type { CommitMeta } from "./client";
import { concatBytes, hashObject, parseCommit, parseTree, sha1Hex, toHex, type GitObject, type ObjectType } from "../git/objects";
import { buildPack } from "../git/pack";
import { FLUSH, parsePkts, pkt, pktText } from "../git/pkt-line";
import { gitObjectOf, type FakeArtifacts, type FakeRepo } from "./fake";

const TYPES: Record<number, ObjectType> = { 1: "commit", 2: "tree", 3: "blob" };
const OFS_DELTA = 6;
const REF_DELTA = 7;

/** Apply a Git delta (copy/insert instructions) to `base`. */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let i = 0;
  const varint = () => {
    let v = 0, shift = 0, b: number;
    do {
      b = delta[i++]!;
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return v;
  };
  if (varint() !== base.length) throw new Error("delta base size mismatch");
  const out = new Uint8Array(varint());
  let o = 0;
  while (i < delta.length) {
    const op = delta[i++]!;
    if (op & 0x80) {
      let off = 0, size = 0;
      for (let k = 0; k < 4; k++) if (op & (1 << k)) off += delta[i++]! * 2 ** (8 * k);
      for (let k = 0; k < 3; k++) if (op & (0x10 << k)) size += delta[i++]! * 2 ** (8 * k);
      if (size === 0) size = 0x10000;
      if (off + size > base.length || o + size > out.length) throw new Error("delta copy out of range");
      out.set(base.subarray(off, off + size), o);
      o += size;
    } else if (op) {
      if (o + op > out.length || i + op > delta.length) throw new Error("delta insert out of range");
      out.set(delta.subarray(i, i + op), o);
      i += op;
      o += op;
    } else throw new Error("delta opcode 0");
  }
  if (o !== out.length) throw new Error("delta result size mismatch");
  return out;
}

/**
 * Parse a v2 pack; verifies the header, object count and SHA-1 trailer. OFS and REF deltas are resolved against
 * earlier objects of the pack, or (thin packs) against `base`, the receiver's own objects.
 */
export async function parsePack(pack: Uint8Array, base?: (hash: string) => GitObject | undefined): Promise<GitObject[]> {
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  if (pack.length < 32 || new TextDecoder().decode(pack.subarray(0, 4)) !== "PACK") throw new Error("not a pack");
  if (view.getUint32(4) !== 2) throw new Error(`pack version ${view.getUint32(4)}`);
  const count = view.getUint32(8);
  const trailer = toHex(pack.subarray(pack.length - 20));
  if ((await sha1Hex(pack.subarray(0, pack.length - 20))) !== trailer) throw new Error("pack checksum mismatch");
  const out: GitObject[] = [];
  const byOffset = new Map<number, GitObject>();
  const byHash = new Map<string, GitObject>();
  const deferred: { at: number; baseHash: string; delta: Uint8Array }[] = [];
  const keep = async (at: number, o: GitObject) => {
    out.push(o);
    byOffset.set(at, o);
    byHash.set(await hashObject(o), o);
  };
  let i = 12;
  for (let n = 0; n < count; n++) {
    const at = i;
    let b = pack[i++]!;
    const code = (b >> 4) & 7;
    let size = b & 0x0f, shift = 4;
    while (b & 0x80) {
      b = pack[i++]!;
      size += (b & 0x7f) * 2 ** shift;
      shift += 7;
    }
    let baseAt: number | undefined, baseHash: string | undefined;
    if (code === OFS_DELTA) {
      let c = pack[i++]!;
      let ofs = c & 0x7f;
      while (c & 0x80) {
        c = pack[i++]!;
        ofs = (ofs + 1) * 128 + (c & 0x7f);
      }
      baseAt = at - ofs;
    } else if (code === REF_DELTA) {
      baseHash = toHex(pack.subarray(i, i + 20));
      i += 20;
    } else if (!TYPES[code]) throw new Error(`unsupported pack object type ${code}`);
    const r = inflateSync(pack.subarray(i, pack.length - 20), { info: true } as never) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
    if (r.buffer.length !== size) throw new Error(`object ${n}: inflated ${r.buffer.length} bytes, header says ${size}`);
    i += r.engine.bytesWritten;
    const data = new Uint8Array(r.buffer);
    if (baseAt !== undefined) {
      const src = byOffset.get(baseAt);
      if (!src) throw new Error(`object ${n}: no delta base at offset ${baseAt}`);
      await keep(at, { type: src.type, body: applyDelta(src.body, data) });
    } else if (baseHash !== undefined) {
      const src = byHash.get(baseHash) ?? base?.(baseHash);
      if (src) await keep(at, { type: src.type, body: applyDelta(src.body, data) });
      else deferred.push({ at, baseHash, delta: data });
    } else await keep(at, { type: TYPES[code]!, body: data });
  }
  if (i !== pack.length - 20) throw new Error(`pack has ${pack.length - 20 - i} trailing bytes`);
  // A REF delta may name a base that comes later in the pack.
  while (deferred.length) {
    const ready = deferred.findIndex((d) => byHash.has(d.baseHash) || !!base?.(d.baseHash));
    if (ready < 0) throw new Error(`missing delta base ${deferred[0]!.baseHash}`);
    const [d] = deferred.splice(ready, 1);
    const src = byHash.get(d!.baseHash) ?? base!(d!.baseHash)!;
    await keep(d!.at, { type: src.type, body: applyDelta(src.body, d!.delta) });
  }
  return out;
}

/** Every object reachable from `wants` (commits, their trees and blobs; gitlinks are not followed). */
function reachable(r: FakeRepo, wants: string[]): GitObject[] {
  const seen = new Set<string>();
  const out: GitObject[] = [];
  const stack = [...wants];
  while (stack.length) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    seen.add(h);
    const o = r.store.objects.get(h);
    if (!o) throw new Error(`missing object ${h}`);
    out.push(gitObjectOf(o));
    if (o.kind === "commit") stack.push(o.meta.treeHash, ...o.meta.parents);
    else if (o.kind === "tree") for (const e of o.entries) if (e.type !== "gitlink") stack.push(e.hash);
  }
  return out;
}

export interface ReceivedPush { repo: string; old: string; new: string; ref: string; capabilities: string[]; objects: { hash: string; type: ObjectType }[]; authorization: string | null }

export interface FakeReceivePack {
  fetch: typeof fetch;
  requests: { method: string; url: string; authorization: string | null; contentType: string | null }[];
  pushes: ReceivedPush[];
  /** Answer the next push with `ng <ref> <reason>` instead of updating. */
  rejectNext?: string;
  /** Advertise this id for refs/heads/main instead of the real head (simulates a racing writer). */
  advertiseHead?: string;
  /** Accept `Basic x-access-token:<token>` as well as Bearer. */
  acceptBasic: boolean;
}

const tokenOf = (authorization: string | null, basic: boolean): string | undefined => {
  const bearer = /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
  if (bearer) return bearer;
  const b64 = basic ? /^Basic (.+)$/.exec(authorization ?? "")?.[1] : undefined;
  if (!b64) return undefined;
  const [user, pass] = atob(b64).split(":");
  return user === "x-access-token" ? pass : undefined;
};

/** `repo` limits the fake to one repo; otherwise the repo is taken from the URL (`…/<repo>.git/…`). */
export function fakeReceivePack(ns: FakeArtifacts, repo?: string): FakeReceivePack {
  const state: FakeReceivePack = { requests: [], pushes: [], acceptBasic: true, fetch: undefined as never };
  const authorized = (r: FakeRepo, authorization: string | null, scope: "read" | "write" = "write") => {
    const token = tokenOf(authorization, state.acceptBasic);
    return !!token && r.tokens.some((t) => !t.revoked && (scope === "read" || t.scope === "write") && `secret-${t.id}` === token);
  };
  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const authorization = req.headers.get("authorization");
    state.requests.push({ method: req.method, url: req.url, authorization, contentType: req.headers.get("content-type") });
    const m = /\/([^/]+)\.git\/(info\/refs|git-receive-pack|git-upload-pack)$/.exec(url.pathname);
    if (!m || (repo && m[1] !== repo) || !ns.repos.has(m[1])) return new Response("not found", { status: 404 });
    const r = ns.repo(m[1]);
    const upload = m[2] === "git-upload-pack" || (m[2] === "info/refs" && url.searchParams.get("service") === "git-upload-pack");
    if (!authorized(r, authorization, upload ? "read" : "write")) return new Response("unauthorized", { status: 401 });
    if (upload) return uploadPack(r, req, m[2] === "info/refs");
    if (m[2] === "info/refs") {
      if (req.method !== "GET" || url.searchParams.get("service") !== "git-receive-pack") return new Response("bad request", { status: 400 });
      const head = state.advertiseHead ?? r.head ?? "0".repeat(40);
      const body = concatBytes([pkt("# service=git-receive-pack\n"), FLUSH, pkt(`${head} refs/heads/main\0report-status delete-refs ofs-delta agent=fake\n`), FLUSH]);
      return new Response(body, { headers: { "content-type": "application/x-git-receive-pack-advertisement" } });
    }
    if (req.method !== "POST" || req.headers.get("content-type") !== "application/x-git-receive-pack-request") return new Response("bad request", { status: 400 });
    const bytes = await requestBytes(req);
    const { pkts, rest } = parsePkts(bytes);
    const flush = pkts.indexOf(null);
    if (flush < 1) return new Response("no commands", { status: 400 });
    const [cmd, caps = ""] = pktText(pkts[0]!).split("\0");
    const [oldId, newId, ref] = cmd.split(" ");
    const report = (...lines: string[]) => new Response(concatBytes([...lines.map((l) => pkt(`${l}\n`)), FLUSH]), { headers: { "content-type": "application/x-git-receive-pack-result" } });

    let objects: GitObject[];
    try {
      objects = await parsePack(rest, (h) => {
        const o = r.store.objects.get(h);
        return o && gitObjectOf(o);
      });
    } catch (e) {
      return report(`unpack ${(e as Error).message}`, `ng ${ref} unpacker error`);
    }
    // Parse everything first; like real git's quarantine, nothing reaches the store unless the update is accepted.
    type Obj = Parameters<typeof r.store.objects.set>[1];
    const pending = new Map<string, Obj>();
    const stored: ReceivedPush["objects"] = [];
    for (const o of objects) {
      const hash = await hashObject(o);
      stored.push({ hash, type: o.type });
      if (o.type === "blob") pending.set(hash, { kind: "blob", text: new TextDecoder().decode(o.body), bytes: o.body });
      else if (o.type === "tree") pending.set(hash, { kind: "tree", entries: parseTree(o.body), raw: o.body });
      else {
        const c = parseCommit(o.body);
        const meta: CommitMeta = {
          hash, treeHash: c.tree, message: c.message, parents: c.parents,
          author: { name: c.author.name, email: c.author.email }, committer: { name: c.committer.name, email: c.committer.email },
          authoredAt: c.author.at, committedAt: c.committer.at,
        };
        pending.set(hash, { kind: "commit", meta, raw: o.body });
      }
    }
    state.pushes.push({ repo: r.name, old: oldId, new: newId, ref, capabilities: caps.split(" ").filter(Boolean), objects: stored, authorization });
    if (state.rejectNext) {
      const reason = state.rejectNext;
      state.rejectNext = undefined;
      return report("unpack ok", `ng ${ref} ${reason}`);
    }
    if (ref !== "refs/heads/main") return report("unpack ok", `ng ${ref} only refs/heads/main is writable here`);
    if (oldId !== (r.head ?? "0".repeat(40))) return report("unpack ok", `ng ${ref} stale ref`);
    // Connectivity: the new commit, its tree, its parents and every entry of the pushed trees must exist.
    const get = (h: string) => pending.get(h) ?? r.store.objects.get(h);
    const missing: string[] = [];
    const c = get(newId);
    if (c?.kind !== "commit") missing.push(newId);
    else {
      if (!get(c.meta.treeHash)) missing.push(c.meta.treeHash);
      for (const p of c.meta.parents) if (!get(p)) missing.push(p);
    }
    for (const o of pending.values()) {
      if (o.kind === "tree") for (const e of o.entries) if (e.type !== "gitlink" && !get(e.hash)) missing.push(e.hash);
    }
    if (missing.length) return report(`unpack missing objects ${missing.join(",")}`, `ng ${ref} missing necessary objects`);
    for (const [h, o] of pending) r.store.objects.set(h, o);
    r.head = newId;
    return report("unpack ok", `ok ${ref}`);
  }) as typeof fetch;
  return state;
}

/** The request body, gunzipped when git compressed it (it does for large upload-pack requests). */
async function requestBytes(req: Request): Promise<Uint8Array> {
  const bytes = new Uint8Array(await req.arrayBuffer());
  return req.headers.get("content-encoding") === "gzip" ? new Uint8Array(gunzipSync(bytes)) : bytes;
}

/** `info/refs?service=git-upload-pack` and `POST git-upload-pack`: refs, then `NAK` and a pack once the client is `done`. */
async function uploadPack(r: FakeRepo, req: Request, advertise: boolean): Promise<Response> {
  if (advertise) {
    if (req.method !== "GET") return new Response("bad request", { status: 400 });
    const refs = r.head
      ? [pkt(`${r.head} HEAD\0symref=HEAD:refs/heads/main agent=fake\n`), pkt(`${r.head} refs/heads/main\n`)]
      : [pkt(`${"0".repeat(40)} capabilities^{}\0agent=fake\n`)];
    return new Response(concatBytes([pkt("# service=git-upload-pack\n"), FLUSH, ...refs, FLUSH]), {
      headers: { "content-type": "application/x-git-upload-pack-advertisement", "cache-control": "no-cache" },
    });
  }
  if (req.method !== "POST" || req.headers.get("content-type") !== "application/x-git-upload-pack-request") return new Response("bad request", { status: 400 });
  const lines = parsePkts(await requestBytes(req)).pkts.filter((p): p is Uint8Array => p !== null).map(pktText);
  const wants = lines.filter((l) => l.startsWith("want ")).map((l) => l.slice(5, 45));
  const result = (parts: Uint8Array[]) => new Response(concatBytes(parts), { headers: { "content-type": "application/x-git-upload-pack-result", "cache-control": "no-cache" } });
  if (!lines.includes("done")) return result([pkt("NAK\n")]);
  let objects: GitObject[];
  try {
    objects = reachable(r, wants);
  } catch (e) {
    return result([pkt(`ERR ${(e as Error).message}\n`)]);
  }
  return result([pkt("NAK\n"), await buildPack(objects)]);
}
