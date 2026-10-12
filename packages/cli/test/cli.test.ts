import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/main";
import { assertHttpsUrl, assertId, gitEnv } from "../src/git";

const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const tmp = mkdtempSync(join(tmpdir(), "artyfact-cli-"));
const bare = join(tmp, "fork.git");
const REMOTE = "https://artifacts.invalid/git/ns/kit-app--r1.git";
const calls: { method: string; url: string; body: any }[] = [];
let server: Server;
let base = "";

const packet = () => ({
  systemId: "system.keep-in-touch", realizationId: "r-1", evolutionId: "evolution.1", hash: "abc",
  markdown: "# Task\nDo it", acceptanceCriteria: [{ id: "crit.a" }, { id: "crit.b" }],
  permittedPaths: ["src/ui/people/**"], protectedPaths: ["system/**"], commands: ["npm install", "npm test"],
  workspace: { remote: REMOTE, fork: "kit-app--r1" },
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
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${bare}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = REMOTE;
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : undefined });
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

function run(argv: string[], cwd = tmp) {
  const out: string[] = [], err: string[] = [];
  return main(argv, { cwd, env: { ...process.env, ARTYFACT_URL: base, ARTYFACT_TOKEN: "tok123" }, out: (s) => out.push(s), err: (s) => err.push(s) })
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
  });

  it("checkpoint commits and posts the commit", async () => {
    writeFileSync(join(ws, "b.txt"), "x");
    const r = await run(["checkpoint", "added b"], ws);
    expect(r.code).toBe(0);
    const c = calls.find((x) => x.url.endsWith("/checkpoints"))!;
    expect(c.url).toBe("/api/systems/system.keep-in-touch/evolutions/evolution.1/realizations/r-1/checkpoints");
    expect(c.body.message).toBe("added b");
    expect(c.body.commit).toBe(sh(ws, "rev-parse", "HEAD"));
  });

  it("submit pushes, posts and prints evaluations and conflicts", async () => {
    writeFileSync(join(ws, "c.txt"), "y");
    const r = await run(["submit", "--preview-url", "http://p"], ws);
    expect(r.code).toBe(0);
    const head = sh(ws, "rev-parse", "HEAD");
    expect(sh(bare, "rev-parse", "main")).toBe(head);
    const c = calls.find((x) => x.url.endsWith("/submit"))!;
    expect(c.body).toEqual({ commit: head, previewUrl: "http://p" });
    expect(r.out).toMatch(/crit\.a\s+pass\s+completed/);
    expect(r.out).toContain("policy.ownerOnly");
  });

  it("status --json has stable shape", async () => {
    const r = await run(["status", "--json"], ws);
    expect(JSON.parse(r.out)).toEqual({ realizationId: "r-1", status: "working", evaluations: [], conflicts: [], tokenExpires: "2030-01-01T00:00:00Z" });
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
    it("passes the token via env, never argv", () => {
      const env = gitEnv("sekret", {});
      expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
      expect(env.GIT_CONFIG_VALUE_0).toBe("Authorization: Bearer sekret");
      expect(gitEnv("t", { GIT_CONFIG_COUNT: "1" }).GIT_CONFIG_KEY_1).toBe("http.extraHeader");
      const src = readFileSync(new URL("../src/git.ts", import.meta.url), "utf8");
      expect(src).not.toMatch(/\["-c",\s*`http\.extraHeader/);
    });

    it("writes the token to no file in the workspace or git config", () => {
      const walk = (d: string): string[] =>
        execFileSync("find", [d, "-type", "f", "-not", "-path", "*/objects/*"], { encoding: "utf8" }).split("\n").filter(Boolean);
      for (const f of walk(ws)) expect(readFileSync(f, "utf8"), f).not.toContain("tok123");
    });

    it("strips a token the platform leaks in the packet", async () => {
      const ws2 = join(tmp, "ws2");
      const orig = packet;
      const leakyServer = createServer((_req, res) => {
        res.setHeader("content-type", "application/json");
        const p = { ...orig(), markdown: "secret leaked-tok here", workspace: { remote: REMOTE, fork: "kit-app--r1", token: "leaked-tok" } };
        res.end(JSON.stringify({ packet: p }));
      }).listen(0);
      await new Promise((r) => leakyServer.once("listening", r));
      const url = `http://127.0.0.1:${(leakyServer.address() as any).port}`;
      const code = await main(["start", "r-1", "--dir", ws2, "--system", "system.keep-in-touch", "--evolution", "evolution.1"], { cwd: tmp, env: { ...process.env, ARTYFACT_URL: url, ARTYFACT_TOKEN: "" }, out: () => {}, err: () => {} });
      leakyServer.close();
      expect(code).toBe(0);
      for (const f of ["TASK_PACKET.md", "AGENTS.md", ".artyfact.json"]) expect(readFileSync(join(ws2, f), "utf8")).not.toContain("leaked-tok");
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
      expect(() => assertHttpsUrl("r", "ext::sh -c x")).toThrow();
      expect(() => assertHttpsUrl("r", "/tmp/repo")).toThrow();
      const r = await run(["start", "--", "--upload-pack=x"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("invalid");
    });
  });
});
