import { describe, expect, it } from "vitest";
import {
  encodeBlob, encodeCommit, encodeTree, hashObject, normalizeMode, parseCommit, parseTree, rawObject, sha1Hex, sortTreeItems,
} from "../../worker/git/objects";

/** Golden ids from `git hash-object` / `git write-tree` / `git commit-tree` (see test/node/pack-git.test.ts). */
const HELLO = "ce013625030ba8dba906f756967f9e9ca394464a";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const DIR_A = "add4794d9c94872b96c1697c056fb82ae0d72880"; // tree { b.txt: "x\n" }
const MIXED_TREE = "4fc2be38834c168179ea8d36109b10811d241170";
const FIRST_COMMIT = "fa3e925c2dae5cd6c3831f239c7ae96bde2de71a";

const blob = async (s: string) => hashObject(encodeBlob(s));

describe("git objects", () => {
  it("sha1Hex matches the SHA-1 test vector", async () => {
    expect(await sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("hashes blobs like git hash-object", async () => {
    expect(await blob("hello\n")).toBe(HELLO);
    expect(await blob("")).toBe(EMPTY_BLOB);
    expect(new TextDecoder().decode(rawObject(encodeBlob("hello\n")))).toBe("blob 6\0hello\n");
  });

  it("hashes the empty tree", async () => {
    expect(await hashObject(encodeTree([]))).toBe(EMPTY_TREE);
  });

  it("orders trees as git does (a tree compares as name/) and keeps exec/symlink modes", async () => {
    expect(await hashObject(encodeTree([{ name: "b.txt", hash: await blob("x\n"), type: "blob" }]))).toBe(DIR_A);
    const items = [
      { name: "run.sh", hash: await blob("#!/bin/sh\n"), type: "exec" as const },
      { name: "a", hash: DIR_A, type: "tree" as const },
      { name: "link", hash: await blob("a.txt"), type: "symlink" as const },
      { name: "a.txt", hash: HELLO, type: "blob" as const },
      { name: "a-b", hash: await blob("y\n"), type: "blob" as const },
    ];
    expect(sortTreeItems(items).map((e) => e.name)).toEqual(["a-b", "a.txt", "a", "link", "run.sh"]);
    const tree = encodeTree(items);
    expect(await hashObject(tree)).toBe(MIXED_TREE);
    expect(parseTree(tree.body).map((e) => `${e.mode} ${e.type} ${e.name}`)).toEqual([
      "100644 blob a-b", "100644 blob a.txt", "40000 tree a", "120000 symlink link", "100755 exec run.sh",
    ]);
  });

  it("normalises raw modes the way git does", () => {
    expect(normalizeMode({ mode: "040000" })).toBe("40000");
    expect(normalizeMode({ mode: "100664" })).toBe("100644");
    expect(normalizeMode({ mode: "100775" })).toBe("100755");
    expect(normalizeMode({ mode: "120000" })).toBe("120000");
    expect(normalizeMode({ mode: "100644", type: "exec" })).toBe("100755");
    expect(() => normalizeMode({ mode: "777" })).toThrow(/unsupported/);
  });

  it("refuses invalid or duplicate entry names", () => {
    expect(() => encodeTree([{ name: "a/b", hash: HELLO, type: "blob" }])).toThrow(/invalid/);
    expect(() => encodeTree([{ name: "..", hash: HELLO, type: "blob" }])).toThrow(/invalid/);
    expect(() => encodeTree([{ name: "x", hash: HELLO, type: "blob" }, { name: "x", hash: HELLO, type: "blob" }])).toThrow(/duplicate/);
  });

  it("encodes a commit like git commit-tree and parses it back", async () => {
    const author = { name: "Ada", email: "ada@example.com", at: 1_700_000_000 };
    const c = encodeCommit({ tree: MIXED_TREE, parents: [], author, message: "first" });
    expect(await hashObject(c)).toBe(FIRST_COMMIT);
    const child = encodeCommit({ tree: EMPTY_TREE, parents: [FIRST_COMMIT], author: { name: "Bo <x>", email: "bo@\nexample.com", at: 5, tz: "-0700" }, message: "second\n\nbody\n" });
    const parsed = parseCommit(child.body);
    expect(parsed).toEqual({
      tree: EMPTY_TREE, parents: [FIRST_COMMIT],
      author: { name: "Bo x", email: "bo@example.com", at: 5, tz: "-0700" },
      committer: { name: "Bo x", email: "bo@example.com", at: 5, tz: "-0700" },
      message: "second\n\nbody\n",
    });
  });
});
