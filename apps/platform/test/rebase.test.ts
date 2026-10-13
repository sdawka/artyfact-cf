import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiError, Candidate, FilesResponse, PromoteResponse, RebaseResponse, StartWorkResponse, SubmitResponse, Task, TaskPlan } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { listTree } from "../worker/artifacts/genome-source";
import { setEditorTransport } from "../worker/editor";
import { encodeBlob, encodeTree, hashObject, parseTree, type GitObject } from "../worker/git/objects";
import { carry, rebasedFrom } from "../worker/rebase";
import { FakeArtifacts, type FakeRepo } from "./helpers/fake-artifacts";
import { pushCommit, type FileChange } from "../worker/git/push";
import type { HookRunner } from "../worker/hooks/contract";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { systemStub } from "../worker/service";
import { fakeReceivePack, type FakeReceivePack } from "./helpers/fake-receive-pack";
import { ADMIN, call, importFresh, passing, type Flow } from "./helpers/flows";

let rp: FakeReceivePack;
beforeEach(() => setHooks({ runner: () => passing }));
afterEach(() => { setArtifactsOverride(undefined); setEditorTransport(undefined); resetHooks(); });

/** Bytes that are not UTF-8 (NUL, 0xff, a lone continuation byte): any text round trip would change them. */
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80, 0x00, 0x01, 0xc3, 0x28, 0x7f]);

const task = (id: string): Task => ({
  id, evolutionId: "evolution.1", title: id, intent: `do ${id}`, thing: "thing.webapp", nodes: ["screen.people"],
  footprint: { globs: [], paths: [], unmatched: [], entryFiles: [] }, acceptanceCriteria: ["C.people.list"], dependsOn: [],
  status: "planned", origin: "fallback",
});
const planOf = (f: Flow, tasks: Task[]): TaskPlan => ({
  version: 1, evolutionId: "evolution.1", genomeCommit: f.imp.genomeCommit, appCommit: f.imp.appCommit ?? "", tasks, conflicts: [], waves: [tasks.map((t) => t.id)], problems: [],
  provenance: { planner: { provider: "fake", model: "fake" }, fake: true }, createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z",
});

async function setup(ids = ["t1", "t2"]): Promise<Flow> {
  const f = await importFresh();
  rp = fakeReceivePack(f.ns);
  setEditorTransport({ fetch: rp.fetch });
  await systemStub(env, f.systemId).putPlan(planOf(f, ids.map(task)));
  return f;
}

/** Claim `taskId`, start a realization for it and bind the two (what W5's claim route does). */
async function startTask(f: Flow, taskId: string, label: string) {
  const stub = systemStub(env, f.systemId);
  const claim = await stub.claimTask(taskId, label);
  expect("claimed" in claim, JSON.stringify(claim)).toBe(true);
  const s = await call<StartWorkResponse>("POST", `/systems/${f.systemId}/evolutions/evolution.1/realizations`, { agentLabel: label });
  expect(s.status, JSON.stringify(s.json)).toBe(201);
  await stub.bindTask(taskId, s.json.realization.id);
  return { rid: s.json.realization.id, fork: s.json.realization.workspace.fork, base: s.json.realization.workspace.baseCommit };
}

/** Push `changes` on top of the fork's tip through the fake receive-pack and submit the commit. */
async function pushAndSubmit(f: Flow, r: { rid: string; fork: string }, changes: FileChange[]) {
  const repo = f.ns.repo(r.fork);
  const token = await repo.createToken("write", 300);
  const pushed = await pushCommit({
    remote: `https://fake/${r.fork}.git`, token: token.plaintext, repo, parent: repo.head!, changes,
    author: { name: "agent", email: "agent@example.com" }, message: "task work", fetch: rp.fetch,
  });
  const sub = await call<SubmitResponse>("POST", `/systems/${f.systemId}/realizations/${r.rid}/submit`, { commit: pushed.commit });
  expect(sub.status, JSON.stringify(sub.json)).toBe(201);
  return { commit: pushed.commit, candidate: sub.json.candidate.id };
}

const head = async (f: Flow) => (await call<{ head: string | null }>("GET", `/systems/${f.systemId}`)).json.head;
const rebase = (f: Flow, rid: string) => call<RebaseResponse & Partial<ApiError>>("POST", `/systems/${f.systemId}/realizations/${rid}/rebase`, {}, ADMIN);
const promote = async (f: Flow, candidate: string) =>
  call<PromoteResponse & Partial<ApiError>>("POST", `/systems/${f.systemId}/promote`, { candidates: [candidate], expectedHead: await head(f), rationale: "ship" }, ADMIN);

async function blobAt(f: Flow, repoName: string, commit: string, path: string): Promise<Uint8Array | null> {
  const repo = f.ns.repo(repoName);
  const e = (await listTree(repo, commit)).get(path);
  if (!e) return null;
  return new Uint8Array(await (await repo.readBlob(e.hash))!.arrayBuffer());
}
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

/** Two tasks of evolution.1 on disjoint paths; t2 carries a binary file. */
async function twoTasks(f: Flow) {
  const a = await startTask(f, "t1", "agent-a");
  const b = await startTask(f, "t2", "agent-b");
  const ca = await pushAndSubmit(f, a, [{ path: "src/task-a.ts", content: "export const a = 1;\n" }]);
  const cb = await pushAndSubmit(f, b, [
    { path: "src/task-b.ts", content: "export const b = 2;\n" },
    { path: "assets/logo.bin", content: LOGO },
  ]);
  return { a, b, ca, cb };
}

describe("rebase-on-promote", () => {
  it("promotes task 1, rebases task 2's candidate onto the new head, submits and promotes it", async () => {
    const f = await setup();
    const { a, b, ca, cb } = await twoTasks(f);

    const p1 = await promote(f, ca.candidate);
    expect(p1.status, JSON.stringify(p1.json)).toBe(200);
    // Task 2's candidate stays open (another task of the same Evolution) but is built on the old head.
    const stale = await promote(f, cb.candidate);
    expect(stale.status, JSON.stringify(stale.json)).toBe(409);
    expect(stale.json.error?.code).toBe("stale-base");

    const headAfterA = await head(f);
    const r = await rebase(f, b.rid);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const out = r.json;
    expect(out.realization.baseRevision).toBe(headAfterA);
    expect(out.realization.workspace.baseCommit).toBe(ca.commit);
    expect(out.realization.workspace.repo).toBe(a.fork);
    expect(out.submitted.created).toBe(true);
    expect(out.submitted.candidate.commit).toBe(out.commit);
    expect(out.submitted.candidate.baseRevision).toBe(headAfterA);
    // Only the candidate's own changes, against the new base.
    expect(out.submitted.candidate.changedPaths).toEqual(["assets/logo.bin", "src/task-b.ts"]);
    expect(out.submitted.evaluations.length).toBeGreaterThan(0);
    expect(out.submitted.evaluations.every((e) => e.candidate === out.submitted.candidate.id)).toBe(true);

    // The new commit sits on the fork tip, and its tree is the head tree plus the candidate's diff.
    const fork = f.ns.repo(b.fork);
    expect(fork.head).toBe(out.commit);
    expect((await fork.readCommit(out.commit))!.parents).toEqual([cb.commit]);
    expect(text(await blobAt(f, b.fork, out.commit, "src/task-a.ts"))).toBe("export const a = 1;\n");
    expect(text(await blobAt(f, b.fork, out.commit, "src/task-b.ts"))).toBe("export const b = 2;\n");
    expect(await blobAt(f, b.fork, out.commit, "assets/logo.bin")).toEqual(LOGO);
    const headFiles = await listTree(fork, ca.commit);
    const rebased = await listTree(fork, out.commit);
    expect([...rebased.keys()].sort()).toEqual([...headFiles.keys(), "assets/logo.bin", "src/task-b.ts"].sort());

    // The pre-rebase candidate is superseded: it can never be promoted over the new head.
    const old = (await call<{ candidates: Candidate[] }>("GET", `/systems/${f.systemId}/evolutions/evolution.1/candidates`)).json.candidates.find((c) => c.id === cb.candidate);
    expect(old?.state).toBe("rejected");

    const p2 = await promote(f, out.submitted.candidate.id);
    expect(p2.status, JSON.stringify(p2.json)).toBe(200);
    expect(p2.json.rejected).toEqual([]);
    const files = (await call<FilesResponse>("GET", `/systems/${f.systemId}/files?scope=app`)).json;
    expect(files.ref.commit).toBe(out.commit);
    expect(files.files.map((x) => x.path)).toEqual(expect.arrayContaining(["src/task-a.ts", "src/task-b.ts", "assets/logo.bin"]));
    expect(await blobAt(f, b.fork, files.ref.commit, "assets/logo.bin")).toEqual(LOGO);

    const stub = systemStub(env, f.systemId);
    expect((await stub.task("t1"))?.status).toBe("promoted");
    expect((await stub.task("t2"))?.status).toBe("promoted");
    expect((await stub.evolution("evolution.1"))?.state).toBe("promoted");
  });

  it("refuses with up-to-date when the candidate's base is the current head", async () => {
    const f = await setup();
    const { b } = await twoTasks(f);
    const r = await rebase(f, b.rid);
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json.error?.code).toBe("up-to-date");
  });

  it("refuses with rebase-conflict when a stored file conflict names a promoted candidate", async () => {
    // The conflict hook reports a file conflict between the two open candidates (as the real overlap hook would).
    const conflicting: HookRunner = {
      ...passing,
      async conflicts(ctx) {
        return ctx.openCandidates.map((o) => ({
          kind: "file" as const, candidates: [ctx.candidate.id, o.id], subjects: ["src/shared.ts"], paths: ["src/shared.ts"], nodes: [], message: "both touch src/shared.ts",
        }));
      },
    };
    setHooks({ runner: () => conflicting });
    const f = await setup();
    const { b, ca, cb } = await twoTasks(f);
    expect((await promote(f, ca.candidate)).status).toBe(200);
    const r = await rebase(f, b.rid);
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json.error?.code).toBe("rebase-conflict");
    expect((r.json.error?.details as { paths: string[] }).paths).toEqual(["src/shared.ts"]);
    // Nothing was pushed.
    expect(f.ns.repo(b.fork).head).toBe(cb.commit);
  });

  it("refuses with rebase-conflict when the head changed a path the candidate changes", async () => {
    const f = await setup();
    const a = await startTask(f, "t1", "agent-a");
    const b = await startTask(f, "t2", "agent-b");
    const ca = await pushAndSubmit(f, a, [{ path: "src/same.ts", content: "a\n" }]);
    const cb = await pushAndSubmit(f, b, [{ path: "src/same.ts", content: "b\n" }, { path: "src/only-b.ts", content: "b\n" }]);
    expect((await promote(f, ca.candidate)).status).toBe(200);
    const r = await rebase(f, b.rid);
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json.error?.code).toBe("rebase-conflict");
    expect((r.json.error?.details as { paths: string[] }).paths).toEqual(["src/same.ts"]);
    expect(f.ns.repo(b.fork).head).toBe(cb.commit);
  });

  it("refuses with invalid-state without an open candidate, for a promoted realization, and without admin", async () => {
    const f = await setup();
    const a = await startTask(f, "t1", "agent-a");
    const none = await rebase(f, a.rid);
    expect(none.status, JSON.stringify(none.json)).toBe(409);
    expect(none.json.error?.code).toBe("invalid-state");
    const ca = await pushAndSubmit(f, a, [{ path: "src/task-a.ts", content: "a\n" }]);
    expect((await promote(f, ca.candidate)).status).toBe(200);
    const done = await rebase(f, a.rid);
    expect(done.status, JSON.stringify(done.json)).toBe(409);
    expect(done.json.error?.code).toBe("invalid-state");
    const anon = await call<ApiError>("POST", `/systems/${f.systemId}/realizations/${a.rid}/rebase`, {}, {});
    expect(anon.status).toBe(401);
  });

  it("builds on a stranded rebase commit of the same candidate, and refuses unsubmitted work on the fork", async () => {
    const f = await setup();
    const { b, ca, cb } = await twoTasks(f);
    expect((await promote(f, ca.candidate)).status).toBe(200);
    // An earlier attempt pushed its commit and then failed before recording it: the tip names the candidate it rebases.
    const repo = f.ns.repo(b.fork);
    const token = await repo.createToken("write", 300);
    const stranded = await pushCommit({
      remote: `https://fake/${b.fork}.git`, token: token.plaintext, repo, parent: cb.commit, changes: [{ path: "src/stranded.ts", content: "x\n" }],
      author: { name: "artyfact", email: "rebase@artyfact.invalid" }, message: `Rebase\n\nArtyfact-Rebase-Of: ${cb.commit}\n`, fetch: rp.fetch,
    });
    const r = await rebase(f, b.rid);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await repo.readCommit(r.json.commit))!.parents).toEqual([stranded.commit]);
    // The stranded commit's tree is not carried: the new tree is the head tree plus the candidate's diff.
    expect(await blobAt(f, b.fork, r.json.commit, "src/stranded.ts")).toBeNull();
    expect(r.json.submitted.candidate.changedPaths).toEqual(["assets/logo.bin", "src/task-b.ts"]);
    const again = await rebase(f, b.rid);
    expect(again.json.error?.code).toBe("up-to-date");
  });

  it("refuses when the fork has commits after the candidate that were never submitted", async () => {
    const f = await setup();
    const { b, ca } = await twoTasks(f);
    expect((await promote(f, ca.candidate)).status).toBe(200);
    const repo = f.ns.repo(b.fork);
    const token = await repo.createToken("write", 300);
    await pushCommit({
      remote: `https://fake/${b.fork}.git`, token: token.plaintext, repo, parent: repo.head!, changes: [{ path: "src/later.ts", content: "x\n" }],
      author: { name: "agent", email: "agent@example.com" }, message: "more work", fetch: rp.fetch,
    });
    const r = await rebase(f, b.rid);
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json.error?.code).toBe("invalid-state");
  });
});

const kindAt = async (f: Flow, fork: string, commit: string, path: string) => (await listTree(f.ns.repo(fork), commit)).get(path)?.type;

describe("rebase-on-promote, fix round 1", () => {
  it("keeps a candidate's exec-bit drop and symlink-to-file change with unchanged content", async () => {
    const f = await setup(["t0", "t1", "t2"]);
    // t0 puts an executable and a symlink on the head.
    const z = await startTask(f, "t0", "agent-z");
    const cz = await pushAndSubmit(f, z, [
      { path: "bin/run.sh", content: "#!/bin/sh\necho run\n", type: "exec" },
      { path: "docs/link", content: "../README.md", type: "symlink" },
    ]);
    expect((await promote(f, cz.candidate)).status).toBe(200);
    expect(await kindAt(f, z.fork, cz.commit, "bin/run.sh")).toBe("exec");
    expect(await kindAt(f, z.fork, cz.commit, "docs/link")).toBe("symlink");

    const a = await startTask(f, "t1", "agent-a");
    const b = await startTask(f, "t2", "agent-b");
    const ca = await pushAndSubmit(f, a, [{ path: "src/task-a.ts", content: "a\n" }]);
    // Same content, plain blobs: 100755 → 100644 and 120000 → 100644.
    const cb = await pushAndSubmit(f, b, [
      { path: "bin/run.sh", content: "#!/bin/sh\necho run\n", type: "blob" },
      { path: "docs/link", content: "../README.md", type: "blob" },
    ]);
    expect(await kindAt(f, b.fork, cb.commit, "bin/run.sh")).toBe("blob");
    expect((await promote(f, ca.candidate)).status).toBe(200);

    const r = await rebase(f, b.rid);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await kindAt(f, b.fork, r.json.commit, "bin/run.sh")).toBe("blob");
    expect(await kindAt(f, b.fork, r.json.commit, "docs/link")).toBe("blob");
    expect(r.json.submitted.candidate.changedPaths).toEqual(["bin/run.sh", "docs/link"]);
    expect(text(await blobAt(f, b.fork, r.json.commit, "src/task-a.ts"))).toBe("a\n");
  });

  it("retries a stranded second-generation rebase", async () => {
    const f = await setup(["t1", "t2", "t3", "t4"]);
    const rs = await Promise.all(["t1", "t2", "t3", "t4"].map((t) => startTask(f, t, `agent-${t}`)));
    const cs = [];
    for (const [i, r] of rs.entries()) cs.push(await pushAndSubmit(f, r, [{ path: `src/${i}.ts`, content: `${i}\n` }]));
    expect((await promote(f, cs[0].candidate)).status).toBe(200);
    const gen1 = await rebase(f, rs[1].rid);
    expect(gen1.status, JSON.stringify(gen1.json)).toBe(200);
    // t3 then moves the head again, and t4 is rebased onto that head, ready to promote.
    const t3 = await rebase(f, rs[2].rid);
    expect((await promote(f, t3.json.submitted.candidate.id)).status).toBe(200);
    const t4 = await rebase(f, rs[3].rid);
    expect(t4.status, JSON.stringify(t4.json)).toBe(200);

    // While t2's second rebase is being pushed, t4 is promoted: the push lands, the DO move is refused (stale-base).
    let fired = false;
    setEditorTransport({
      fetch: async (input, init) => {
        const res = await rp.fetch(input, init);
        if (!fired && init?.method === "POST" && String(input).includes(`/${rs[1].fork}.git/`)) {
          fired = true;
          expect((await promote(f, t4.json.submitted.candidate.id)).status).toBe(200);
        }
        return res;
      },
    });
    const stranded = await rebase(f, rs[1].rid);
    expect(stranded.status, JSON.stringify(stranded.json)).toBe(409);
    expect(stranded.json.error?.code).toBe("stale-base");
    const fork = f.ns.repo(rs[1].fork);
    const tip = fork.head!;
    expect(tip).not.toBe(gen1.json.commit);
    const msg = (await fork.readCommit(tip))!.message;
    expect(msg.match(/Artyfact-Rebase-Of:/g)).toHaveLength(1);
    expect(msg).toContain(`Artyfact-Rebase-Of: ${gen1.json.commit}`);

    setEditorTransport({ fetch: rp.fetch });
    const retry = await rebase(f, rs[1].rid);
    expect(retry.status, JSON.stringify(retry.json)).toBe(200);
    expect((await fork.readCommit(retry.json.commit))!.parents).toEqual([tip]);
    expect((await promote(f, retry.json.submitted.candidate.id)).status).toBe(200);
    const files = (await call<FilesResponse>("GET", `/systems/${f.systemId}/files?scope=app`)).json.files.map((x) => x.path);
    expect(files).toEqual(expect.arrayContaining(["src/0.ts", "src/1.ts", "src/2.ts", "src/3.ts"]));
  });

  it("takes the last rebase trailer of a message that carries several", () => {
    const a = "a".repeat(40), b = "b".repeat(40);
    expect(rebasedFrom(`Rebase\n\nArtyfact-Rebase-Of: ${a}\n\nArtyfact-Rebase-Of: ${b}\n`)).toBe(b);
    expect(rebasedFrom("no trailer")).toBeNull();
  });
});

/** Write `files` as real git objects (SHA-1 ids) into `repo`'s store; returns the root tree id. */
async function realTree(repo: FakeRepo, files: Record<string, string | Uint8Array>): Promise<string> {
  const put = async (o: GitObject) => {
    const h = await hashObject(o);
    if (o.type === "blob") repo.store.objects.set(h, { kind: "blob", text: new TextDecoder().decode(o.body), bytes: o.body });
    else repo.store.objects.set(h, { kind: "tree", entries: parseTree(o.body) });
    return h;
  };
  async function dir(entries: [string, string | Uint8Array][]): Promise<string> {
    const here: { name: string; hash: string; type: "blob" | "tree" }[] = [];
    const subs = new Map<string, [string, string | Uint8Array][]>();
    for (const [p, c] of entries) {
      const i = p.indexOf("/");
      if (i < 0) here.push({ name: p, hash: await put(encodeBlob(c)), type: "blob" });
      else subs.set(p.slice(0, i), [...(subs.get(p.slice(0, i)) ?? []), [p.slice(i + 1), c]]);
    }
    for (const [name, sub] of subs) here.push({ name, hash: await dir(sub), type: "tree" });
    return put(encodeTree(here));
  }
  return dir(Object.entries(files));
}

async function reachable(repo: FakeRepo, tree: string, out = new Set<string>()): Promise<Set<string>> {
  out.add(tree);
  for (const e of (await repo.readTree(tree))!) {
    if (e.type === "tree") await reachable(repo, e.hash, out);
    else out.add(e.hash);
  }
  return out;
}

describe("carry", () => {
  it("packs every object of the head tree that a fork with its own object store lacks", async () => {
    // Separate namespaces have separate stores: the fork sees nothing the head repo holds, as a live fork does not
    // see commits pushed to a sibling fork.
    const base = { "src/a.ts": "a\n", "src/deep/b.ts": "b\n", "README.md": "r\n", "assets/logo.bin": LOGO };
    const headRepo = new FakeArtifacts().create("head");
    const fork = new FakeArtifacts().create("fork");
    const headTree = await realTree(headRepo, { ...base, "src/a.ts": "a2\n", "src/new/c.ts": "c\n" });
    const forkTree = await realTree(fork, { ...base, "src/mine.ts": "m\n" });
    const out: GitObject[] = [];
    await carry(headRepo, fork, headTree, forkTree, out);
    const sent = new Set(await Promise.all(out.map(hashObject)));
    const missing = [...(await reachable(headRepo, headTree))].filter((h) => !sent.has(h) && !fork.store.objects.has(h));
    expect(missing).toEqual([]);
    // Unchanged subtrees and blobs the fork already holds are not sent.
    const unchanged = (await headRepo.readTree(headTree))!.find((e) => e.name === "assets")!.hash;
    expect(sent.has(unchanged)).toBe(false);
    expect(out.length).toBeLessThan((await reachable(headRepo, headTree)).size);
  });
});
