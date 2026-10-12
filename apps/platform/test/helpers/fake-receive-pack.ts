/**
 * A fake Git smart-HTTP receive-pack over FakeArtifacts. It parses the pushed pack (node:zlib), stores every object
 * under its real SHA-1 in the fake store, checks connectivity, and moves the repo head, so the binding reads
 * (`readCommit/readTree/readBlob/readFile`) serve what was pushed.
 */
import { inflateSync } from "node:zlib";
import type { CommitMeta } from "../../worker/artifacts/client";
import { concatBytes, hashObject, parseCommit, parseTree, sha1Hex, toHex, type GitObject, type ObjectType } from "../../worker/git/objects";
import { FLUSH, parsePkts, pkt, pktText } from "../../worker/git/pkt-line";
import type { FakeArtifacts, FakeRepo } from "./fake-artifacts";

const TYPES: Record<number, ObjectType> = { 1: "commit", 2: "tree", 3: "blob" };

/** Parse an undeltified v2 pack; verifies the header, object count and SHA-1 trailer. */
export async function parsePack(pack: Uint8Array): Promise<GitObject[]> {
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  if (pack.length < 32 || new TextDecoder().decode(pack.subarray(0, 4)) !== "PACK") throw new Error("not a pack");
  if (view.getUint32(4) !== 2) throw new Error(`pack version ${view.getUint32(4)}`);
  const count = view.getUint32(8);
  const trailer = toHex(pack.subarray(pack.length - 20));
  if ((await sha1Hex(pack.subarray(0, pack.length - 20))) !== trailer) throw new Error("pack checksum mismatch");
  const out: GitObject[] = [];
  let i = 12;
  for (let n = 0; n < count; n++) {
    let b = pack[i++];
    const code = (b >> 4) & 7;
    let size = b & 0x0f, shift = 4;
    while (b & 0x80) {
      b = pack[i++];
      size += (b & 0x7f) * 2 ** shift;
      shift += 7;
    }
    const type = TYPES[code];
    if (!type) throw new Error(`unsupported pack object type ${code} (deltas are not expected)`);
    const r = inflateSync(pack.subarray(i, pack.length - 20), { info: true } as never) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
    if (r.buffer.length !== size) throw new Error(`object ${n}: inflated ${r.buffer.length} bytes, header says ${size}`);
    out.push({ type, body: new Uint8Array(r.buffer) });
    i += r.engine.bytesWritten;
  }
  if (i !== pack.length - 20) throw new Error(`pack has ${pack.length - 20 - i} trailing bytes`);
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
  const authorized = (r: FakeRepo, authorization: string | null) => {
    const token = tokenOf(authorization, state.acceptBasic);
    return !!token && r.tokens.some((t) => !t.revoked && t.scope === "write" && `secret-${t.id}` === token);
  };
  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const authorization = req.headers.get("authorization");
    state.requests.push({ method: req.method, url: req.url, authorization, contentType: req.headers.get("content-type") });
    const m = /\/([^/]+)\.git\/(info\/refs|git-receive-pack)$/.exec(url.pathname);
    if (!m || (repo && m[1] !== repo) || !ns.repos.has(m[1])) return new Response("not found", { status: 404 });
    const r = ns.repo(m[1]);
    if (!authorized(r, authorization)) return new Response("unauthorized", { status: 401 });
    if (m[2] === "info/refs") {
      if (req.method !== "GET" || url.searchParams.get("service") !== "git-receive-pack") return new Response("bad request", { status: 400 });
      const head = state.advertiseHead ?? r.head ?? "0".repeat(40);
      const body = concatBytes([pkt("# service=git-receive-pack\n"), FLUSH, pkt(`${head} refs/heads/main\0report-status delete-refs ofs-delta agent=fake\n`), FLUSH]);
      return new Response(body, { headers: { "content-type": "application/x-git-receive-pack-advertisement" } });
    }
    if (req.method !== "POST" || req.headers.get("content-type") !== "application/x-git-receive-pack-request") return new Response("bad request", { status: 400 });
    const bytes = new Uint8Array(await req.arrayBuffer());
    const { pkts, rest } = parsePkts(bytes);
    const flush = pkts.indexOf(null);
    if (flush < 1) return new Response("no commands", { status: 400 });
    const [cmd, caps = ""] = pktText(pkts[0]!).split("\0");
    const [oldId, newId, ref] = cmd.split(" ");
    const report = (...lines: string[]) => new Response(concatBytes([...lines.map((l) => pkt(`${l}\n`)), FLUSH]), { headers: { "content-type": "application/x-git-receive-pack-result" } });

    let objects: GitObject[];
    try {
      objects = await parsePack(rest);
    } catch (e) {
      return report(`unpack ${(e as Error).message}`, `ng ${ref} unpacker error`);
    }
    const stored: ReceivedPush["objects"] = [];
    for (const o of objects) {
      const hash = await hashObject(o);
      stored.push({ hash, type: o.type });
      if (o.type === "blob") r.store.objects.set(hash, { kind: "blob", text: new TextDecoder().decode(o.body) });
      else if (o.type === "tree") r.store.objects.set(hash, { kind: "tree", entries: parseTree(o.body) });
      else {
        const c = parseCommit(o.body);
        const meta: CommitMeta = {
          hash, treeHash: c.tree, message: c.message, parents: c.parents,
          author: { name: c.author.name, email: c.author.email }, committer: { name: c.committer.name, email: c.committer.email },
          authoredAt: c.author.at, committedAt: c.committer.at,
        };
        r.store.objects.set(hash, { kind: "commit", meta });
      }
    }
    state.pushes.push({ repo: r.name, old: oldId, new: newId, ref, capabilities: caps.split(" ").filter(Boolean), objects: stored, authorization });
    if (state.rejectNext) {
      const reason = state.rejectNext;
      state.rejectNext = undefined;
      return report("unpack ok", `ng ${ref} ${reason}`);
    }
    if (ref !== "refs/heads/main") return report("unpack ok", `ng ${ref} only refs/heads/main is writable here`);
    if (oldId !== (r.head ?? "0".repeat(40))) return report("unpack ok", `ng ${ref} non-fast-forward`);
    // Connectivity: the new commit, its tree and every entry of the pushed trees must exist.
    const missing: string[] = [];
    const has = (h: string) => r.store.objects.has(h);
    const c = r.store.objects.get(newId);
    if (c?.kind !== "commit") missing.push(newId);
    else {
      if (!has(c.meta.treeHash)) missing.push(c.meta.treeHash);
      for (const p of c.meta.parents) if (!has(p)) missing.push(p);
    }
    for (const o of stored) {
      const t = r.store.objects.get(o.hash);
      if (t?.kind === "tree") for (const e of t.entries) if (e.type !== "gitlink" && !has(e.hash)) missing.push(e.hash);
    }
    if (missing.length) return report(`unpack missing objects ${missing.join(",")}`, `ng ${ref} missing necessary objects`);
    r.head = newId;
    return report("unpack ok", `ok ${ref}`);
  }) as typeof fetch;
  return state;
}
