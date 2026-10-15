/**
 * The Worker's Git push against the real Artifacts service (namespace `artyfact-test`).
 * Opt-in: ARTYFACT_INTEGRATION=1 npm test -w @artyfact/platform -- --project integration test/integration/git-push.test.ts
 * Needs `wrangler` logged in. Creates one scratch repo `b1-push-<run>`, seeds it with git, then drives `pushCommit` (the
 * exact code the editor runs in the Worker) over smart HTTP with a 300 s write token, and deletes the repo afterwards.
 * Tokens travel only in the environment / headers and are never printed.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ITEST_NAMESPACE } from "artyfact/naming";
import type { ArtifactsRepoLike, CommitMeta, TreeEntry } from "../../worker/artifacts/client";
import { concatBytes, parseCommit, parseTree } from "../../worker/git/objects";
import { buildPack } from "../../worker/git/pack";
import { FLUSH, pkt } from "../../worker/git/pkt-line";
import { authHeader, checkReport, pushCommit, PushRejected } from "../../worker/git/push";

const run = promisify(execFile);
const ENV = process.env as Record<string, string | undefined>;
const ENABLED = ENV.ARTYFACT_INTEGRATION === "1";
const NS = ITEST_NAMESPACE;
const ROOT = resolve(__dirname, "../../../..");
const WRANGLER = join(ROOT, "node_modules/.bin/wrangler");
const wrangler = (...args: string[]) => run(WRANGLER, args, { cwd: resolve(__dirname, "../.."), maxBuffer: 1 << 24 });
const REPO = `b1-push-${Date.now().toString(36)}`;
const work = mkdtempSync(join(tmpdir(), "artyfact-push-"));
const local = join(work, "mirror.git");

let remote = "";
let token = "";
let created = false;

/** git without inherited GIT_* and with the write token as an extra header supplied through the environment. */
function git(args: string[], cwd = local, opts: { auth?: boolean; input?: Uint8Array } = {}): Buffer {
  const env: Record<string, string> = Object.fromEntries(Object.entries(ENV).filter(([k, v]) => !k.startsWith("GIT_") && v !== undefined)) as Record<string, string>;
  if (opts.auth) Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: ${authHeader(token)}` });
  Object.assign(env, { GIT_AUTHOR_NAME: "itest", GIT_AUTHOR_EMAIL: "itest@example.com", GIT_COMMITTER_NAME: "itest", GIT_COMMITTER_EMAIL: "itest@example.com" });
  return execFileSync("git", args, { cwd, env: env as unknown as NodeJS.ProcessEnv, input: opts.input, maxBuffer: 1 << 26 });
}

/** The binding's read surface, served from a local mirror fetched from the real remote. */
const mirrorRepo: ArtifactsRepoLike = {
  async readCommit(hash) {
    const c = parseCommit(new Uint8Array(git(["cat-file", "commit", hash])));
    const meta: CommitMeta = { hash, treeHash: c.tree, message: c.message, parents: c.parents, author: c.author, committer: c.committer, authoredAt: c.author.at, committedAt: c.committer.at };
    return meta;
  },
  async readTree(hash) {
    return parseTree(new Uint8Array(git(["cat-file", "tree", hash]))) as TreeEntry[];
  },
  async readBlob(hash) { return new Blob([new Uint8Array(git(["cat-file", "blob", hash]))]); },
  async readFile() { throw new Error("unused"); },
  async info() { throw new Error("unused"); },
  async createToken() { throw new Error("unused"); },
  async revokeToken() { throw new Error("unused"); },
  async fork() { throw new Error("unused"); },
  async log() { throw new Error("unused"); },
};

const fetchMain = () => {
  git(["fetch", "-q", remote, "+refs/heads/main:refs/heads/main"], local, { auth: true });
  return git(["rev-parse", "refs/heads/main"]).toString().trim();
};

/** Pick a string field from wrangler's JSON output, wherever the CLI nests it. */
function field(v: unknown, keys: string[]): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  for (const k of keys) if (typeof (v as Record<string, unknown>)[k] === "string") return (v as Record<string, string>)[k];
  for (const x of Object.values(v as Record<string, unknown>)) {
    const hit = field(x, keys);
    if (hit) return hit;
  }
  return undefined;
}

describe.skipIf(!ENABLED)("integration: Worker git push to real Artifacts", () => {
  beforeAll(async () => {
    const who = await wrangler("whoami");
    const accountId = /[0-9a-f]{32}/.exec(who.stdout)?.[0];
    if (!accountId) throw new Error("wrangler whoami shows no account id; run `wrangler login`");
    const out = JSON.parse((await wrangler("artifacts", "repos", "create", REPO, "--namespace", NS, "--default-branch", "main", "--json")).stdout) as unknown;
    created = true;
    remote = field(out, ["remote"]) ?? `https://${accountId}.artifacts.cloudflare.net/git/${NS}/${REPO}.git`;
    const tok = JSON.parse((await wrangler("artifacts", "repos", "issue-token", REPO, "--namespace", NS, "--scope", "write", "--ttl", "300", "--json")).stdout) as unknown;
    token = field(tok, ["plaintext", "token"]) ?? "";
    if (!token) throw new Error(`issue-token returned no token field (keys: ${Object.keys(tok as object).join(", ")})`);

    // Seed with stock git: README, a nested file and an executable.
    const seed = join(work, "seed");
    mkdirSync(join(seed, "src/deep"), { recursive: true });
    git(["init", "-q", "-b", "main", "."], seed);
    writeFileSync(join(seed, "README.md"), "seed\n");
    writeFileSync(join(seed, "src/a.ts"), "export const a = 1;\n");
    writeFileSync(join(seed, "src/deep/b.ts"), "export const b = 2;\n");
    writeFileSync(join(seed, "run.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
    git(["add", "-A"], seed);
    git(["commit", "-q", "-m", "seed"], seed);
    git(["push", "-q", remote, "main:refs/heads/main"], seed, { auth: true });
    mkdirSync(local, { recursive: true });
    git(["init", "--bare", "-q", "."]);
  }, 120_000);

  afterAll(async () => {
    if (created) await wrangler("artifacts", "repos", "delete", REPO, "--namespace", NS, "--force").catch((e: Error) => console.error(`cleanup ${REPO}: ${e.message.split("\n")[0]}`));
    rmSync(work, { recursive: true, force: true });
  }, 60_000);

  it("pushes a commit with pushCommit, chains a second, and maps stale and auth failures", async () => {
    const seedHead = fetchMain();
    const first = await pushCommit({
      remote, token, repo: mirrorRepo, parent: seedHead, message: "Edit from the Worker push path",
      author: { name: "ada", email: "ada@editor.artyfact.invalid" },
      changes: [{ path: "src/a.ts", content: "export const a = 42;\n" }, { path: "src/new/c.ts", content: "export const c = 3;\n" }, { path: "README.md", content: null }],
    });
    expect(fetchMain()).toBe(first.commit);
    expect(git(["cat-file", "-p", `${first.commit}:src/a.ts`]).toString()).toBe("export const a = 42;\n");
    expect(git(["cat-file", "-p", `${first.commit}:src/new/c.ts`]).toString()).toBe("export const c = 3;\n");
    expect(git(["ls-tree", "--name-only", first.commit]).toString().split("\n").filter(Boolean)).toEqual(["run.sh", "src"]);
    expect(git(["ls-tree", first.commit, "run.sh"]).toString()).toMatch(/^100755 /);
    expect(git(["log", "--format=%P %an %s", "-1", first.commit]).toString().trim()).toBe(`${seedHead} ada Edit from the Worker push path`);
    git(["fsck", "--strict", "--no-dangling"]);

    const second = await pushCommit({ remote, token, repo: mirrorRepo, parent: first.commit, message: "Second", author: { name: "ada", email: "a@b" }, changes: [{ path: "src/deep/b.ts", content: "export const b = 3;\n" }] });
    expect(fetchMain()).toBe(second.commit);

    // A stale parent is refused from the advertisement, before any pack is sent.
    await expect(pushCommit({ remote, token, repo: mirrorRepo, parent: first.commit, message: "stale", author: { name: "a", email: "a@b" }, changes: [{ path: "x", content: "x" }] }))
      .rejects.toMatchObject({ code: "stale-head" });

    // The server's own refusal of a stale update (bypassing the advertisement check) also maps to stale-head.
    const pack = await buildPack([]);
    const body = concatBytes([pkt(`${first.commit} ${seedHead} refs/heads/main\0report-status\n`), FLUSH, pack]);
    const res = await fetch(`${remote}/git-receive-pack`, { method: "POST", headers: { authorization: authHeader(token), "content-type": "application/x-git-receive-pack-request" }, body });
    const raw = new Uint8Array(await res.arrayBuffer());
    let mapped: unknown;
    try { checkReport(raw, "refs/heads/main"); } catch (e) { mapped = e; }
    console.info(`[itest] stale receive-pack: HTTP ${res.status}; ${JSON.stringify(new TextDecoder().decode(raw).slice(0, 200))} -> ${(mapped as PushRejected | undefined)?.code}`);
    expect(mapped).toMatchObject({ name: "PushRejected", code: "stale-head" });
    expect(fetchMain()).toBe(second.commit);

    await expect(pushCommit({ remote, token: "not-a-token", repo: mirrorRepo, parent: second.commit, message: "x", author: { name: "a", email: "a@b" }, changes: [{ path: "x", content: "x" }] }))
      .rejects.toMatchObject({ code: "auth" });
  }, 120_000);
});
