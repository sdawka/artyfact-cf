import { describe, expect, it } from "vitest";
import { listTree } from "../../worker/artifacts/genome-source";
import { diffTrees } from "../../worker/artifacts/candidates";
import { authHeader, checkReport, parseAdvertisement, pathProblem, pushCommit, PushRejected, rewriteTree, type PushCommitOptions } from "../../worker/git/push";
import { FLUSH, parsePkts, pkt, pktText } from "../../worker/git/pkt-line";
import { concatBytes } from "../../worker/git/objects";
import { FakeArtifacts } from "../helpers/fake-artifacts";
import { fakeReceivePack } from "../helpers/fake-receive-pack";

function repoWith(files: Record<string, string>) {
  const ns = new FakeArtifacts();
  const repo = ns.create("app");
  const base = repo.commit(files, "base");
  return { ns, repo, base };
}

const FILES = { "README.md": "readme\n", "src/a.ts": "a\n", "src/deep/b.ts": "b\n", "docs/x.md": "x\n" };

describe("rewriteTree", () => {
  it("rewrites only the edited path and reuses untouched subtrees by id", async () => {
    const { repo, base } = repoWith(FILES);
    const root = (await repo.readCommit(base))!.treeHash;
    const before = new Map((await repo.readTree(root))!.map((e) => [e.name, e.hash]));
    repo.calls.length = 0;
    const out = await rewriteTree(repo, root, [{ path: "src/deep/b.ts", content: "B\n" }]);
    expect(out.changed).toBe(true);
    // blob + src/deep + src + root
    expect(out.objects.map((o) => o.type).sort()).toEqual(["blob", "tree", "tree", "tree"]);
    // docs/ was never read
    expect(repo.calls.filter((c) => c.startsWith("readTree")).length).toBe(3);
    const rootTree = out.objects.find((o) => o.type === "tree" && new TextDecoder().decode(o.body).includes("docs"))!;
    const { parseTree } = await import("../../worker/git/objects");
    const entries = new Map(parseTree(rootTree.body).map((e) => [e.name, e.hash]));
    expect(entries.get("docs")).toBe(before.get("docs"));
    expect(entries.get("README.md")).toBe(before.get("README.md"));
    expect(entries.get("src")).not.toBe(before.get("src"));
  });

  it("adds new directories, prunes emptied ones and refuses missing deletes", async () => {
    const { repo, base } = repoWith(FILES);
    const root = (await repo.readCommit(base))!.treeHash;
    const out = await rewriteTree(repo, root, [{ path: "docs/x.md", content: null }, { path: "new/dir/c.ts", content: "c\n" }]);
    const { parseTree } = await import("../../worker/git/objects");
    const top = out.objects.filter((o) => o.type === "tree").map((o) => parseTree(o.body).map((e) => e.name));
    expect(top).toContainEqual(["README.md", "new", "src"]);
    await expect(rewriteTree(repo, root, [{ path: "nope.txt", content: null }])).rejects.toMatchObject({ code: "missing-path" });
    await expect(rewriteTree(repo, root, [{ path: "src/a.ts", content: "1" }, { path: "src/a.ts/x", content: "2" }])).rejects.toMatchObject({ code: "path-conflict" });
  });

  it("reports no change when nothing differs and keeps exec mode on edit", async () => {
    const { repo, base } = repoWith(FILES);
    const root = (await repo.readCommit(base))!.treeHash;
    expect((await rewriteTree(repo, root, [])).changed).toBe(false);
    const entries = (await repo.readTree(root))!;
    const exec = { ...entries.find((e) => e.name === "README.md")!, name: "run.sh", mode: "100755", type: "exec" as const };
    repo.store.objects.set("e".repeat(40), { kind: "tree", entries: [exec] });
    const out = await rewriteTree(repo, "e".repeat(40), [{ path: "run.sh", content: "#!/bin/sh\n" }]);
    const { parseTree } = await import("../../worker/git/objects");
    expect(parseTree(out.objects.find((o) => o.type === "tree")!.body)[0]).toMatchObject({ name: "run.sh", mode: "100755", type: "exec" });
  });

  it.each([
    ["empty", ""],
    ["absolute", "/etc/passwd"],
    ["parent segment", "../x"],
    ["nested parent segment", "src/../../x"],
    ["dot segment", "./x"],
    ["empty segment", "a//b"],
    ["trailing slash", "src/"],
    [".git", ".git/config"],
    [".GIT any case", "sub/.Git/hooks/pre-commit"],
    ["backslash", "a\\b"],
    ["NUL", "a\0b"],
    ["long segment", `${"s".repeat(256)}.ts`],
    ["long path", Array.from({ length: 20 }, () => "d".repeat(250)).join("/")],
  ])("refuses an unsafe path (%s) before reading anything", async (_case, path) => {
    const { repo, base } = repoWith(FILES);
    const root = (await repo.readCommit(base))!.treeHash;
    repo.calls.length = 0;
    expect(pathProblem(path)).not.toBeNull();
    await expect(rewriteTree(repo, root, [{ path, content: "x" }])).rejects.toMatchObject({ name: "PushRejected", code: "invalid-path" });
    await expect(rewriteTree(repo, root, [{ path, content: null }])).rejects.toMatchObject({ code: "invalid-path" });
    expect(repo.calls).toEqual([]);
  });

  it("accepts ordinary paths, including dotfiles and 255-byte segments", () => {
    for (const p of ["README.md", ".gitignore", "src/.env.example", "a/.github/workflows/ci.yml", `${"s".repeat(252)}.ts`, "dir/..hidden", "x.git"]) {
      expect(pathProblem(p), p).toBeNull();
    }
  });

  it("refuses a file written over a directory and a path written under a file", async () => {
    const { repo, base } = repoWith(FILES);
    const root = (await repo.readCommit(base))!.treeHash;
    await expect(rewriteTree(repo, root, [{ path: "src", content: "x" }])).rejects.toMatchObject({ code: "path-conflict", message: expect.stringContaining("is a directory") });
    await expect(rewriteTree(repo, root, [{ path: "src/deep", content: "x" }])).rejects.toMatchObject({ code: "path-conflict" });
    await expect(rewriteTree(repo, root, [{ path: "README.md/x", content: "x" }])).rejects.toMatchObject({ code: "path-conflict", message: expect.stringContaining("is a file") });
    await expect(rewriteTree(repo, root, [{ path: "src/a.ts/b/c", content: "x" }])).rejects.toMatchObject({ code: "path-conflict" });
  });

  it("deleting the last file yields the empty tree", async () => {
    const { repo, base } = repoWith({ "only.txt": "1" });
    const out = await rewriteTree(repo, (await repo.readCommit(base))!.treeHash, [{ path: "only.txt", content: null }]);
    expect(out.tree).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  });
});

describe("pushCommit", () => {
  async function setup() {
    const r = repoWith(FILES);
    const token = await r.repo.createToken("write", 300);
    const rp = fakeReceivePack(r.ns, "app");
    const opts: PushCommitOptions = {
      remote: "https://acct.artifacts.cloudflare.net/git/artyfact/app.git", token: token.plaintext, repo: r.repo, parent: r.base,
      changes: [{ path: "src/a.ts", content: "A\n" }, { path: "docs/x.md", content: null }], author: { name: "Ada", email: "ada@example.com" },
      message: "Edit a", fetch: rp.fetch, now: 1_700_000_000,
    };
    return { ...r, token, rp, opts };
  }

  it("pushes a commit the binding reads back, with correct framing", async () => {
    const { repo, base, rp, opts, token } = await setup();
    const out = await pushCommit(opts);
    expect(repo.head).toBe(out.commit);
    expect(out.parent).toBe(base);
    expect(rp.requests.map((r) => `${r.method} ${new URL(r.url).pathname}${new URL(r.url).search}`)).toEqual([
      "GET /git/artyfact/app.git/info/refs?service=git-receive-pack",
      "POST /git/artyfact/app.git/git-receive-pack",
    ]);
    expect(rp.requests.every((r) => r.authorization === `Bearer ${token.plaintext}`)).toBe(true);
    expect(rp.requests[1].contentType).toBe("application/x-git-receive-pack-request");
    expect(rp.pushes[0]).toMatchObject({ old: base, new: out.commit, ref: "refs/heads/main", capabilities: ["report-status"] });
    const meta = (await repo.readCommit(out.commit))!;
    expect(meta).toMatchObject({ treeHash: out.tree, parents: [base], message: "Edit a\n", author: { name: "Ada", email: "ada@example.com" }, authoredAt: 1_700_000_000 });
    expect(await (await repo.readFile({ ref: out.commit, path: "src/a.ts" }))!.text()).toBe("A\n");
    expect(await repo.readFile({ ref: out.commit, path: "docs/x.md" })).toBeNull();
    expect([...(await listTree(repo, out.commit)).keys()].sort()).toEqual(["README.md", "src/a.ts", "src/deep/b.ts"]);
    expect(await diffTrees(repo, base, out.commit)).toEqual({ added: [], modified: ["src/a.ts"], removed: ["docs/x.md"] });
  });

  it("chains a second commit on the first", async () => {
    const { repo, opts } = await setup();
    const first = await pushCommit(opts);
    const second = await pushCommit({ ...opts, parent: first.commit, changes: [{ path: "src/deep/b.ts", content: "BB\n" }], message: "Edit b" });
    expect(repo.head).toBe(second.commit);
    expect((await repo.readCommit(second.commit))!.parents).toEqual([first.commit]);
  });

  it("refuses a stale parent before sending a pack", async () => {
    const { rp, opts } = await setup();
    rp.advertiseHead = "f".repeat(40);
    await expect(pushCommit(opts)).rejects.toMatchObject({ name: "PushRejected", code: "stale-head" });
    expect(rp.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  it("maps ng non-fast-forward to stale-head and other ng to rejected", async () => {
    const { rp, opts } = await setup();
    rp.rejectNext = "non-fast-forward";
    await expect(pushCommit(opts)).rejects.toMatchObject({ code: "stale-head" });
    rp.rejectNext = "stale ref"; // Artifacts' wording, seen live
    await expect(pushCommit(opts)).rejects.toMatchObject({ code: "stale-head" });
    for (const reason of ["failed to update ref", "expected 1 file", "reference already exists"]) {
      rp.rejectNext = reason; // not "the ref moved": no reload loop
      await expect(pushCommit(opts)).rejects.toMatchObject({ code: "rejected" });
    }
    rp.rejectNext = "cannot lock ref 'refs/heads/main'";
    await expect(pushCommit(opts)).rejects.toMatchObject({ code: "stale-head" });
    rp.rejectNext = "pre-receive hook declined";
    await expect(pushCommit(opts)).rejects.toMatchObject({ code: "rejected", message: expect.stringContaining("hook declined") });
  });

  it("maps 401 to auth, including a revoked token", async () => {
    const { repo, token, opts } = await setup();
    await expect(pushCommit({ ...opts, token: "wrong" })).rejects.toMatchObject({ code: "auth", status: 401 });
    await repo.revokeToken(token.id);
    await expect(pushCommit(opts)).rejects.toMatchObject({ code: "auth" });
  });

  it("supports the Basic x-access-token fallback", async () => {
    const { rp, opts, token } = await setup();
    await pushCommit({ ...opts, auth: "basic" });
    expect(rp.requests[0].authorization).toBe(authHeader(token.plaintext, "basic"));
    expect(atob(rp.requests[0].authorization!.slice(6))).toBe(`x-access-token:${token.plaintext}`);
    rp.acceptBasic = false;
    await expect(pushCommit({ ...opts, parent: (await opts.repo.log({ limit: 1 }))[0].hash, changes: [{ path: "src/a.ts", content: "AA\n" }], auth: "basic" })).rejects.toMatchObject({ code: "auth" });
  });

  it("maps a network failure to a protocol rejection", async () => {
    const { opts } = await setup();
    await expect(pushCommit({ ...opts, fetch: (async () => { throw new TypeError("connection reset"); }) as typeof fetch }))
      .rejects.toMatchObject({ name: "PushRejected", code: "protocol", message: expect.stringContaining("connection reset") });
  });

  it("round-trips binary content byte for byte", async () => {
    const { repo, opts } = await setup();
    const bytes = new Uint8Array([0, 255, 254, 10, 0, 128, 1]);
    const out = await pushCommit({ ...opts, changes: [{ path: "assets/x.bin", content: bytes }] });
    const blob = await repo.readFile({ ref: out.commit, path: "assets/x.bin" });
    expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([...bytes]);
  });

  it("stores nothing from a refused push (quarantine)", async () => {
    const { repo, rp, opts, base } = await setup();
    const before = repo.store.objects.size;
    rp.rejectNext = "pre-receive hook declined";
    await expect(pushCommit(opts)).rejects.toMatchObject({ code: "rejected" });
    rp.advertiseHead = base; // the advertisement says base, but the ref is elsewhere: the server refuses
    repo.head = repo.commit({ other: "1" });
    const sizeAfterMove = repo.store.objects.size;
    await expect(pushCommit(opts)).rejects.toMatchObject({ code: "stale-head" });
    expect(repo.store.objects.size).toBe(sizeAfterMove);
    expect(sizeAfterMove - before).toBe(3); // only the local commit(): blob, tree, commit
    expect(rp.pushes).toHaveLength(2);
    expect(rp.pushes.every((p) => !repo.store.objects.has(p.new))).toBe(true);
  });

  it("refuses an unsafe path without contacting the remote", async () => {
    const { rp, opts } = await setup();
    await expect(pushCommit({ ...opts, changes: [{ path: "../escape", content: "x" }] })).rejects.toMatchObject({ code: "invalid-path" });
    expect(rp.requests).toEqual([]);
  });

  it("refuses a no-op change without contacting the remote", async () => {
    const { rp, opts } = await setup();
    await expect(pushCommit({ ...opts, changes: [] })).rejects.toMatchObject({ code: "no-change" });
    expect(rp.requests).toEqual([]);
  });
});

describe("protocol parsing", () => {
  it("reads the advertisement, including an empty repo", () => {
    const adv = concatBytes([pkt("# service=git-receive-pack\n"), FLUSH, pkt(`${"a".repeat(40)} refs/heads/main\0report-status\n`), pkt(`${"b".repeat(40)} refs/heads/x\n`), FLUSH]);
    expect([...parseAdvertisement(adv)]).toEqual([["refs/heads/main", "a".repeat(40)], ["refs/heads/x", "b".repeat(40)]]);
    const empty = concatBytes([pkt("# service=git-receive-pack\n"), FLUSH, pkt(`${"0".repeat(40)} capabilities^{}\0report-status\n`), FLUSH]);
    expect(parseAdvertisement(empty).size).toBe(0);
  });

  it("checks report-status, plain or side-banded", () => {
    const ok = concatBytes([pkt("unpack ok\n"), pkt("ok refs/heads/main\n"), FLUSH]);
    expect(() => checkReport(ok, "refs/heads/main")).not.toThrow();
    const banded = concatBytes([pkt(new Uint8Array([1, ...ok])), FLUSH]);
    expect(() => checkReport(banded, "refs/heads/main")).not.toThrow();
    const err = concatBytes([pkt(new Uint8Array([3, ...new TextEncoder().encode("quota exceeded")])), FLUSH]);
    expect(() => checkReport(err, "refs/heads/main")).toThrow(/quota/);
    expect(() => checkReport(concatBytes([pkt("unpack index-pack failed\n"), FLUSH]), "refs/heads/main")).toThrow(PushRejected);
    expect(() => checkReport(new Uint8Array(), "refs/heads/main")).toThrow(/no report-status/);
    expect(parsePkts(ok).pkts.filter(Boolean).map((p) => pktText(p!))).toEqual(["unpack ok", "ok refs/heads/main"]);
  });
});
