import { execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/main";
import { renderAgentsMd } from "../src/agents-md";

const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const tmp = mkdtempSync(join(tmpdir(), "artyfact-tasks-"));
const REMOTE = "https://artifacts.invalid/git/ns/peopling-app--r2.git";
const SECRET = "c3".repeat(32);
const TOKEN = "art_v1_deadbeef?expires=1893456000";
const ADMIN = "admin-token-xyz";
const AGENTS_MD = "# Platform block\n\nTask t1: do the thing.\n";

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id, evolutionId: "evolution.people", evolutionTitle: "People", title: id, status: "planned", wave: 1,
  dependsOn: [], blockedOn: [], nodes: ["screen.people"], footprint: { globs: ["src/ui/people/**"], paths: [], unmatched: [] }, ...over,
});
const TASKS = {
  tasks: [
    task("task.t1"),
    task("task.t2", { wave: 2, dependsOn: ["task.t1"], blockedOn: ["task.t1"], nodes: ["screen.people", "model.person"], footprint: { globs: ["src/ui/people/**", "src/api/**"] } }),
  ],
  conflicts: [{ kind: "file", tasks: ["task.t1", "task.t2"], subjects: ["src/ui/people/**"], message: "both edit the people screen" }],
  waves: { "evolution.people": [["task.t1"], ["task.t2"]] },
};

const claimBody = (fresh: boolean) => ({
  systemId: "system.peopling",
  realization: { id: "r-2", evolutionId: "evolution.people", workspace: { fork: "peopling-app--r2" } },
  packet: {
    systemId: "system.peopling", realizationId: "r-2", evolutionId: "evolution.people", hash: "h2",
    markdown: "# Task t1\nDo the thing", agentsMd: AGENTS_MD, acceptanceCriteria: [], permittedPaths: [], protectedPaths: [], commands: [],
    workspace: { remote: REMOTE, fork: "peopling-app--r2", secret: SECRET, token: TOKEN },
    task: { id: "task.t1", title: "t1" },
  },
  token: fresh ? { value: TOKEN, expiresAt: "2030-01-01T00:00:00Z", remote: REMOTE } : null,
  secret: fresh ? SECRET : null,
  remote: REMOTE,
  task: { id: "task.t1" },
  fresh,
});

const calls: { method: string; url: string; body: any; auth?: string }[] = [];
let respond: (url: string) => { status: number; body: unknown };
let server: Server;
let base = "";

beforeAll(async () => {
  const bare = join(tmp, "fork.git");
  sh(tmp, "init", "--bare", "-b", "main", bare);
  const seed = join(tmp, "seed");
  sh(tmp, "init", "-b", "main", seed);
  writeFileSync(join(seed, "a.txt"), "hi");
  sh(seed, "add", "-A");
  sh(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
  sh(seed, "push", bare, "main");
  process.env.ARTYFACT_ALLOW_REMOTE_HOST = "artifacts.invalid";
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${bare}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = REMOTE;
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : undefined, auth: req.headers.authorization });
      const r = respond(req.url!);
      res.statusCode = r.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(r.body));
    });
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  calls.length = 0;
  respond = () => ({ status: 404, body: { error: { code: "not-found", message: "no" } } });
});

function run(argv: string[], cwd = tmp, env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  return main(argv, { cwd, env: { ...process.env, ARTYFACT_URL: base, ARTYFACT_ADMIN_TOKEN: ADMIN, ...env }, out: (s) => out.push(s), err: (s) => err.push(s) })
    .then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }));
}

describe("artyfact tasks", () => {
  it("renders the table, conflicts and the first claim line without credentials", async () => {
    respond = () => ({ status: 200, body: TASKS });
    const r = await run(["tasks", "--system", "system.peopling"], tmp, { ARTYFACT_ADMIN_TOKEN: "" });
    expect(r.code).toBe(0);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/systems/system.peopling/tasks" });
    expect(calls[0]!.auth).toBeUndefined();
    const lines = r.out.split("\n");
    expect(lines[0]!.split(/\s{2,}/)).toEqual(["task", "evolution", "status", "wave", "depends-on", "nodes", "footprint"]);
    expect(lines[1]!.split(/\s{2,}/)).toEqual(["task.t1", "evolution.people", "planned", "1", "-", "screen.people", "src/ui/people/**"]);
    expect(lines[2]!.split(/\s{2,}/)).toEqual(["task.t2", "evolution.people", "planned", "2", "task.t1", "screen.people,model.person", "src/ui/people/**,src/api/**"]);
    expect(r.out).toContain("conflicts: task.t1 <-> task.t2 [file] src/ui/people/**: both edit the people screen");
    expect(lines.at(-1)).toBe('claim: npx artyfact claim task.t1 --system system.peopling --agent "claude:task.t1" --dir ./work/task.t1');
  });

  it("passes --evolution to the route and --json through", async () => {
    respond = () => ({ status: 200, body: TASKS });
    const r = await run(["tasks", "--system", "system.peopling", "--evolution", "evolution.people", "--json"]);
    expect(calls[0]!.url).toBe("/api/systems/system.peopling/tasks?evolution=evolution.people");
    expect(JSON.parse(r.out)).toEqual(TASKS);
  });

  it("needs a system", async () => {
    const r = await run(["tasks"], tmp, { ARTYFACT_SYSTEM: "" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("--system");
  });
});

describe("artyfact claim", () => {
  const dir = join(tmp, "work-t1");
  const claim = (extra: string[] = [], env: Record<string, string> = {}, d = dir) =>
    run(["claim", "task.t1", "--system", "system.peopling", "--agent", "claude:task.t1", "--dir", d, ...extra], tmp, env);

  it("posts the label and role with the admin bearer, clones, writes agentsMd verbatim and never prints credentials", async () => {
    respond = () => ({ status: 201, body: claimBody(true) });
    const r = await claim(["--role", "implementer"]);
    expect(r.code).toBe(0);
    expect(calls[0]).toMatchObject({
      method: "POST", url: "/api/systems/system.peopling/tasks/task.t1/claim", auth: `Bearer ${ADMIN}`,
      body: { agentLabel: "claude:task.t1", role: "implementer" },
    });
    expect(existsSync(join(dir, "a.txt"))).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(AGENTS_MD);
    expect(readFileSync(join(dir, "TASK_PACKET.md"), "utf8")).toContain("Do the thing");
    const cfg = JSON.parse(readFileSync(join(dir, ".artyfact.json"), "utf8"));
    expect(cfg).toMatchObject({ platform: base, systemId: "system.peopling", evolutionId: "evolution.people", realizationId: "r-2", forkRepo: "peopling-app--r2", remote: REMOTE, taskId: "task.t1", secret: SECRET });
    expect(statSync(join(dir, ".artyfact.json")).mode & 0o777).toBe(0o600);
    expect(sh(dir, "status", "--porcelain")).toBe("");
    for (const secret of [SECRET, TOKEN, ADMIN]) {
      expect(r.out + r.err).not.toContain(secret);
      for (const f of ["TASK_PACKET.md", "AGENTS.md"]) expect(readFileSync(join(dir, f), "utf8")).not.toContain(secret);
    }
    expect(statSync(join(dir, ".artyfact.json")).mode & 0o777).toBe(0o600);
  });

  it("submit after claim pushes with the stored token and leaks it nowhere else", async () => {
    expect(JSON.parse(readFileSync(join(dir, ".artyfact.json"), "utf8")).token).toBe(TOKEN);
    writeFileSync(join(dir, "done.txt"), "done");
    respond = () => ({ status: 200, body: { evaluations: [], conflicts: [] } });
    const r = await run(["submit"], dir, { ARTYFACT_SECRET: "", ARTYFACT_TOKEN: "" });
    expect(r.code).toBe(0);
    expect(calls.at(-1)!.url).toBe("/api/systems/system.peopling/evolutions/evolution.people/realizations/r-2/submit");
    expect(sh(join(tmp, "fork.git"), "log", "-1", "--format=%s", "main")).toBe("artyfact submit");
    expect(r.out + r.err).not.toContain(TOKEN);
    const files = execFileSync("grep", ["-rl", "--exclude-dir=.git", TOKEN, dir], { encoding: "utf8" }).trim().split("\n");
    expect(files).toEqual([join(dir, ".artyfact.json")]);
    expect(spawnSync("grep", ["-rl", TOKEN, join(dir, ".git")], { encoding: "utf8" }).stdout.trim()).toBe("");
  });

  it("status prints the task", async () => {
    respond = () => ({ status: 200, body: { realization: { status: "claimed" }, evaluations: [], conflicts: [] } });
    const r = await run(["status"], dir, { ARTYFACT_SECRET: "" });
    expect(r.out.split("\n")).toContain("task: task.t1");
  });

  it("a repeat claim by the same label (fresh: false) reuses the directory without cloning", async () => {
    writeFileSync(join(dir, "wip.txt"), "work in progress");
    respond = () => ({ status: 200, body: claimBody(false) });
    const r = await claim();
    expect(r.code).toBe(0);
    expect(r.out).toContain("Already claimed");
    expect(r.out).toContain("reused");
    expect(readFileSync(join(dir, "wip.txt"), "utf8")).toBe("work in progress");
    expect(JSON.parse(readFileSync(join(dir, ".artyfact.json"), "utf8"))).toMatchObject({ secret: SECRET, taskId: "task.t1", realizationId: "r-2" });
  });

  it("fresh: false with no local workspace explains that credentials are issued once", async () => {
    respond = () => ({ status: 200, body: claimBody(false) });
    const r = await claim([], { ARTYFACT_SECRET: "" }, join(tmp, "elsewhere"));
    expect(r.code).toBe(1);
    expect(r.err).toContain("credentials are issued once");
  });

  it("409 task-blocked exits 1 with the blockers", async () => {
    respond = () => ({ status: 409, body: { error: { code: "task-blocked", message: "blocked", details: { blockedOn: ["t1", "t2"] } } } });
    const r = await claim([], {}, join(tmp, "blocked"));
    expect(r.code).toBe(1);
    expect(r.err).toBe("artyfact: blocked by t1, t2 (not yet promoted)");
    expect(existsSync(join(tmp, "blocked"))).toBe(false);
  });

  it("409 task-taken names the holder", async () => {
    respond = () => ({ status: 409, body: { error: { code: "task-taken", message: "taken", details: { by: "codex:7" } } } });
    const r = await claim([], {}, join(tmp, "taken"));
    expect(r.code).toBe(1);
    expect(r.err).toBe("artyfact: task task.t1 is claimed by codex:7");
  });

  it("needs ARTYFACT_ADMIN_TOKEN and says so before calling the platform", async () => {
    const r = await claim([], { ARTYFACT_ADMIN_TOKEN: "" }, join(tmp, "noadmin"));
    expect(r.code).toBe(1);
    expect(r.err).toContain("ARTYFACT_ADMIN_TOKEN");
    expect(calls).toHaveLength(0);
  });

  it("needs --agent and refuses to send the admin token over plain http to a remote host", async () => {
    const noAgent = await run(["claim", "task.t1", "--system", "s"]);
    expect(noAgent.code).toBe(1);
    expect(noAgent.err).toContain("--agent");
    const remote = await run(["claim", "task.t1", "--system", "s", "--agent", "a", "--platform", "http://example.com"]);
    expect(remote.code).toBe(1);
    expect(remote.err).toContain("refusing to send ARTYFACT_ADMIN_TOKEN");
  });
});

describe("fallback AGENTS.md", () => {
  it("adds the task lines when the packet has a task and no agentsMd", () => {
    const md = renderAgentsMd({
      acceptanceCriteria: [], permittedPaths: [], protectedPaths: [], commands: [],
      task: { id: "task.t2", title: "second", wave: 2, dependsOn: ["task.t1"], nodes: ["model.person"], independence: "shares no files with t3" },
    }, "system.peopling");
    expect(md).toContain("- Task: task.t2 (second), wave 2");
    expect(md).toContain("- Depends on: task.t1");
    expect(md).toContain("- Independence: shares no files with t3");
  });
});
