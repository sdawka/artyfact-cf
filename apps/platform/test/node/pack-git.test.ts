/**
 * The Worker's pack writer checked by real git: `git index-pack --stdin` accepts the pack and `git cat-file` reads
 * every object back with the same id. Runs in Node (always on; git is present locally and on CI runners).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeBlob, encodeCommit, encodeTree, hashObject } from "../../worker/git/objects";
import { buildPack } from "../../worker/git/pack";

// Never inherit GIT_DIR / GIT_INDEX_FILE etc. from a hook that runs these tests.
const ENV = Object.fromEntries(Object.entries(process.env as Record<string, string | undefined>).filter(([k]) => !k.startsWith("GIT_"))) as unknown as NodeJS.ProcessEnv;
let dir: string;
const git = (args: string[], input?: Uint8Array) => execFileSync("git", args, { cwd: dir, env: ENV, input, encoding: "utf8" }).trim();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "artyfact-pack-"));
  git(["init", "--bare", "-q", "."]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("buildPack against git", () => {
  it("is accepted by git index-pack and every object reads back with the same id", async () => {
    const hello = encodeBlob("hello\n");
    const big = encodeBlob("0123456789abcdef\n".repeat(20_000));
    const script = encodeBlob("#!/bin/sh\necho hi\n");
    const sub = encodeTree([{ name: "big.txt", hash: await hashObject(big), type: "blob" }]);
    const tree = encodeTree([
      { name: "hello.txt", hash: await hashObject(hello), type: "blob" },
      { name: "dir", hash: await hashObject(sub), type: "tree" },
      { name: "run.sh", hash: await hashObject(script), type: "exec" },
      { name: "dir.txt", hash: await hashObject(hello), type: "blob" },
    ]);
    const commit = encodeCommit({ tree: await hashObject(tree), parents: [], author: { name: "Ada", email: "ada@example.com", at: 1_700_000_000 }, message: "first" });
    const objects = [hello, big, script, sub, tree, commit];
    const pack = await buildPack(objects);

    const out = git(["index-pack", "--stdin", "--strict"], pack);
    expect(out).toMatch(/^pack\s+[0-9a-f]{40}$/m);
    const ids = await Promise.all(objects.map(hashObject));
    expect(git(["hash-object", "--stdin"], new TextEncoder().encode("hello\n"))).toBe(ids[0]);
    for (const [i, o] of objects.entries()) expect(git(["cat-file", "-t", ids[i]])).toBe(o.type);
    expect(git(["cat-file", "-p", ids[0]])).toBe("hello");
    expect(git(["cat-file", "-p", ids[4]]).split("\n")).toEqual([
      `100644 blob ${ids[0]}\tdir.txt`, // "dir.txt" < "dir/": a tree sorts as name + "/"
      `040000 tree ${ids[3]}\tdir`,
      `100644 blob ${ids[0]}\thello.txt`,
      `100755 blob ${ids[2]}\trun.sh`,
    ]);
    expect(git(["cat-file", "-p", ids[5]])).toBe(`tree ${ids[4]}\nauthor Ada <ada@example.com> 1700000000 +0000\ncommitter Ada <ada@example.com> 1700000000 +0000\n\nfirst`);
    expect(git(["cat-file", "-s", ids[1]])).toBe(String(17 * 20_000));
    git(["update-ref", "refs/heads/main", ids[5]]);
    expect(git(["fsck", "--strict", "--no-dangling"])).toBe("");
  });
});
