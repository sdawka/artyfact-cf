import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { diffTreesAcross } from "../worker/artifacts/candidates";
import { compareFile, compareGenome, compareSystemRefs, FILE_COMPARE_MAX_BYTES, resolveRef, revisions } from "../worker/compare";
import type { HeadState } from "../worker/do/system-authority";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { systemStub } from "../worker/service";
import { appFiles } from "./fixtures/genome";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { genomeAmendment, importFresh, passing, promoteApp, renameContact, renameContactAndScreen, submitApp, type Flow } from "./helpers/flows";

beforeEach(() => setHooks({ runner: () => passing }));
afterEach(() => { setArtifactsOverride(undefined); resetHooks(); });

const state = async (f: Flow) => (await systemStub(env, f.systemId).state()) as HeadState;

describe("diffTreesAcross", () => {
  // Two namespaces have separate object stores, so each side can only be read through its own handle.
  function twoRepos() {
    const a = new FakeArtifacts().create("base");
    const b = new FakeArtifacts().create("fork");
    return { a, b };
  }

  it("is empty for the same content in two repos", async () => {
    const { a, b } = twoRepos();
    const files = { "package.json": "{}", "src/a/b.ts": "x", "src/c.ts": "y" };
    const ca = a.commit(files, "one"), cb = b.commit(files, "two");
    b.calls.length = 0;
    expect(await diffTreesAcross({ repo: a, commit: ca }, { repo: b, commit: cb })).toEqual({ added: [], modified: [], removed: [] });
    // Equal root trees: nothing below them is expanded.
    expect(b.calls.filter((c) => c.startsWith("readTree"))).toEqual([]);
  });

  it("reports added, modified and removed paths across repos, reading each side from its own repo", async () => {
    const { a, b } = twoRepos();
    const ca = a.commit({ "package.json": "{}", "src/a.ts": "a", "src/old/x.ts": "x", "docs/r.md": "r", "same/deep/k.ts": "k" });
    const cb = b.commit({ "package.json": "{}", "src/a.ts": "a2", "src/new/y.ts": "y", "docs": "now a file", "same/deep/k.ts": "k" });
    const d = await diffTreesAcross({ repo: a, commit: ca }, { repo: b, commit: cb });
    expect(d).toEqual({ added: ["docs", "src/new/y.ts"], modified: ["src/a.ts"], removed: ["docs/r.md", "src/old/x.ts"] });
  });

  it("lists every file as added against a null base", async () => {
    const { b } = twoRepos();
    const cb = b.commit({ "z.ts": "z", "a/b.ts": "b" });
    expect(await diffTreesAcross(null, { repo: b, commit: cb })).toEqual({ added: ["a/b.ts", "z.ts"], modified: [], removed: [] });
  });

  it("is 422 unknown-commit when a side's commit is not in its repo", async () => {
    const { a, b } = twoRepos();
    const ca = a.commit({ "x": "1" });
    await expect(diffTreesAcross({ repo: b, commit: ca }, { repo: a, commit: ca })).rejects.toMatchObject({ status: 422, code: "unknown-commit" });
  });
});

describe("resolveRef", () => {
  it("resolves head, sc-N, full System commit ids, candidates, 40-hex commits and realizations for both scopes", async () => {
    const f = await importFresh();
    const root = f.imp.head;
    const p = await promoteApp(f, { "src/ui/people/list.ts": "list" });
    const s = await state(f);

    expect(await resolveRef(env, s, "app", "head")).toEqual({ ref: "head", repo: p.forkRepo, commit: p.commit, systemCommit: p.systemCommit.id });
    expect(await resolveRef(env, s, "genome", "head")).toEqual({ ref: "head", repo: f.genomeRepo, commit: f.imp.genomeCommit, systemCommit: p.systemCommit.id });

    expect(await resolveRef(env, s, "app", "sc-1")).toEqual({ ref: "sc-1", repo: f.appRepo, commit: f.imp.appCommit, systemCommit: root });
    expect(await resolveRef(env, s, "app", root)).toMatchObject({ repo: f.appRepo, commit: f.imp.appCommit, systemCommit: root });
    expect(await resolveRef(env, s, "genome", "sc-2")).toMatchObject({ repo: f.genomeRepo, commit: f.imp.genomeCommit, systemCommit: p.systemCommit.id });

    expect(await resolveRef(env, s, "app", p.candidate)).toEqual({ ref: p.candidate, repo: p.forkRepo, commit: p.commit, systemCommit: root, candidate: p.candidate });
    // An app candidate leaves the Genome as it was at the candidate's base.
    expect(await resolveRef(env, s, "genome", p.candidate)).toMatchObject({ repo: f.genomeRepo, commit: f.imp.genomeCommit, systemCommit: root, candidate: p.candidate });

    expect(await resolveRef(env, s, "app", p.commit)).toMatchObject({ ref: p.commit, repo: p.forkRepo, commit: p.commit, candidate: p.candidate });
    // The imported app commit is recorded by the root System commit.
    expect(await resolveRef(env, s, "app", f.imp.appCommit!)).toEqual({ ref: f.imp.appCommit, repo: f.appRepo, commit: f.imp.appCommit, systemCommit: root });
    expect(await resolveRef(env, s, "genome", f.imp.genomeCommit)).toMatchObject({ repo: f.genomeRepo, commit: f.imp.genomeCommit });

    // A realization resolves to its fork head, whether or not that commit was submitted.
    const open = await submitApp(f, { "src/ui/people/b.ts": "b" }, "evolution.3");
    const s2 = await state(f);
    expect(await resolveRef(env, s2, "app", open.rid)).toMatchObject({ repo: open.forkRepo, commit: open.commit, candidate: open.candidate, systemCommit: p.systemCommit.id });
    const unsubmitted = f.ns.repo(open.forkRepo).commit({ ...appFiles, "src/ui/people/b.ts": "b2" }, "wip");
    const r = await resolveRef(env, s2, "app", open.rid);
    expect(r).toMatchObject({ repo: open.forkRepo, commit: unsubmitted });
    expect(r.candidate).toBeUndefined();
  });

  it("resolves an accepted Genome commit to the fork that holds it", async () => {
    const f = await importFresh();
    const g = await genomeAmendment(f, renameContact("Contact v2"));
    const s = await state(f);
    expect(await resolveRef(env, s, "genome", "head")).toMatchObject({ repo: g.forkRepo, commit: g.commit, systemCommit: g.systemCommit!.id });
    expect(await resolveRef(env, s, "genome", "sc-1")).toMatchObject({ repo: f.genomeRepo, commit: f.imp.genomeCommit });
    expect(await resolveRef(env, s, "genome", g.commit)).toMatchObject({ repo: g.forkRepo, commit: g.commit, candidate: g.candidate });
    // The app half of a Genome candidate is the app at its base.
    expect(await resolveRef(env, s, "app", g.candidate)).toMatchObject({ repo: f.appRepo, commit: f.imp.appCommit, candidate: g.candidate });
  });

  it("is 404 for unknown refs and 400 for malformed ones", async () => {
    const f = await importFresh();
    const s = await state(f);
    for (const ref of ["sc-9", "sc-1-deadbeef", "candidate.nope.r1.abcdef0", "f".repeat(40), "realization.9.r9"]) {
      await expect(resolveRef(env, s, "app", ref), ref).rejects.toMatchObject({ status: 404 });
    }
    for (const ref of ["", "HEAD~1", "main", "abc123", "../etc", "sc-x"]) {
      await expect(resolveRef(env, s, "app", ref), ref).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe("compareSystem", () => {
  it("compares the root import against nothing: every node and file is added", async () => {
    const f = await importFresh();
    const cmp = await compareSystemRefs(env, f.systemId, undefined, "sc-1");
    expect(cmp.from).toBeNull();
    expect(cmp.to.id).toBe(f.imp.head);
    expect(cmp.genome).toMatchObject({ from: null, to: f.imp.genomeCommit });
    expect(cmp.genome.delta!.added).toEqual(expect.arrayContaining(["screen.people", "entity.ContactRecord"]));
    expect(cmp.genome.delta!.removed).toEqual([]);
    expect(cmp.app!.from).toBeNull();
    expect(cmp.app!.files).toEqual({ added: Object.keys(appFiles).sort(), modified: [], removed: [] });
    expect(cmp.identical).toBe(false);
  });

  it("after a promotion: the app's changed files across forks with their nodes, and no Genome delta", async () => {
    const f = await importFresh();
    const p = await promoteApp(f, { "src/ui/people/list.ts": "list", "src/worker/routes/contacts.ts": "routes v2" });
    for (const from of ["sc-1", undefined]) {
      const cmp = await compareSystemRefs(env, f.systemId, from, "sc-2");
      expect(cmp.from!.id).toBe(f.imp.head);
      expect(cmp.to.id).toBe(p.systemCommit.id);
      expect(cmp.genome).toEqual({ from: f.imp.genomeCommit, to: f.imp.genomeCommit, delta: null, files: { added: [], modified: [], removed: [] }, pathNodes: {} });
      expect(cmp.app!.from).toMatchObject({ repo: f.appRepo, commit: f.imp.appCommit });
      expect(cmp.app!.to).toMatchObject({ repo: p.forkRepo, commit: p.commit });
      expect(cmp.app!.files).toEqual({ added: ["src/ui/people/list.ts"], modified: ["src/worker/routes/contacts.ts"], removed: [] });
      expect(cmp.app!.pathNodes["src/ui/people/list.ts"]!.sort()).toEqual(["component.AddContactDialog", "screen.people", "section.ui"]);
      expect(cmp.app!.pathNodes["src/worker/routes/contacts.ts"]).toEqual(expect.arrayContaining(["operation.contact.save", "entity.ContactRecord"]));
      expect(cmp.manifest).toEqual({ templateVersions: [], hookVersions: [], platformChanged: false });
      expect(cmp.identical).toBe(false);
    }
    expect((await compareSystemRefs(env, f.systemId, "sc-2", "head")).identical).toBe(true);
  });

  it("after an acceptance: the Genome delta's changed fields and affected criteria; the app is unchanged", async () => {
    const f = await importFresh();
    const p = await promoteApp(f, { "src/ui/people/list.ts": "list" });
    const g = await genomeAmendment(f, renameContactAndScreen("Contact v2"));
    const cmp = await compareSystemRefs(env, f.systemId, p.systemCommit.id, g.systemCommit!.id);
    expect(cmp.genome.from).toBe(f.imp.genomeCommit);
    expect(cmp.genome.to).toBe(g.commit);
    expect(cmp.genome.delta!.changed).toEqual([{ id: "entity.ContactRecord", fields: ["name"] }, { id: "screen.people", fields: ["name"] }]);
    expect(cmp.genome.delta!.affectedCriteria).toEqual(expect.arrayContaining(["C.people.list", "C.people.sorted"]));
    expect(cmp.genome.delta!.affectedCriteria).not.toContain("C.system.promotion");
    // The Genome repo's changed file, with the changed nodes it declares.
    expect(cmp.genome.files).toEqual({ added: [], modified: ["things/webapp/ontology.yaml"], removed: [] });
    expect(cmp.genome.pathNodes).toEqual({ "things/webapp/ontology.yaml": ["entity.ContactRecord", "screen.people"] });
    expect(cmp.app!.files).toEqual({ added: [], modified: [], removed: [] });
    expect(cmp.app!.from!.commit).toBe(cmp.app!.to.commit);
  });

  it("accepts candidate ids and 40-hex commits as synthetic System commits on their base", async () => {
    const f = await importFresh();
    const p = await promoteApp(f, { "src/ui/people/list.ts": "list" });
    const open = await submitApp(f, { "src/ui/people/b.ts": "b" }, "evolution.3");
    const byCandidate = await compareSystemRefs(env, f.systemId, undefined, open.candidate);
    expect(byCandidate.from!.id).toBe(p.systemCommit.id);
    expect(byCandidate.to).toMatchObject({ id: open.candidate, parent: p.systemCommit.id, candidates: [open.candidate], decision: { policy: "uncommitted" } });
    expect(byCandidate.app!.files).toEqual({ added: ["src/ui/people/b.ts"], modified: [], removed: [] });
    const byHash = await compareSystemRefs(env, f.systemId, "sc-1", open.commit);
    expect(byHash.app!.files.added).toEqual(["src/ui/people/b.ts", "src/ui/people/list.ts"]);
    const byRealization = await compareSystemRefs(env, f.systemId, "head", open.rid);
    expect(byRealization.app!.files.added).toEqual(["src/ui/people/b.ts"]);
  });

  it("is 404 for an unknown ref and 400 for a malformed one", async () => {
    const f = await importFresh();
    await expect(compareSystemRefs(env, f.systemId, "sc-7", "head")).rejects.toMatchObject({ status: 404 });
    await expect(compareSystemRefs(env, f.systemId, undefined, "candidate.x.r1.0000000")).rejects.toMatchObject({ status: 404 });
    await expect(compareSystemRefs(env, f.systemId, "HEAD^", "head")).rejects.toMatchObject({ status: 400 });
    await expect(compareSystemRefs(env, "system.never-imported", undefined, "head")).rejects.toMatchObject({ status: 404 });
  });
});

describe("compareGenome", () => {
  it("diffs the Genome across the accepted fork and the imported repo", async () => {
    const f = await importFresh();
    const g = await genomeAmendment(f, renameContact("Contact v3"));
    const cmp = await compareGenome(env, f.systemId, "sc-1", "head");
    expect(cmp.from).toMatchObject({ repo: f.genomeRepo, commit: f.imp.genomeCommit });
    expect(cmp.to).toMatchObject({ repo: g.forkRepo, commit: g.commit });
    expect(cmp.delta!.changed).toEqual([{ id: "entity.ContactRecord", fields: ["name"] }]);
    expect(cmp.files).toEqual({ added: [], modified: ["things/webapp/ontology.yaml"], removed: [] });
    // An open Genome candidate against its base (from omitted).
    const f2 = await importFresh();
    const open = await genomeAmendment(f2, renameContact("Contact v4"), { accept: false });
    const byCandidate = await compareGenome(env, f2.systemId, undefined, open.candidate);
    expect(byCandidate.from!.commit).toBe(f2.imp.genomeCommit);
    expect(byCandidate.delta!.changed.map((c) => c.id)).toEqual(["entity.ContactRecord"]);
  });
});

describe("compareFile", () => {
  it("reads one path on both sides, across a fork and its base", async () => {
    const f = await importFresh();
    const p = await promoteApp(f, { "src/ui/people/list.ts": "list", "src/index.ts": "export default { v: 2 }" });
    const added = await compareFile(env, f.systemId, "app", "sc-1", p.candidate, "src/ui/people/list.ts");
    expect(added.from).toMatchObject({ repo: f.appRepo, commit: f.imp.appCommit, hash: null, text: null, size: 0 });
    expect(added.to).toMatchObject({ repo: p.forkRepo, commit: p.commit, text: "list", size: 4, candidate: p.candidate });
    expect([added.truncated, added.binary]).toEqual([false, false]);
    const modified = await compareFile(env, f.systemId, "app", undefined, "sc-2", "src/index.ts");
    expect([modified.from.text, modified.to.text]).toEqual(["export default {}", "export default { v: 2 }"]);
    const genome = await compareFile(env, f.systemId, "genome", "sc-1", "head", "system.yaml");
    expect(genome.from.hash).toBe(genome.to.hash);
  });

  it("cuts text at 512 KB (truncated) and returns no text for a file with a NUL byte (binary)", async () => {
    const f = await importFresh();
    const big = "a".repeat(600 * 1024);
    const p = await promoteApp(f, { "public/big.txt": big, "public/logo.png": "PNG\u0000\u0001data" });
    const t = await compareFile(env, f.systemId, "app", "sc-1", "sc-2", "public/big.txt");
    expect(t.truncated).toBe(true);
    expect(t.to.size).toBe(big.length);
    expect(t.to.text!.length).toBe(FILE_COMPARE_MAX_BYTES);
    const b = await compareFile(env, f.systemId, "app", "sc-1", p.commit, "public/logo.png");
    expect(b).toMatchObject({ binary: true, truncated: false, to: { text: null, hash: expect.any(String) } });
  });

  it("is 400 for a bad scope or path", async () => {
    const f = await importFresh();
    for (const path of ["", "/etc/passwd", "../x", "a//b", "src/./x", 7]) {
      await expect(compareFile(env, f.systemId, "app", "sc-1", "head", path), String(path)).rejects.toMatchObject({ status: 400 });
    }
    await expect(compareFile(env, f.systemId, "web", "sc-1", "head", "a")).rejects.toMatchObject({ status: 400 });
  });
});

describe("revisions", () => {
  it("lists the head, System commits newest first, then open candidates", async () => {
    const f = await importFresh();
    const p = await promoteApp(f, { "src/ui/people/list.ts": "list" });
    const open = await submitApp(f, { "src/ui/people/b.ts": "b" }, "evolution.3");
    const { revisions: rs } = await revisions(env, f.systemId);
    expect(rs.map((r) => [r.id, r.kind])).toEqual([
      ["head", "head"], [p.systemCommit.id, "commit"], [f.imp.head, "commit"], [open.candidate, "candidate"],
    ]);
    expect(rs[0]!.label).toBe("head (sc-2)");
    expect(rs[1]).toMatchObject({ label: "sc-2 promotion · List people", evolution: "evolution.1", at: expect.any(String) });
    expect(rs[2]!.label).toBe("sc-1 import");
    expect(rs[3]).toMatchObject({ evolution: "evolution.3", state: "evaluated" });
  });
});
