import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/main";

const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const tmp = mkdtempSync(join(tmpdir(), "artyfact-cli-"));
const bare = join(tmp, "fork.git");
const calls: { method: string; url: string; body: any }[] = [];
let server: Server;
let base = "";

const packet = () => ({
  systemId: "system.keep-in-touch", realizationId: "r-1", evolutionId: "evolution.1", hash: "abc",
  markdown: "# Task\nDo it", acceptanceCriteria: [{ id: "crit.a" }, { id: "crit.b" }],
  permittedPaths: ["src/ui/people/**"], protectedPaths: ["system/**"], commands: ["npm install", "npm test"],
  workspace: { remote: bare, fork: "kit-app--r1" },
});

beforeAll(async () => {
  sh(tmp, "init", "--bare", "-b", "main", bare);
  const seed = join(tmp, "seed");
  sh(tmp, "init", "-b", "main", seed);
  writeFileSync(join(seed, "a.txt"), "hi");
  sh(seed, "add", "-A");
  sh(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
  sh(seed, "push", bare, "main");
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
  return main(argv, { cwd, env: { ARTYFACT_URL: base }, out: (s) => out.push(s), err: (s) => err.push(s) })
    .then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }));
}

describe("artyfact cli", () => {
  const ws = join(tmp, "ws");

  it("start writes packet, AGENTS.md, config and excludes config", async () => {
    const r = await run(["start", "r-1", "--dir", ws, "--token", "tok123"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(ws, "TASK_PACKET.md"), "utf8")).toContain("Do it");
    const agents = readFileSync(join(ws, "AGENTS.md"), "utf8");
    expect(agents).toContain("src/ui/people/**");
    expect(agents).toContain("crit.a, crit.b");
    expect(agents).toContain("npm install; npm test");
    const cfg = JSON.parse(readFileSync(join(ws, ".artyfact.json"), "utf8"));
    expect(cfg).toMatchObject({ platform: base, systemId: "system.keep-in-touch", realizationId: "r-1", forkRepo: "kit-app--r1", remote: bare, packetHash: "abc" });
    expect(readFileSync(join(ws, ".git/info/exclude"), "utf8")).toContain(".artyfact.json");
    expect(existsSync(join(ws, "a.txt"))).toBe(true);
  });

  it("checkpoint commits and posts the commit", async () => {
    writeFileSync(join(ws, "b.txt"), "x");
    const r = await run(["checkpoint", "added b"], ws);
    expect(r.code).toBe(0);
    const c = calls.find((x) => x.url.endsWith("/checkpoints"))!;
    expect(c.url).toBe("/api/systems/system.keep-in-touch/realizations/r-1/checkpoints");
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

  it("errors are non-zero without a stack", async () => {
    expect((await run(["status"], tmp)).code).toBe(1);
    expect((await run(["bogus"])).code).toBe(1);
    expect((await run(["start", "r-9", "--dir", join(tmp, "x")])).err).toContain("token");
    expect((await run(["compose", "r-1", "r-2"])).out).toContain("not implemented");
  });
});
