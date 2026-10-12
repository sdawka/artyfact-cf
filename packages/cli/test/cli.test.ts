import { execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync, statSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/main";
import { assertId, assertRemote, assertSecret, assertToken, commitIfDirty, gitEnv } from "../src/git";

const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const tmp = mkdtempSync(join(tmpdir(), "artyfact-cli-"));
const bare = join(tmp, "fork.git");
const REMOTE = "https://artifacts.invalid/git/ns/kit-app--r1.git";
const REMOTE2 = "https://artifacts.invalid/git/ns/other.git";
let packetRemote = REMOTE;
const SECRET = "a1".repeat(32);
const SECRET2 = "b2".repeat(32);
const calls: { method: string; url: string; body: any; auth?: string }[] = [];
let server: Server;
let base = "";

const packet = () => ({
  systemId: "system.keep-in-touch", realizationId: "r-1", evolutionId: "evolution.1", hash: "abc",
  markdown: "# Task\nDo it", acceptanceCriteria: [{ id: "crit.a" }, { id: "crit.b" }],
  permittedPaths: ["src/ui/people/**"], protectedPaths: ["system/**"], commands: ["npm install", "npm test"],
  workspace: { remote: packetRemote, fork: "kit-app--r1" },
});

beforeAll(async () => {
  sh(tmp, "init", "--bare", "-b", "main", bare);
  const seed = join(tmp, "seed");
  sh(tmp, "init", "-b", "main", seed);
  writeFileSync(join(seed, "a.txt"), "hi");
  sh(seed, "add", "-A");
  sh(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
  sh(seed, "push", bare, "main");
  // Map the https remote onto the local bare repo so clone/push work offline.
  const bare2 = join(tmp, "fork2.git");
  sh(tmp, "init", "--bare", "-b", "main", bare2);
  const seed2 = join(tmp, "seed2");
  sh(tmp, "init", "-b", "main", seed2);
  writeFileSync(join(seed2, "AGENTS.md"), "# Mine\n");
  sh(seed2, "add", "-A");
  sh(seed2, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
  sh(seed2, "push", bare2, "main");
  process.env.ARTYFACT_ALLOW_REMOTE_HOST = "artifacts.invalid";
  process.env.GIT_CONFIG_COUNT = "2";
  process.env.GIT_CONFIG_KEY_0 = `url.${bare}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = REMOTE;
  process.env.GIT_CONFIG_KEY_1 = `url.${bare2}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_1 = REMOTE2;
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : undefined, auth: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      if (req.url!.endsWith("/packet")) return res.end(JSON.stringify({ packet: packet() }));
      if (req.url!.endsWith("/submit"))
        return res.end(JSON.stringify({ evaluations: [{ criterion: "crit.a", verdict: "pass", execution: "completed" }],
          conflicts: [{ kind: "soft-semantic", subjects: ["policy.ownerOnly"], message: "overlap" }] }));
      if (req.url!.endsWith("/checkpoints")) return res.end("{}");
      res.end(JSON.stringify({ realization: { status: "working", workspace: { tokenExpiresAt: "2030-01-01T00:00:00Z" } }, evaluations: [], conflicts: [] }));
    });
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

function run(argv: string[], cwd = tmp, env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  return main(argv, { cwd, env: { ...process.env, ARTYFACT_URL: base, ARTYFACT_TOKEN: "tok123", ARTYFACT_SECRET: SECRET, ...env }, out: (s) => out.push(s), err: (s) => err.push(s) })
    .then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }));
}

describe("artyfact cli", () => {
  const ws = join(tmp, "ws");

  it("start writes packet, AGENTS.md, config and excludes config", async () => {
    const r = await run(["start", "r-1", "--dir", ws, "--system", "system.keep-in-touch", "--evolution", "evolution.1"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(ws, "TASK_PACKET.md"), "utf8")).toContain("Do it");
    const agents = readFileSync(join(ws, "AGENTS.md"), "utf8");
    expect(agents).toContain("src/ui/people/**");
    expect(agents).toContain("crit.a, crit.b");
    expect(agents).toContain("npm install; npm test");
    const cfg = JSON.parse(readFileSync(join(ws, ".artyfact.json"), "utf8"));
    expect(cfg).toMatchObject({ platform: base, systemId: "system.keep-in-touch", realizationId: "r-1", forkRepo: "kit-app--r1", remote: REMOTE, packetHash: "abc" });
    expect(readFileSync(join(ws, ".git/info/exclude"), "utf8")).toContain(".artyfact.json");
    expect(existsSync(join(ws, "a.txt"))).toBe(true);
    expect(sh(ws, "status", "--porcelain")).toBe("");
    const ex = readFileSync(join(ws, ".git/info/exclude"), "utf8").split("\n");
    expect(ex).toEqual(expect.arrayContaining([".artyfact.json", "TASK_PACKET.md", "AGENTS.md", "node_modules", ".wrangler", "dist/", ".dev.vars*", ".env*", "!*.example"]));
    expect(cfg.secret).toBe(SECRET);
    expect(statSync(join(ws, ".artyfact.json")).mode & 0o777).toBe(0o600);
    expect(calls.find((x) => x.url.endsWith("/packet"))!.auth).toBe(`Bearer ${SECRET}`);
    expect(r.out).not.toContain(SECRET);
  });

  it("checkpoint commits and posts the commit", async () => {
    writeFileSync(join(ws, "b.txt"), "x");
    // No ARTYFACT_SECRET: the secret saved by start authenticates the call.
    const r = await run(["checkpoint", "added b"], ws, { ARTYFACT_SECRET: "" });
    expect(r.code).toBe(0);
    const c = calls.find((x) => x.url.endsWith("/checkpoints"))!;
    expect(c.url).toBe("/api/systems/system.keep-in-touch/evolutions/evolution.1/realizations/r-1/checkpoints");
    expect(c.body.message).toBe("added b");
    expect(c.body.commit).toBe(sh(ws, "rev-parse", "HEAD"));
    expect(c.auth).toBe(`Bearer ${SECRET}`);
    expect(sh(ws, "show", "--name-only", "--format=", "HEAD")).toBe("b.txt");
  });

  it("submit pushes, posts and prints evaluations and conflicts", async () => {
    writeFileSync(join(ws, "c.txt"), "y");
    const r = await run(["submit", "--preview-url", "http://p"], ws);
    expect(r.code).toBe(0);
    const head = sh(ws, "rev-parse", "HEAD");
    expect(sh(bare, "rev-parse", "main")).toBe(head);
    const c = calls.find((x) => x.url.endsWith("/submit"))!;
    expect(c.body).toEqual({ commit: head, previewUrl: "http://p" });
    expect(c.auth).toBe(`Bearer ${SECRET}`);
    expect(r.out).toMatch(/crit\.a\s+pass\s+completed/);
    expect(r.out).toContain("policy.ownerOnly");
  });

  it("commitIfDirty never stages node_modules, .wrangler or secret files, even without any ignore rules", () => {
    const repo = join(tmp, "stage");
    sh(tmp, "init", "-q", "-b", "main", repo);
    writeFileSync(join(repo, "keep.txt"), "1");
    sh(repo, "add", "-A");
    sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
    const first = sh(repo, "rev-parse", "HEAD");
    // Only a secret and dependencies changed: nothing is committed.
    mkdirSync(join(repo, "node_modules/x"), { recursive: true });
    writeFileSync(join(repo, "node_modules/x/index.js"), "x");
    mkdirSync(join(repo, "app/.wrangler/state"), { recursive: true });
    writeFileSync(join(repo, "app/.wrangler/state/db.sqlite"), "x");
    writeFileSync(join(repo, ".dev.vars"), "SECRET=1");
    // A symlinked node_modules (the demo runbook shares the checkout's) is a file to git, not a directory.
    mkdirSync(join(repo, "sub"), { recursive: true });
    symlinkSync(join(repo, "node_modules"), join(repo, "sub/node_modules"));
    const notes: string[] = [];
    expect(commitIfDirty(repo, "only secrets", (s) => notes.push(s))).toBe(first);
    expect(notes.join("\n")).toContain(".dev.vars");
    // A real change is committed without them; examples are kept.
    writeFileSync(join(repo, "src.ts"), "export {}");
    writeFileSync(join(repo, ".dev.vars.example"), "DEV_AUTH_HEADER=1");
    writeFileSync(join(repo, ".env.local"), "TOKEN=1");
    mkdirSync(join(repo, "app"), { recursive: true });
    writeFileSync(join(repo, "app/.env"), "TOKEN=2");
    const head = commitIfDirty(repo, "work");
    expect(head).not.toBe(first);
    expect(sh(repo, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([".dev.vars.example", "src.ts"]);
    expect(sh(repo, "ls-files")).not.toMatch(/node_modules|\.wrangler|\.dev\.vars$|\.env/);
  });

  it("status --json has stable shape", async () => {
    // ARTYFACT_SECRET overrides the saved secret.
    const r = await run(["status", "--json"], ws, { ARTYFACT_SECRET: SECRET2 });
    expect(calls.at(-1)!.auth).toBe(`Bearer ${SECRET2}`);
    expect(JSON.parse(r.out)).toEqual({ realizationId: "r-1", status: "working", evaluations: [], conflicts: [], tokenExpires: "2030-01-01T00:00:00Z" });
  });

  it("start requires a well-formed realization secret and never echoes it", async () => {
    const before = calls.length;
    const none = await run(["start", "r-1", "--dir", join(tmp, "nosec"), "--system", "s", "--evolution", "e"], tmp, { ARTYFACT_SECRET: "" });
    expect(none.code).toBe(1);
    expect(none.err).toContain("ARTYFACT_SECRET");
    const bad = await run(["start", "r-1", "--dir", join(tmp, "nosec"), "--system", "s", "--evolution", "e"], tmp, { ARTYFACT_SECRET: "x\r\nX-Evil: 1" });
    expect(bad.code).toBe(1);
    expect(bad.err).not.toContain("X-Evil");
    expect(calls.length).toBe(before);
    expect(() => assertSecret("A1".repeat(32))).toThrow();
    expect(assertSecret(SECRET)).toBe(SECRET);
  });

  it("start requires --system and --evolution", async () => {
    const r = await run(["start", "r-1", "--dir", join(tmp, "nosys")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("platform's printed CLI line");
  });

  it("errors are non-zero without a stack", async () => {
    expect((await run(["status"], tmp)).code).toBe(1);
    expect((await run(["bogus"])).code).toBe(1);
    const noTok = await main(["start", "r-9", "--dir", join(tmp, "x"), "--system", "s", "--evolution", "e"], { cwd: tmp, env: { ARTYFACT_URL: base }, out: () => {}, err: () => {} });
    expect(noTok).toBe(1);
    expect((await run(["compose", "r-1", "r-2"])).out).toContain("not implemented");
  });

  describe("security", () => {
    it("passes the token via env, never argv", async () => {
      const env = gitEnv("sekret", {});
      expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
      expect(env.GIT_CONFIG_VALUE_0).toBe("Authorization: Bearer sekret");
      expect(gitEnv("t", { GIT_CONFIG_COUNT: "1" }).GIT_CONFIG_KEY_1).toBe("http.extraHeader");
      // Real run with a git shim on PATH that records every argv.
      const shim = join(tmp, "shim");
      const log = join(tmp, "argv.log");
      mkdirSync(shim);
      const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      writeFileSync(join(shim, "git"), `#!/bin/sh\nprintf '%s\\n' "$@" >> ${log}\nexec ${realGit} "$@"\n`);
      chmodSync(join(shim, "git"), 0o755);
      const oldPath = process.env.PATH;
      process.env.PATH = `${shim}:${oldPath}`;
      try {
        const d = join(tmp, "ws-shim");
        expect((await run(["start", "r-1", "--dir", d, "--system", "system.keep-in-touch", "--evolution", "evolution.1"])).code).toBe(0);
        writeFileSync(join(d, "z.txt"), "z");
        expect((await run(["submit"], d)).code).toBe(0);
      } finally {
        process.env.PATH = oldPath;
      }
      const argv = readFileSync(log, "utf8");
      expect(argv).toContain("clone");
      expect(argv).toContain("push");
      expect(argv).not.toContain("tok123");
      expect(argv).not.toContain("Bearer");
    });

    it("writes the token to no file in the workspace or git config", () => {
      const walk = (d: string): string[] =>
        execFileSync("find", [d, "-type", "f", "-not", "-path", "*/objects/*"], { encoding: "utf8" }).split("\n").filter(Boolean);
      for (const f of walk(ws)) {
        expect(readFileSync(f, "utf8"), f).not.toContain("tok123");
        // The realization secret lives only in the 0600, git-excluded config.
        if (!f.endsWith(".artyfact.json")) expect(readFileSync(f, "utf8"), f).not.toContain(SECRET);
      }
    });

    it("strips a token the platform leaks in the packet", async () => {
      const ws2 = join(tmp, "ws2");
      const orig = packet;
      const leakyServer = createServer((_req, res) => {
        res.setHeader("content-type", "application/json");
        const p = { ...orig(), markdown: `secret leaked-tok here ${SECRET}`, workspace: { remote: packetRemote, fork: "kit-app--r1", token: "leaked-tok", secret: SECRET } };
        res.end(JSON.stringify({ packet: p }));
      }).listen(0);
      await new Promise((r) => leakyServer.once("listening", r));
      const url = `http://127.0.0.1:${(leakyServer.address() as any).port}`;
      const code = await main(["start", "r-1", "--dir", ws2, "--system", "system.keep-in-touch", "--evolution", "evolution.1"], { cwd: tmp, env: { ...process.env, ARTYFACT_URL: url, ARTYFACT_TOKEN: "", ARTYFACT_SECRET: SECRET }, out: () => {}, err: () => {} });
      leakyServer.close();
      expect(code).toBe(0);
      for (const f of ["TASK_PACKET.md", "AGENTS.md", ".artyfact.json"]) expect(readFileSync(join(ws2, f), "utf8")).not.toContain("leaked-tok");
      for (const f of ["TASK_PACKET.md", "AGENTS.md"]) expect(readFileSync(join(ws2, f), "utf8")).not.toContain(SECRET);
    });

    it("lists .artyfact.json in the clone's .git/info/exclude", () => {
      expect(readFileSync(join(ws, ".git/info/exclude"), "utf8").split("\n")).toContain(".artyfact.json");
      expect(sh(ws, "status", "--porcelain")).not.toContain(".artyfact.json");
    });

    it("refuses a non-empty --dir that is not our clone, without writing through symlinks", async () => {
      const victim = join(tmp, "victim.txt");
      writeFileSync(victim, "original");
      const dir = join(tmp, "evil");
      mkdirSync(dir);
      symlinkSync(victim, join(dir, "TASK_PACKET.md"));
      const r = await run(["start", "r-1", "--dir", dir, "--system", "system.keep-in-touch", "--evolution", "evolution.1"]);
      expect(r.code).toBe(1);
      expect(readFileSync(victim, "utf8")).toBe("original");
    });

    it("refuses to write through a symlink even inside our own clone", async () => {
      const victim = join(tmp, "victim2.txt");
      writeFileSync(victim, "original");
      const dir = join(tmp, "ws3");
      expect((await run(["start", "r-1", "--dir", dir, "--system", "system.keep-in-touch", "--evolution", "evolution.1"])).code).toBe(0);
      execFileSync("rm", [join(dir, "AGENTS.md")]);
      symlinkSync(victim, join(dir, "AGENTS.md"));
      const r = await run(["start", "r-1", "--dir", dir, "--system", "system.keep-in-touch", "--evolution", "evolution.1"]);
      expect(r.code).toBe(1);
      expect(readFileSync(victim, "utf8")).toBe("original");
    });

    it("rejects option-like ids and non-https remotes", async () => {
      expect(() => assertId("id", "--upload-pack=x")).toThrow();
      expect(() => assertId("id", "a/b")).toThrow();
      expect(() => assertId("id", "..")).toThrow();
      expect(assertId("id", "system.keep-in-touch")).toBe("system.keep-in-touch");
      expect(() => assertRemote("r", "ext::sh -c x", {})).toThrow();
      expect(() => assertRemote("r", "/tmp/repo", {})).toThrow();
      const r = await run(["start", "--", "--upload-pack=x"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("invalid");
    });

    it("pins the remote host and path", () => {
      const good = `https://${"a".repeat(32)}.artifacts.cloudflare.net/git/ns/repo.git`;
      expect(assertRemote("r", good, {})).toBe(good);
      expect(() => assertRemote("r", "https://evil.example/git/ns/repo.git", {})).toThrow();
      expect(() => assertRemote("r", `https://${"a".repeat(32)}.artifacts.cloudflare.net.evil.com/git/ns/repo.git`, {})).toThrow();
      expect(() => assertRemote("r", `https://u:p@${"a".repeat(32)}.artifacts.cloudflare.net/git/ns/repo.git`, {})).toThrow();
      expect(() => assertRemote("r", `https://${"a".repeat(32)}.artifacts.cloudflare.net/other/repo.git`, {})).toThrow();
      expect(() => assertRemote("r", "https://evil.example/git/ns/repo.git", { ARTYFACT_ALLOW_REMOTE_HOST: "other.example" })).toThrow();
      expect(assertRemote("r", "https://evil.example/git/ns/repo.git", { ARTYFACT_ALLOW_REMOTE_HOST: "evil.example" })).toBeTruthy();
    });

    it("rejects tokens that could inject header lines", () => {
      expect(() => assertToken("abc\r\nX-Evil: 1")).toThrow();
      expect(assertToken("abc.DEF-123_~+/=")).toBeTruthy();
      expect(assertToken("art_v1_0123abcd?expires=1760000000")).toBeTruthy();
    });

    it("submit pushes to the configured remote, not whatever origin says", async () => {
      const d = join(tmp, "ws-origin");
      expect((await run(["start", "r-1", "--dir", d, "--system", "system.keep-in-touch", "--evolution", "evolution.1"])).code).toBe(0);
      sh(d, "remote", "set-url", "origin", "https://evil.invalid/git/ns/x.git");
      writeFileSync(join(d, "o.txt"), "o");
      const r = await run(["submit"], d);
      expect(r.code).toBe(0);
      expect(sh(bare, "rev-parse", "main")).toBe(sh(d, "rev-parse", "HEAD"));
    });

    it("keeps a tracked AGENTS.md and merges the block idempotently", async () => {
      packetRemote = REMOTE2;
      try {
        const d = join(tmp, "ws-tracked");
        const args = ["start", "r-1", "--dir", d, "--system", "system.keep-in-touch", "--evolution", "evolution.1"];
        expect((await run(args)).code).toBe(0);
        const first = readFileSync(join(d, "AGENTS.md"), "utf8");
        expect(first).toContain("# Mine");
        expect(first.match(/artyfact:start/g)).toHaveLength(1);
        expect(first).toContain("src/ui/people/**");
        expect(readFileSync(join(d, ".git/info/exclude"), "utf8").split("\n")).not.toContain("AGENTS.md");
        expect((await run(args)).code).toBe(0);
        expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toBe(first);
      } finally {
        packetRemote = REMOTE;
      }
    });

    it("rejects a corrupt config with context", async () => {
      const d = join(tmp, "ws-corrupt");
      mkdirSync(d);
      writeFileSync(join(d, ".artyfact.json"), "{nope");
      const r = await run(["status"], d);
      expect(r.code).toBe(1);
      expect(r.err).toContain("invalid .artyfact.json");
    });
  });

  it("the real binary runs under node (type stripping)", () => {
    const bin = fileURLToPath(new URL("../bin/artyfact.js", import.meta.url));
    const help = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("artyfact <command>");
    const bad = spawnSync(process.execPath, [bin, "start", "r-1"], { encoding: "utf8", env: { ...process.env, ARTYFACT_SYSTEM: "", ARTYFACT_EVOLUTION: "" } });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("platform's printed CLI line");
  });
});
