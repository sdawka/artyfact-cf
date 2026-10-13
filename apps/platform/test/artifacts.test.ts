import { describe, expect, it } from "vitest";
import { forkAndWait, withRepo } from "../worker/artifacts/client";
import { diffTrees } from "../worker/artifacts/candidates";
import { listTree, walkTree } from "../worker/artifacts/genome-source";
import { nodesForPath, permittedGlobs, sourceMapFor } from "../worker/artifacts/source-map";
import { FakeArtifacts } from "./helpers/fake-artifacts";

function threeCommits() {
  const ns = new FakeArtifacts();
  const repo = ns.create("peopling-app");
  const c1 = repo.commit({ "package.json": "{}", "src/index.ts": "a", "src/ui/people/index.html": "<p>", "docs/a/b/c.md": "deep" }, "c1");
  const c2 = repo.commit({ "package.json": "{}", "src/index.ts": "a2", "src/ui/people/index.html": "<p>", "src/ui/people/new.css": "x", "docs/a/b/c.md": "deep" }, "c2");
  const c3 = repo.commit({ "package.json": "{}", "src/index.ts": "a2", "src/ui/people/new.css": "x", "migrations/0001.sql": "create" }, "c3");
  return { ns, repo, c1, c2, c3 };
}

describe("walkTree", () => {
  it("returns every file under nested trees", async () => {
    const { repo, c1 } = threeCommits();
    const files = await walkTree(repo, c1);
    expect([...files.keys()].sort()).toEqual(["docs/a/b/c.md", "package.json", "src/index.ts", "src/ui/people/index.html"]);
    expect(files.get("docs/a/b/c.md")).toBe("deep");
  });
  it("restricts to a prefix and strips it", async () => {
    const { repo, c2 } = threeCommits();
    const files = await walkTree(repo, c2, "src/ui");
    expect([...files.keys()].sort()).toEqual(["people/index.html", "people/new.css"]);
  });
  it("applies a path filter before reading", async () => {
    const { repo, c1 } = threeCommits();
    repo.calls.length = 0;
    const files = await walkTree(repo, c1, "", (p) => p.endsWith(".ts"));
    expect([...files.keys()]).toEqual(["src/index.ts"]);
    expect(repo.calls.filter((c) => c.startsWith("readFile"))).toEqual(["readFile:src/index.ts"]);
  });
  it("throws a 422 unknown-commit on an unknown commit", async () => {
    const { repo } = threeCommits();
    await expect(walkTree(repo, "f".repeat(40))).rejects.toMatchObject({ status: 422, code: "unknown-commit" });
    await expect(diffTrees(repo, "f".repeat(40), "e".repeat(40))).rejects.toMatchObject({ status: 422, code: "unknown-commit" });
  });
  it("distinguishes an absent prefix (empty) from a missing tree object (error)", async () => {
    const { repo, c1 } = threeCommits();
    expect((await listTree(repo, c1, "nope")).size).toBe(0);
    const realReadTree = repo.readTree.bind(repo);
    let first = true;
    repo.readTree = async (h) => (first ? ((first = false), realReadTree(h)) : null);
    await expect(listTree(repo, c1, "docs/a")).rejects.toMatchObject({ status: 422, code: "missing-tree" });
  });
  it("listTree lists paths without reading blobs", async () => {
    const { repo, c3 } = threeCommits();
    repo.calls.length = 0;
    const paths = await listTree(repo, c3);
    expect([...paths.keys()].sort()).toEqual(["migrations/0001.sql", "package.json", "src/index.ts", "src/ui/people/new.css"]);
    expect(repo.calls.some((c) => c.startsWith("readFile") || c.startsWith("readBlob"))).toBe(false);
  });
});

describe("diffTrees", () => {
  it("reports added/modified/removed across nested trees", async () => {
    const { repo, c1, c2, c3 } = threeCommits();
    expect(await diffTrees(repo, c1, c2)).toEqual({ added: ["src/ui/people/new.css"], modified: ["src/index.ts"], removed: [] });
    expect(await diffTrees(repo, c2, c3)).toEqual({
      added: ["migrations/0001.sql"], modified: [], removed: ["docs/a/b/c.md", "src/ui/people/index.html"],
    });
  });
  it("skips identical subtrees without reading them", async () => {
    const { repo, c1 } = threeCommits();
    const c1b = repo.commit({ "package.json": "{}", "src/index.ts": "a", "src/ui/people/index.html": "<p>", "docs/a/b/c.md": "changed" });
    repo.calls.length = 0;
    expect(await diffTrees(repo, c1, c1b)).toEqual({ added: [], modified: ["docs/a/b/c.md"], removed: [] });
    // src/ subtree hash is unchanged, so it is never expanded.
    const reads = repo.calls.filter((c) => c.startsWith("readTree")).length;
    expect(reads).toBe(2 + 2 * 3); // two roots + docs, docs/a, docs/a/b on both sides
  });
  it("is empty for the same commit", async () => {
    const { repo, c2 } = threeCommits();
    expect(await diffTrees(repo, c2, c2)).toEqual({ added: [], modified: [], removed: [] });
  });
});

describe("forkAndWait", () => {
  it("forks and polls until ready", async () => {
    const { ns } = threeCommits();
    ns.forkDelayPolls = 2;
    const r = await forkAndWait(ns, "peopling-app", "peopling-app--r1", { intervalMs: 1 });
    expect(r.remote).toBe("https://fake/peopling-app--r1.git");
    expect(ns.repo("peopling-app--r1").calls.filter((c) => c === "info").length).toBe(3);
  });
  it("tolerates an existing fork (retried start)", async () => {
    const { ns } = threeCommits();
    await forkAndWait(ns, "peopling-app", "peopling-app--r1", { intervalMs: 1 });
    await expect(forkAndWait(ns, "peopling-app", "peopling-app--r1", { intervalMs: 1 })).resolves.toBeDefined();
  });
  it("refuses an existing fork whose head moved past the base commit (left over from another run)", async () => {
    const { ns, c3 } = threeCommits();
    await forkAndWait(ns, "peopling-app", "peopling-app--r1", { intervalMs: 1, baseCommit: c3 });
    await expect(forkAndWait(ns, "peopling-app", "peopling-app--r1", { intervalMs: 1, baseCommit: c3 })).resolves.toBeDefined();
    ns.repo("peopling-app--r1").commit({ "README.md": "someone else's work" });
    await expect(forkAndWait(ns, "peopling-app", "peopling-app--r1", { intervalMs: 1, baseCommit: c3 })).rejects.toMatchObject({ status: 409, code: "fork-exists" });
  });
  it("times out", async () => {
    const { ns } = threeCommits();
    ns.forkDelayPolls = 1000;
    await expect(forkAndWait(ns, "peopling-app", "peopling-app--r2", { intervalMs: 1, timeoutMs: 10 })).rejects.toThrow(/not ready/);
  });
});

describe("source map", () => {
  // Effective node globs as the loader computes them (`SystemModel.files`): template defaults and the nodes' own files.
  const files = {
    "thing.webapp": [{ glob: "src/worker/health.ts", declared: false }],
    "section.ui": [{ glob: "src/ui/**", declared: false }],
    "screen.people": [{ glob: "src/ui/people/**", declared: true }],
    "component.AddContactDialog": [{ glob: "src/ui/people/**", declared: true }],
    "operation.contact.save": [{ glob: "src/worker/routes/contacts.ts", declared: true }],
    "policy.ownerOnly": [{ glob: "src/worker/routes/contacts.ts", declared: true }],
  };

  it("groups node globs by glob, keeping where each came from", () => {
    const sm = sourceMapFor({ files });
    expect(sm.find((e) => e.glob === "src/worker/health.ts")).toEqual({ glob: "src/worker/health.ts", nodes: ["thing.webapp"], origin: "template" });
    expect(sm.find((e) => e.glob === "src/ui/people/**")).toEqual({ glob: "src/ui/people/**", nodes: ["screen.people", "component.AddContactDialog"], origin: "node" });
    expect(sm.filter((e) => e.origin === "node")).toHaveLength(2);
  });
  it("maps paths to node ids, unmapped:<path> on a miss", () => {
    const sm = sourceMapFor({ files });
    expect(nodesForPath(sm, "src/ui/people/list.html").sort()).toEqual(["component.AddContactDialog", "screen.people", "section.ui"]);
    expect(nodesForPath(sm, "README.md")).toEqual(["unmapped:README.md"]);
  });
  it("matches an escaped {id} default only literally", () => {
    const sm = sourceMapFor({ files: { "screen.*": [{ glob: "ids/screen.\\*.ts", declared: false }] } });
    expect(nodesForPath(sm, "ids/screen.*.ts")).toEqual(["screen.*"]);
    expect(nodesForPath(sm, "ids/screen.people.ts")).toEqual(["unmapped:ids/screen.people.ts"]);
  });
  it("permits globs for affected nodes and their non-root ancestors", () => {
    const sm = sourceMapFor({ files });
    const path = (id: string) =>
      ({ "screen.people": ["system.k", "thing.webapp", "section.ui", "screen.people"], "operation.contact.save": ["system.k", "thing.webapp", "section.domain", "operation.contact.save"] })[id] ?? [id];
    const kindOf = (id: string) => (id.startsWith("system.") ? "system" : id.startsWith("thing.") ? "thing" : "node");
    expect(permittedGlobs(sm, ["screen.people"], path, kindOf).sort()).toEqual(["src/ui/**", "src/ui/people/**"]);
    expect(permittedGlobs(sm, ["operation.contact.save"], path, kindOf)).toEqual(["src/worker/routes/contacts.ts"]);
  });
});

describe("artifactsErrorCode", () => {
  it("reads .code or falls back to the proxied message", async () => {
    const { artifactsErrorCode } = await import("../worker/artifacts/client");
    expect(artifactsErrorCode(Object.assign(new Error("x"), { code: "INVALID_TTL" }))).toBe("INVALID_TTL");
    expect(artifactsErrorCode(new Error("ArtifactsError: Repository not found: peopling-app."))).toBe("NOT_FOUND");
    expect(artifactsErrorCode(new Error("boom"))).toBeUndefined();
  });
});

describe("withRepo disposes RPC results", () => {
  it("disposes every method result and the repo stub, even when fn throws", async () => {
    const ns = new FakeArtifacts();
    const repo = ns.create("r");
    repo.commit({ "a.txt": "a" });
    let results = 0, stubs = 0;
    const log = repo.log.bind(repo);
    repo.log = async (opts) => Object.assign(await log(opts), { [Symbol.dispose]: () => void results++ });
    (repo as { [Symbol.dispose]?: () => void })[Symbol.dispose] = () => void stubs++;
    const [head] = await withRepo(ns, "r", (r) => r.log({ limit: 1 }));
    expect(head?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect([results, stubs]).toEqual([1, 1]);
    await expect(withRepo(ns, "r", async (r) => { await r.log(); throw new Error("boom"); })).rejects.toThrow("boom");
    expect([results, stubs]).toEqual([2, 2]);
  });
});
