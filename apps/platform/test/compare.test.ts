import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { diffTreesAcross } from "../worker/artifacts/candidates";
import { resolveRef } from "../worker/compare";
import type { HeadState } from "../worker/do/system-authority";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { systemStub } from "../worker/service";
import { appFiles } from "./fixtures/genome";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { genomeAmendment, importFresh, passing, promoteApp, renameContact, submitApp, type Flow } from "./helpers/flows";

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
    expect(await resolveRef(env, s, "app", f.imp.appCommit)).toEqual({ ref: f.imp.appCommit, repo: f.appRepo, commit: f.imp.appCommit, systemCommit: root });
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
