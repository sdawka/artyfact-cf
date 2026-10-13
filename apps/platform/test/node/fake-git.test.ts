/**
 * The FAKE_ARTIFACTS git server checked by real git: clone a seeded repo, push a commit (thin pack with deltas), clone
 * the pushed head again with the same ids, and fetch an update. This is what lets `artyfact claim` and `submit` run
 * against the fake platform. Runs in Node (git is present locally and on CI runners).
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeArtifacts } from "../../worker/artifacts/fake";
import { fakeReceivePack } from "../../worker/artifacts/fake-receive-pack";

const BASE = "https://fake.artifacts.local/git/artyfact";
const clean = Object.fromEntries(Object.entries(process.env as Record<string, string | undefined>).filter(([k]) => !k.startsWith("GIT_"))) as Record<string, string>;
const big = Array.from({ length: 4000 }, (_, i) => `line ${i} of a file that is long enough for git to deltify\n`).join("");

let ns: FakeArtifacts;
let server: Server;
let work: string;
let token: string;
let url: string;
let transport: ReturnType<typeof fakeReceivePack>;
const platformCalls: { path: string; body: Record<string, unknown> }[] = [];
const CLI = join(import.meta.dirname, "../../../../packages/cli/bin/artyfact.js");
const SECRET = "ab".repeat(32);

function gitEnv(header = true): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    ...clean, GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: header ? "2" : "1",
    GIT_CONFIG_KEY_0: `url.${url}/api/fake-git/.insteadOf`, GIT_CONFIG_VALUE_0: `${BASE}/`,
  };
  if (header) Object.assign(env, { GIT_CONFIG_KEY_1: "http.extraHeader", GIT_CONFIG_VALUE_1: `Authorization: Bearer ${token}` });
  return env as unknown as NodeJS.ProcessEnv;
}
// Async: the fake server runs in this process, so a blocking exec would deadlock it.
const run = promisify(execFile);
const git = async (cwd: string, args: string[], header = true) => (await run("git", args, { cwd, env: gitEnv(header), encoding: "utf8", timeout: 30_000 })).stdout.trim();

beforeAll(async () => {
  ns = new FakeArtifacts();
  ns.remoteBase = BASE;
  const repo = ns.create("app");
  repo.commit({ "big.txt": big, "src/x.ts": "export const x = 1;\n", "src/sub/y.ts": "y\n", "src.txt": "sorted before src/\n", "README.md": "# app\n" }, "seed");
  token = (await repo.createToken("write")).plaintext;
  transport = fakeReceivePack(ns);
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    if (req.url?.startsWith("/api/systems/")) {
      // Just enough of the lifecycle task routes for the CLI: claim hands out the seeded fork, submit records the commit.
      const path = req.url, input = body ? JSON.parse(body.toString()) : {};
      platformCalls.push({ path, body: input });
      const out = path.endsWith("/claim") || path.endsWith("/start")
        ? { attempt: { id: "attempt.1", generation: 1 }, secret: SECRET, token: { value: token, expiresAt: "2099-01-01T00:00:00Z", remote: ns.remoteOf("app") }, remote: ns.remoteOf("app"), packet: { markdown: "# Task\n" }, reviewUrl: `${url}/review` }
        : { ok: true };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    const r = await transport.fetch(`http://localhost${req.url}`, { method: req.method, headers, ...(body && { body }) });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  work = mkdtempSync(join(tmpdir(), "artyfact-fake-git-"));
});
afterAll(() => {
  server?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("fake git server against git", { timeout: 60_000 }, () => {
  it("clones with the seeded ids, takes a delta push, serves the pushed head back and answers a fetch", async () => {
    const repo = ns.repo("app");
    const seeded = repo.head!;
    expect(ns.remoteOf("app")).toBe(`${BASE}/app.git`);

    // Without the bearer header the server refuses.
    await expect(git(work, ["clone", "-q", "--", ns.remoteOf("app"), "anon"], false)).rejects.toThrow();

    const a = join(work, "a");
    await git(work, ["clone", "-q", "--", ns.remoteOf("app"), a]);
    expect(await git(a, ["rev-parse", "HEAD"])).toBe(seeded);
    await git(a, ["fsck", "--strict", "--no-dangling"]);
    expect(readFileSync(join(a, "src/sub/y.ts"), "utf8")).toBe("y\n");

    // A one-line edit of a large file: git sends it as a delta against the blob the server has.
    writeFileSync(join(a, "big.txt"), big.replace("line 7 of", "line seven of"));
    writeFileSync(join(a, "src/new.ts"), "export {};\n");
    await git(a, ["add", "-A"]);
    await git(a, ["commit", "-q", "-m", "edit"]);
    await git(a, ["push", "-q", "origin", "HEAD:main"]);
    const pushed = await git(a, ["rev-parse", "HEAD"]);
    expect(repo.head).toBe(pushed);
    const last = transport.pushes.at(-1)!;
    expect(last.new).toBe(pushed);

    const b = join(work, "b");
    await git(work, ["clone", "-q", "--", ns.remoteOf("app"), b]);
    expect(await git(b, ["rev-parse", "HEAD"])).toBe(pushed);
    await git(b, ["fsck", "--strict", "--no-dangling"]);
    expect(readFileSync(join(b, "big.txt"), "utf8")).toContain("line seven of");

    writeFileSync(join(a, "src/x.ts"), "export const x = 2;\n");
    await git(a, ["commit", "-q", "-am", "again"]);
    await git(a, ["push", "-q", "origin", "HEAD:main"]);
    await git(b, ["fetch", "-q", "origin"]);
    expect(await git(b, ["rev-parse", "origin/main"])).toBe(repo.head);
    await git(b, ["merge", "-q", "--ff-only", "origin/main"]);
    expect(readFileSync(join(b, "src/x.ts"), "utf8")).toBe("export const x = 2;\n");
  });

  it("lets the CLI claim a task over the fake remote and submit by pushing to it", async () => {
    const repo = ns.repo("app");
    const dir = join(work, "claimed");
    // The CLI blocks on git, so it runs in its own process while this one serves.
    const env = {
      ...gitEnv(false), ARTYFACT_ADMIN_TOKEN: "admin", ARTYFACT_ALLOW_REMOTE_HOST: "fake.artifacts.local",
    } as unknown as NodeJS.ProcessEnv;
    const cli = (args: string[], extra: Record<string, string> = {}, cwd = work) => run("node", [CLI, ...args], { cwd, env: { ...env, ...extra } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 });
    const claimed = await cli(["task", "claim", "plan.one", "t1", "--system", "system.one", "--dir", dir, "--platform", url]);
    expect(claimed.stdout).toContain("Task workspace ready");
    expect(readFileSync(join(dir, "src/x.ts"), "utf8").length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "TASK_PACKET.md"))).toBe(true);
    expect(await git(dir, ["rev-parse", "HEAD"])).toBe(repo.head);

    writeFileSync(join(dir, "src/claimed.ts"), "export const claimed = true;\n");
    const before = transport.pushes.length;
    await cli(["task", "submit"], { ARTYFACT_TOKEN: token }, dir).catch((e) => { throw new Error(String(e.stderr ?? e)); });
    const pushed = await git(dir, ["rev-parse", "HEAD"]);
    expect(transport.pushes.length).toBe(before + 1);
    expect(repo.head).toBe(pushed);
    expect(platformCalls.at(-1)).toMatchObject({ path: expect.stringContaining("/tasks/t1/submit"), body: { commit: pushed, attemptId: "attempt.1" } });
  });
});
