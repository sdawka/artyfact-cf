/**
 * The FAKE_ARTIFACTS git server checked by real git: clone a seeded repo, push a commit (thin pack with deltas), clone
 * the pushed head again with the same ids, and fetch an update. This is what lets `artyfact claim` and `submit` run
 * against the fake platform. Runs in Node (git is present locally and on CI runners).
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});
