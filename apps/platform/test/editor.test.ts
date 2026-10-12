import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiError, EditorCommitResponse, FileResponse, FilesResponse, GenomeCandidateReview, RealizationResponse, StartWorkResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { COMMIT_TOKEN_TTL_S, commitEdit, MAX_COMMIT_BYTES, setEditorTransport } from "../worker/editor";
import type { ImportSystemResponse } from "../shared/api";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { handleBatch, PUSHED } from "../worker/hooks/queue";
import { queueContextFor, systemStub } from "../worker/service";
import { appFiles, genomeFiles } from "./fixtures/genome";
import { fakeReceivePack, type FakeReceivePack } from "./helpers/fake-receive-pack";
import { ADMIN, importFresh, passing, promoteApp, type Flow } from "./helpers/flows";

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
}

let rp: FakeReceivePack;
beforeEach(() => setHooks({ runner: () => passing }));
afterEach(() => { setArtifactsOverride(undefined); setEditorTransport(undefined); resetHooks(); });

async function flow(): Promise<Flow> {
  const f = await importFresh();
  rp = fakeReceivePack(f.ns);
  setEditorTransport({ fetch: rp.fetch });
  return f;
}

/** A human editor realization: a normal start with agentLabel `human:<name>` and origin `editor`. */
async function startHuman(f: Flow, evolution = "evolution.1") {
  const s = await call<StartWorkResponse>("POST", `/systems/${f.systemId}/evolutions/${evolution}/realizations`, { agentLabel: "human:ada", origin: "editor" }, ADMIN);
  expect(s.status, JSON.stringify(s.json)).toBe(201);
  const rid = s.json.realization.id;
  return { rid, fork: s.json.realization.workspace.fork, auth: { authorization: `Bearer ${s.json.secret}` }, start: s.json };
}

/** Like importFresh, but the Genome lives under `system/` in its repo. */
async function importNested(): Promise<Flow> {
  const ns = new FakeArtifacts();
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const systemId = `system.nest${tag}`, genomeRepo = `nest-genome-${tag}`, appRepo = `nest-app-${tag}`;
  const files = { ...genomeFiles, "system.yaml": genomeFiles["system.yaml"].replace("system.kit", systemId), "criteria.yaml": genomeFiles["criteria.yaml"].replaceAll("system.kit", systemId) };
  ns.create(genomeRepo).commit(Object.fromEntries(Object.entries(files).map(([p, t]) => [`system/${p}`, t])), "genome");
  ns.create(appRepo).commit(appFiles, "scaffold");
  setArtifactsOverride(ns);
  const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo }, ADMIN);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  rp = fakeReceivePack(ns);
  setEditorTransport({ fetch: rp.fetch });
  return { ns, systemId, genomeRepo, appRepo, imp: res.json, forks: 0 };
}

const commitPath = (f: Flow, rid: string) => `/systems/${f.systemId}/realizations/${rid}/commit`;
const PEOPLE = "src/ui/people/index.html";

describe("editor reads", () => {
  it("lists and reads files at head, in app and Genome scope", async () => {
    const f = await flow();
    const list = await call<FilesResponse>("GET", `/systems/${f.systemId}/files?scope=app`);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    expect(list.json.ref).toMatchObject({ ref: "head", repo: f.appRepo, commit: f.imp.appCommit });
    expect(list.json.files.map((x) => x.path)).toEqual(Object.keys(appFiles).sort());
    expect(list.json.files.every((x) => /^[0-9a-f]{40}$/.test(x.hash))).toBe(true);
    const g = await call<FilesResponse>("GET", `/systems/${f.systemId}/files?scope=genome&ref=head`);
    expect(g.json.ref.repo).toBe(f.genomeRepo);
    expect(g.json.files.map((x) => x.path)).toContain("system.yaml");

    const file = await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=app&path=${encodeURIComponent(PEOPLE)}`);
    expect(file.status, JSON.stringify(file.json)).toBe(200);
    expect(file.json).toMatchObject({ path: PEOPLE, text: appFiles[PEOPLE], size: appFiles[PEOPLE].length, binary: false, truncated: false });
    expect(file.json.nodes).toContain("screen.people");
    const sys = await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=genome&path=system.yaml`);
    expect(sys.json.text).toContain(f.systemId);
    expect(sys.json.nodes).toBeUndefined();
  });

  it("reads at a System commit and at a candidate", async () => {
    const f = await flow();
    const p = await promoteApp(f, { [PEOPLE]: "<main>v2</main>" }, "evolution.3");
    const at = async (ref: string) => (await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=app&ref=${ref}&path=${encodeURIComponent(PEOPLE)}`)).json;
    expect((await at("sc-1")).text).toBe(appFiles[PEOPLE]); // the import commit
    expect((await at(p.systemCommit.id)).text).toBe("<main>v2</main>");
    expect((await at("head")).text).toBe("<main>v2</main>");
    const h = await startHuman(f);
    const c = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), { message: "v3", changes: [{ path: PEOPLE, content: "<main>v3</main>" }] }, h.auth);
    expect(c.status, JSON.stringify(c.json)).toBe(201);
    const cand = await at(c.json.submitted.candidate.id);
    expect(cand.text).toBe("<main>v3</main>");
    expect(cand.ref).toMatchObject({ repo: h.fork, commit: c.json.commit, candidate: c.json.submitted.candidate.id });
    expect((await at(h.rid)).text).toBe("<main>v3</main>");
    expect((await at(c.json.commit)).ref.commit).toBe(c.json.commit);
    const files = await call<FilesResponse>("GET", `/systems/${f.systemId}/files?scope=app&ref=${c.json.submitted.candidate.id}`);
    expect(files.json.ref.repo).toBe(h.fork);
  });

  it("flags binary and truncated files and refuses bad paths", async () => {
    const f = await flow();
    const big = "x".repeat(600 * 1024);
    // A promoted change to read back at head.
    await promoteApp(f, { "assets/blob.bin": "a\0b", "docs/big.txt": big }, "evolution.3");
    const bin = (await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=app&path=assets/blob.bin`)).json;
    expect(bin).toMatchObject({ binary: true, text: null, size: 3 });
    const long = (await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=app&path=docs/big.txt`)).json;
    expect(long).toMatchObject({ binary: false, truncated: true, size: big.length });
    expect(long.text!.length).toBe(512 * 1024);
    for (const bad of ["../x", "/etc/passwd", "a//b", ""]) {
      expect((await call<ApiError>("GET", `/systems/${f.systemId}/file?scope=app&path=${encodeURIComponent(bad)}`)).status).toBe(400);
    }
    expect((await call<ApiError>("GET", `/systems/${f.systemId}/file?scope=app&path=nope.txt`)).status).toBe(404);
    expect((await call<ApiError>("GET", `/systems/${f.systemId}/file?scope=app&path=src`)).status).toBe(404);
    expect((await call<ApiError>("GET", `/systems/${f.systemId}/files?scope=docs`)).status).toBe(400);
    expect((await call<ApiError>("GET", `/systems/${f.systemId}/files?ref=bogus!`)).status).toBe(400);
  });
});

describe("editor commit", () => {
  it("pushes to the fork, checkpoints and submits a candidate with a short-lived, revoked token", async () => {
    const f = await flow();
    const h = await startHuman(f);
    const fork = f.ns.repo(h.fork);
    const base = fork.head!;
    const res = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), {
      message: "Sort people by name", why: "Owners asked for alphabetical order", expectedHead: base,
      changes: [{ path: PEOPLE, content: "<main>sorted</main>" }, { path: "src/ui/people/sort.ts", content: "export const sort = 1;\n" }],
    }, h.auth);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.parent).toBe(base);
    expect(fork.head).toBe(res.json.commit);
    expect((await fork.readCommit(res.json.commit))).toMatchObject({ treeHash: res.json.tree, parents: [base], author: { name: "ada" } });
    const cand = res.json.submitted.candidate;
    expect(res.json.submitted.created).toBe(true);
    expect(cand.commit).toBe(res.json.commit);
    expect(cand.changedPaths).toEqual([PEOPLE, "src/ui/people/sort.ts"]);
    expect(cand.changedSubjects).toContain("screen.people");
    expect(res.json.submitted.evaluations.length).toBeGreaterThan(0);
    // The push carried the minted token; it was ttl 300 s and is revoked.
    const writeTokens = fork.tokens.filter((t) => t.ttl === COMMIT_TOKEN_TTL_S);
    expect(COMMIT_TOKEN_TTL_S).toBe(300);
    expect(writeTokens).toHaveLength(1);
    expect(writeTokens[0]).toMatchObject({ scope: "write", revoked: true });
    expect(rp.pushes[0].authorization).toBe(`Bearer secret-${writeTokens[0].id}`);
    // Checkpoint with the message and commit; rationale on the manifest.
    const view = await call<RealizationResponse>("GET", `/systems/${f.systemId}/realizations/${h.rid}`, undefined, h.auth);
    expect(view.json.realization.agent.id).toBe("human:ada");
    const stub = systemStub(env, f.systemId);
    const rec = await stub.realization(h.rid);
    expect(rec?.realization.status).toBe("evaluated");
    const checkpoints = (rec?.realization as unknown as { checkpoints: { summary: string; commit?: string }[] }).checkpoints;
    expect(checkpoints.at(-1)).toMatchObject({ summary: "Sort people by name", commit: res.json.commit });
    expect(await stub.candidateManifest(cand.id)).toMatchObject({ rationale: "Owners asked for alphabetical order", commit: res.json.commit });
  });

  it("uses the realization's label as the Git author, never the caller's", async () => {
    const f = await flow();
    const h = await startHuman(f);
    const res = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), { message: "m", author: "mallory", changes: [{ path: PEOPLE, content: "x" }] }, h.auth);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect((await f.ns.repo(h.fork).readCommit(res.json.commit))!.author.name).toBe("ada");
  });

  it("leaves the push event unseen when submit fails, so the queue still submits the commit", async () => {
    const f = await flow();
    const h = await startHuman(f);
    setHooks({ runner: () => ({ ...passing, async runSubmission() { throw new Error("hooks down"); } }) });
    const res = await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path: PEOPLE, content: "q" }] }, h.auth);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const head = f.ns.repo(h.fork).head!;
    setHooks({ runner: () => passing });
    const out = await handleBatch([{
      id: "m1", attempts: 1, ack: () => {}, retry: () => {},
      body: { type: PUSHED, source: { namespace: env.ARTIFACTS_NAMESPACE, repoName: h.fork }, payload: { ref: "refs/heads/main", after: head } },
    }], queueContextFor(env));
    expect(out[0]).toMatchObject({ action: "submitted", realizationId: h.rid });
    expect((await systemStub(env, f.systemId).candidates({ realizationId: h.rid })).map((c) => c.commit)).toEqual([head]);
  });

  it("revokes the token and answers 502 when the transport throws", async () => {
    const f = await flow();
    const h = await startHuman(f);
    setEditorTransport({ fetch: (async () => { throw new TypeError("network down"); }) as typeof fetch });
    const res = await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path: PEOPLE, content: "x" }] }, h.auth);
    expect(res.status).toBe(502);
    expect(res.json.error.code).toBe("push-failed");
    const tokens = f.ns.repo(h.fork).tokens.filter((t) => t.ttl === COMMIT_TOKEN_TTL_S);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].revoked).toBe(true);
  });

  it("caps the commit size: 413 for a large body, 422 commit-too-large for the content sum", async () => {
    const f = await flow();
    const h = await startHuman(f);
    const mb = "x".repeat(1_000_000);
    const changes = Array.from({ length: 9 }, (_, i) => ({ path: `big/${i}.txt`, content: mb }));
    const big = await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes }, h.auth);
    expect(big.status).toBe(413);
    expect(big.json.error.code).toBe("commit-too-large");
    // Without content-length (a streamed body) the cap applies while reading.
    const bytes = new TextEncoder().encode(JSON.stringify({ message: "m", changes }));
    const stream = new ReadableStream<Uint8Array>({ start(ctl) { for (let i = 0; i < bytes.length; i += 1 << 20) ctl.enqueue(bytes.subarray(i, i + (1 << 20))); ctl.close(); } });
    const streamed = await exports.default.fetch(new Request(`http://example.com/api${commitPath(f, h.rid)}`, { method: "POST", headers: { "content-type": "application/json", ...h.auth }, body: stream }));
    expect(streamed.status).toBe(413);
    await expect(commitEdit(env, f.systemId, h.rid, { message: "m", changes }, "t")).rejects.toMatchObject({ status: 422, code: "commit-too-large" });
    expect(MAX_COMMIT_BYTES).toBe(8_000_000);
    expect(f.ns.repo(h.fork).tokens.some((t) => t.ttl === COMMIT_TOKEN_TTL_S)).toBe(false);
  });

  it("refuses to save over a file larger than the read cap, but lets it be deleted", async () => {
    const f = await flow();
    await promoteApp(f, { "docs/big.txt": "y".repeat(600 * 1024) }, "evolution.3");
    const h = await startHuman(f);
    const edit = await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path: "docs/big.txt", content: "y".repeat(512 * 1024) }] }, h.auth);
    expect(edit.status).toBe(422);
    expect(edit.json.error.code).toBe("file-too-large-to-edit");
    const del = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), { message: "drop", changes: [{ path: "docs/big.txt", content: null }] }, h.auth);
    expect(del.status, JSON.stringify(del.json)).toBe(201);
  });

  it("is 422 path-conflict for a file over a directory or under a file", async () => {
    const f = await flow();
    const h = await startHuman(f);
    for (const path of ["src/ui", "src/index.ts/x"]) {
      const res = await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path, content: "x" }] }, h.auth);
      expect(res.status, path).toBe(422);
      expect(res.json.error.code).toBe("path-conflict");
    }
    expect(await systemStub(env, f.systemId).setCandidateRationale("candidate.nope", "x")).toBe(false);
  });

  it("chains a second commit and marks a blank why as pending", async () => {
    const f = await flow();
    const h = await startHuman(f);
    const one = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), { message: "one", changes: [{ path: PEOPLE, content: "1" }] }, h.auth);
    expect(one.status, JSON.stringify(one.json)).toBe(201);
    const two = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), { message: "two", why: "  ", expectedHead: one.json.commit, changes: [{ path: PEOPLE, content: "2" }] }, h.auth);
    expect(two.status, JSON.stringify(two.json)).toBe(201);
    expect(two.json.parent).toBe(one.json.commit);
    expect(f.ns.repo(h.fork).head).toBe(two.json.commit);
    const stub = systemStub(env, f.systemId);
    expect((await stub.candidates({ realizationId: h.rid })).map((c) => c.commit).sort()).toEqual([one.json.commit, two.json.commit].sort());
    const m = await stub.candidateManifest(two.json.submitted.candidate.id);
    expect(m).toMatchObject({ rationalePending: true });
    expect(m).not.toHaveProperty("rationale");
    expect(await stub.candidateManifest(one.json.submitted.candidate.id)).toMatchObject({ rationalePending: true });
  });

  it("acks the queue delivery of the editor's own push as a duplicate", async () => {
    const f = await flow();
    const h = await startHuman(f);
    const res = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path: PEOPLE, content: "q" }] }, h.auth);
    expect(res.status).toBe(201);
    const acked: string[] = [];
    const out = await handleBatch([{
      id: "m1", attempts: 1, ack: () => acked.push("m1"), retry: () => {},
      body: { type: PUSHED, source: { namespace: env.ARTIFACTS_NAMESPACE, repoName: h.fork }, payload: { ref: "refs/heads/main", after: res.json.commit } },
    }], queueContextFor(env));
    expect(out[0]).toMatchObject({ action: "duplicate", realizationId: h.rid });
    expect(acked).toEqual(["m1"]);
    expect(await systemStub(env, f.systemId).candidates({ realizationId: h.rid })).toHaveLength(1);
  });

  it("authorizes with the realization secret or admin only", async () => {
    const f = await flow();
    const h = await startHuman(f);
    const body = { message: "m", changes: [{ path: PEOPLE, content: "x" }] };
    expect((await call<ApiError>("POST", commitPath(f, h.rid), body)).status).toBe(401);
    const wrong = await call<ApiError>("POST", commitPath(f, h.rid), body, { authorization: "Bearer not-the-secret" });
    expect(wrong.status).toBe(403);
    expect(f.ns.repo(h.fork).tokens.some((t) => t.ttl === COMMIT_TOKEN_TTL_S)).toBe(false);
    const other = await startHuman(f);
    expect((await call<ApiError>("POST", commitPath(f, h.rid), body, other.auth)).status).toBe(403);
    const admin = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), body, ADMIN);
    expect(admin.status, JSON.stringify(admin.json)).toBe(201);
  });

  it("refuses protected paths, invalid paths and oversized or empty edits", async () => {
    const f = await flow();
    const h = await startHuman(f);
    const post = (body: unknown) => call<ApiError>("POST", commitPath(f, h.rid), body, h.auth);
    const prot = await post({ message: "m", changes: [{ path: "system/system.yaml", content: "x" }] });
    expect(prot.status).toBe(422);
    expect(prot.json.error.code).toBe("protected-path");
    expect((await post({ message: "m", changes: [{ path: "assays/a.yaml", content: "x" }] })).json.error.code).toBe("protected-path");
    expect((await post({ message: "m", changes: [{ path: "../x", content: "x" }] })).json.error.code).toBe("invalid-path");
    for (const bad of [".git/config", "src/.GIT/x", "a\\b", "a\0b", `${"s".repeat(256)}`]) {
      expect((await post({ message: "m", changes: [{ path: bad, content: "x" }] })).json.error.code, bad).toBe("invalid-path");
    }
    expect((await post({ message: "m", changes: Array.from({ length: 51 }, (_, i) => ({ path: `f${i}`, content: "x" })) })).json.error.code).toBe("too-many-changes");
    expect((await post({ message: "m", changes: [{ path: "big.txt", content: "x".repeat(1_000_001) }] })).json.error.code).toBe("file-too-large");
    expect((await post({ message: "m", changes: [{ path: "nope.txt", content: null }] })).json.error.code).toBe("invalid-path");
    expect((await post({ message: "", changes: [{ path: PEOPLE, content: "x" }] })).status).toBe(400);
    expect((await post({ message: "m", changes: [] })).status).toBe(400);
    expect((await post({ message: "m", changes: [{ path: PEOPLE, content: 3 }] })).status).toBe(400);
    expect(f.ns.repo(h.fork).head).toBe(h.start.realization.workspace.baseCommit);
    expect(f.ns.repo(h.fork).tokens.some((t) => t.ttl === COMMIT_TOKEN_TTL_S)).toBe(true);
    // Re-committing what the fork already holds is 422 no-change (the fake's seeded blobs are not SHA-1, so write first).
    expect((await post({ message: "m", changes: [{ path: PEOPLE, content: "same" }] })).status).toBe(201);
    expect((await post({ message: "m", changes: [{ path: PEOPLE, content: "same" }] })).json.error.code).toBe("no-change");
    // Every minted token was revoked, including the no-change attempt.
    expect(f.ns.repo(h.fork).tokens.filter((t) => t.ttl === COMMIT_TOKEN_TTL_S).every((t) => t.revoked)).toBe(true);
  });

  it("is 409 stale-head when expectedHead or the remote ref moved", async () => {
    const f = await flow();
    const h = await startHuman(f);
    const body = { message: "m", changes: [{ path: PEOPLE, content: "x" }] };
    const stale = await call<ApiError>("POST", commitPath(f, h.rid), { ...body, expectedHead: "a".repeat(40) }, h.auth);
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("stale-head");
    expect(f.ns.repo(h.fork).tokens.some((t) => t.ttl === COMMIT_TOKEN_TTL_S)).toBe(false);
    rp.advertiseHead = "b".repeat(40);
    const raced = await call<ApiError>("POST", commitPath(f, h.rid), body, h.auth);
    expect(raced.status).toBe(409);
    expect(raced.json.error.code).toBe("stale-head");
    expect(f.ns.repo(h.fork).tokens.filter((t) => t.ttl === COMMIT_TOKEN_TTL_S).every((t) => t.revoked)).toBe(true);
    rp.advertiseHead = undefined;
    rp.rejectNext = "non-fast-forward";
    expect((await call<ApiError>("POST", commitPath(f, h.rid), body, h.auth)).json.error.code).toBe("stale-head");
    rp.rejectNext = "hook declined";
    const failed = await call<ApiError>("POST", commitPath(f, h.rid), body, h.auth);
    expect(failed.status).toBe(502);
    expect(failed.json.error.code).toBe("push-failed");
  });

  it("is 409 for an ended realization", async () => {
    const f = await flow();
    const h = await startHuman(f);
    expect((await call("POST", `/systems/${f.systemId}/realizations/${h.rid}/reject`, { reason: "no" }, ADMIN)).status).toBe(200);
    const res = await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path: PEOPLE, content: "x" }] }, ADMIN);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("invalid-state");
  });

  it("commits a Genome edit that awaits the admin, and keeps it inside the Genome", async () => {
    const f = await flow();
    const h = await startHuman(f, "evolution.2");
    expect(h.start.realization.target).toBe("genome");
    const path = "things/webapp/ontology.yaml";
    const cur = (await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=genome&ref=${h.rid}&path=${path}`)).json;
    expect(cur.ref).toMatchObject({ repo: h.fork, commit: h.start.realization.workspace.baseCommit });
    const res = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), {
      message: "Rename the entity", why: "Clearer name", changes: [{ path, content: cur.text!.replace("name: Contact record", "name: Contact record v2") }],
    }, h.auth);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.submitted.realization.status).toBe("awaiting-admin");
    expect(res.json.submitted.candidate.changedSubjects).toEqual(["entity.ContactRecord"]);
    const after = (await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=genome&ref=${h.rid}&path=${path}`)).json;
    expect(after.ref).toMatchObject({ repo: h.fork, commit: res.json.commit });
    expect(after.text).toContain("Contact record v2");
    const prot = await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path: "assays/x.yaml", content: "x" }] }, h.auth);
    expect(prot.json.error.code).toBe("protected-path");
  });

  it("records a Genome edit that does not load as a candidate with its load error, and a second commit fixes it", async () => {
    resetHooks(); // the real hook runner: it needs the candidate's files even when they do not load
    const f = await flow();
    const h = await startHuman(f, "evolution.2");
    const ontology = "things/webapp/ontology.yaml";
    const original = async (path: string) => (await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=genome&ref=head&path=${path}`)).json.text!;
    const cases = [
      { path: "system.yaml", content: "id: [unclosed\n  : :" }, // YAML parse error
      { path: ontology, content: "nodes: 5" }, // schema error
    ];
    for (const change of cases) {
      const bad = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), { message: `break ${change.path}`, changes: [change] }, h.auth);
      expect(bad.status, JSON.stringify(bad.json)).toBe(201);
      expect(bad.json.submitted.candidate.commit).toBe(bad.json.commit);
      expect(bad.json.submitted.realization.status).toBe("awaiting-admin");
      const rv = await call<GenomeCandidateReview>("GET", `/systems/${f.systemId}/realizations/${h.rid}/review`);
      expect(rv.status, JSON.stringify(rv.json)).toBe(200);
      expect(rv.json.candidate).toBe(bad.json.submitted.candidate.id);
      expect(rv.json.loadError).toBeTruthy();
      // The fork head moved, so the file can be fixed in a follow-up commit on top of the broken one.
      const at = (await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=genome&ref=${h.rid}&path=${change.path}`)).json;
      expect(at.ref.commit).toBe(bad.json.commit);
      const fixed = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), {
        message: `fix ${change.path}`, expectedHead: bad.json.commit, changes: [{ path: change.path, content: await original(change.path) }],
      }, h.auth);
      expect(fixed.status, JSON.stringify(fixed.json)).toBe(201);
      expect(fixed.json.parent).toBe(bad.json.commit);
      const ok = await call<GenomeCandidateReview>("GET", `/systems/${f.systemId}/realizations/${h.rid}/review`);
      expect(ok.json.candidate).toBe(fixed.json.submitted.candidate.id);
      expect(ok.json.loadError).toBeUndefined();
    }
  });

  it("keeps a Genome edit under the Genome prefix when the Genome lives in system/", async () => {
    const f = await importNested();
    const h = await startHuman(f, "evolution.2");
    expect(h.start.realization.target).toBe("genome");
    const outside = await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path: "things/webapp/ontology.yaml", content: "x" }] }, h.auth);
    expect(outside.status).toBe(422);
    expect(outside.json.error.code).toBe("outside-genome");
    expect((await call<ApiError>("POST", commitPath(f, h.rid), { message: "m", changes: [{ path: "README.md", content: "x" }] }, h.auth)).json.error.code).toBe("outside-genome");
    const path = "system/things/webapp/ontology.yaml";
    const cur = (await call<FileResponse>("GET", `/systems/${f.systemId}/file?scope=genome&ref=${h.rid}&path=${path}`)).json;
    const res = await call<EditorCommitResponse>("POST", commitPath(f, h.rid), {
      message: "Rename", changes: [{ path, content: cur.text!.replace("name: Contact record", "name: Contact record v2") }],
    }, h.auth);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.submitted.candidate.changedPaths).toEqual([path]);
  });
});
