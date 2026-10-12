import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agreeOnAccount, cloudCli, type Cloud, type Exec } from "../src/cloud.ts";
import { appArtifactIds, flatYaml, systemIdOf } from "../src/init.ts";
import { main } from "../src/main.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "artyfact-init-test-"));
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Artifacts stand-in: bare repos under `<tmp>/cloud/<ns>/<repo>.git`, file:// remotes, a fresh token per call. */
function localCloud(root = join(tmp, "cloud")) {
  const tokens: string[] = [];
  const path = (ns: string, repo: string) => join(root, ns, `${repo}.git`);
  const cloud: Cloud = {
    account: () => ACCOUNT,
    ensureNamespace(ns) {
      if (existsSync(join(root, ns))) return "exists";
      mkdirSync(join(root, ns), { recursive: true });
      return "created";
    },
    repoExists: (ns, repo) => existsSync(path(ns, repo)),
    createRepo: (ns, repo) => void sh(root, "init", "-q", "--bare", "-b", "main", path(ns, repo)),
    token(_ns, _repo, scope) {
      const t = `art_v1_${scope}${Math.random().toString(16).slice(2)}${tokens.length}?expires=9999999999`;
      tokens.push(t);
      return t;
    },
    fork: (ns, src, dst) => void sh(root, "clone", "-q", "--bare", path(ns, src), path(ns, dst)),
    remote: (ns, repo) => `file://${path(ns, repo)}`,
  };
  return { cloud, tokens, path, root };
}

/** Every git invocation passes through this shim, which records its argv. */
const shimDir = join(tmp, "shim");
const argvLog = join(tmp, "git-argv.log");
let savedPath: string | undefined;
beforeAll(() => {
  mkdirSync(shimDir, { recursive: true });
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(join(shimDir, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${argvLog}'\nexec '${realGit}' "$@"\n`);
  chmodSync(join(shimDir, "git"), 0o755);
  savedPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${process.env.PATH}`;
});
afterAll(() => {
  process.env.PATH = savedPath;
  rmSync(tmp, { recursive: true, force: true });
});

const skip = (p: string) => !/(^|\/)(node_modules|dist|\.wrangler)(\/|$)/.test(p);
function project(name: string, withApp = true) {
  const dir = join(tmp, name);
  cpSync(join(ROOT, "examples/keep-in-touch-system"), join(dir, "system"), { recursive: true, filter: skip });
  if (withApp) cpSync(join(ROOT, "examples/keep-in-touch-app"), join(dir, "app"), { recursive: true, filter: skip });
  return dir;
}

interface Req { url: string; auth: string | null; body: Record<string, unknown> }
function mockPlatform(respond: (body: Record<string, unknown>) => [number, unknown] = () => [201, { head: "sc-1-abc", warnings: [] }]) {
  const requests: Req[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ url, auth: new Headers(init.headers).get("authorization"), body });
    const [status, json] = respond(body);
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { requests, fetch: fetchImpl };
}

async function run(args: string[], opts: { cloud: Cloud; fetch?: typeof fetch; env?: Record<string, string>; root?: string }) {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, {
    out: (s) => out.push(s), err: (s) => err.push(s), cwd: tmp,
    env: { ARTYFACT_URL: "http://platform.test", ...opts.env }, cloud: opts.cloud, fetch: opts.fetch, root: opts.root ?? ROOT, pollMs: 0,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const headOf = (bare: string) => sh(tmp, "--git-dir", bare, "rev-parse", "refs/heads/main");
const filesAt = (bare: string, ref = "main") => sh(tmp, "--git-dir", bare, "ls-tree", "-r", "--name-only", ref).split("\n");
const count = (bare: string) => Number(sh(tmp, "--git-dir", bare, "rev-list", "--count", "main"));

function noTokenLeaks(tokens: string[], ...texts: string[]) {
  const argv = existsSync(argvLog) ? readFileSync(argvLog, "utf8") : "";
  expect(tokens.length).toBeGreaterThan(0);
  for (const t of tokens) {
    const bare = t.split("?")[0]!;
    expect(argv).not.toContain(bare);
    for (const s of texts) expect(s).not.toContain(bare);
  }
}

describe("project reading", () => {
  it("reads the system id, app artifacts and flat scaffold yaml", () => {
    expect(systemIdOf("# c\nid: system.keep-in-touch\nname: x\n")).toBe("system.keep-in-touch");
    expect(() => systemIdOf("name: x")).toThrow(/id/);
    expect(appArtifactIds(join(ROOT, "examples/keep-in-touch-system"))).toEqual(["artifact.webapp"]);
    expect(flatYaml("repo: platform\npath: 'a/b' # c\ncommands:\n  dev: x\n")).toEqual({ repo: "platform", path: "a/b" });
  });
});

describe("account confirmation", () => {
  it("requires wrangler and cf to agree", () => {
    expect(agreeOnAccount([ACCOUNT], [ACCOUNT])).toBe(ACCOUNT);
    expect(() => agreeOnAccount([ACCOUNT], ["f".repeat(32)])).toThrow(/different accounts/);
    expect(() => agreeOnAccount([], [ACCOUNT])).toThrow(/wrangler login/);
    expect(() => agreeOnAccount([ACCOUNT, "f".repeat(32)], [ACCOUNT, "f".repeat(32)])).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(agreeOnAccount([ACCOUNT, "f".repeat(32)], [ACCOUNT], "0123456789abcdef0123456789abcdef")).toBe(ACCOUNT);
  });

  it("the CLI-backed cloud parses whoami and issue-token JSON and never passes a token on argv", () => {
    const argvs: string[][] = [];
    const who = JSON.stringify({ accounts: [{ id: ACCOUNT }] });
    const exec: Exec = (cmd, args, env) => {
      argvs.push([cmd, ...args]);
      expect(env?.CLOUDFLARE_ACCOUNT_ID ?? ACCOUNT).toBe(ACCOUNT);
      if (args.includes("whoami")) return { status: 0, stdout: `banner\n${who}`, stderr: "" };
      if (args.includes("issue-token")) return { status: 0, stdout: JSON.stringify({ id: "t1", plaintext: "art_v1_secret?expires=1" }), stderr: "" };
      if (args.includes("get")) return { status: 1, stdout: "", stderr: "not found" };
      return { status: 0, stdout: "{}", stderr: "" };
    };
    const c = cloudCli(exec, {});
    expect(c.account()).toBe(ACCOUNT);
    expect(c.ensureNamespace("artyfact")).toBe("created");
    expect(c.token("artyfact", "x.app", "write")).toBe("art_v1_secret?expires=1");
    c.fork("artyfact", "other.app", "x.app");
    expect(c.remote("artyfact", "x.app")).toBe(`https://${ACCOUNT}.artifacts.cloudflare.net/git/artyfact/x.app.git`);
    expect(argvs.flat().join(" ")).not.toContain("art_v1_secret");
    expect(argvs).toContainEqual(["cf", "artifacts", "namespaces", "repos", "fork", "other.app", "--namespace", "artyfact", "--body", JSON.stringify({ name: "x.app", default_branch_only: true })]);
    const bad = cloudCli((cmd, args) => (args.includes("whoami") ? { status: 0, stdout: JSON.stringify({ accounts: [{ id: cmd === "cf" ? "f".repeat(32) : ACCOUNT }] }), stderr: "" } : { status: 0, stdout: "", stderr: "" }), {});
    expect(() => bad.account()).toThrow(/different accounts/);
  });
});

describe("artyfact init", { timeout: 60_000 }, () => {
  const lc = localCloud();
  const dir = project("proj");

  it("derives names, creates and pushes the repos and platform, imports, and never leaks the token", async () => {
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "adm-tok" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("system.keep-in-touch -> keep-in-touch.genome, keep-in-touch.app (namespace artyfact)");
    expect(r.out).toContain("account 01234567… (wrangler and cf agree)");
    expect(r.out).not.toContain(ACCOUNT);
    expect(r.out).toMatch(/keep-in-touch\.genome: created at [0-9a-f]{12}/);
    expect(r.out).toContain("System: http://platform.test/s/system.keep-in-touch/r/head/overview");
    expect(p.requests).toEqual([{
      url: "http://platform.test/api/systems/import", auth: "Bearer adm-tok",
      body: { systemId: "system.keep-in-touch", genomeRepo: "keep-in-touch.genome", appRepo: "keep-in-touch.app", force: false },
    }]);
    expect(filesAt(lc.path("artyfact", "keep-in-touch.genome"))).toContain("system.yaml");
    expect(filesAt(lc.path("artyfact", "keep-in-touch.app"))).toContain("wrangler.jsonc");
    expect(filesAt(lc.path("artyfact", "keep-in-touch.app")).some((f) => f.includes("node_modules"))).toBe(false);
    const platform = filesAt(lc.path("artyfact", "platform"));
    expect(platform).toEqual(expect.arrayContaining([
      "README.md", "manifest.json", "templates/rule-packs/metamodel@1/pack.dl", "templates/system/social-networking.cloudflare@1/template.yaml",
      "templates/thing/cloudflare-worker-webapp@1/scaffold.yaml", "templates/thing/cloudflare-worker-webapp@1/scaffold/package.json",
    ]));
    noTokenLeaks(lc.tokens, r.out, r.err, readFileSync(join(dir, ".artyfact", "init.json"), "utf8"));
  });

  it("is idempotent: a re-run pushes nothing and re-imports with force false", async () => {
    const heads = ["keep-in-touch.genome", "keep-in-touch.app", "platform"].map((n) => headOf(lc.path("artyfact", n)));
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "adm-tok" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/keep-in-touch\.genome: unchanged/);
    expect(r.out).toMatch(/platform: unchanged/);
    expect(["keep-in-touch.genome", "keep-in-touch.app", "platform"].map((n) => headOf(lc.path("artyfact", n)))).toEqual(heads);
    expect(p.requests[0]!.body.force).toBe(false);
  });

  it("fast-forwards its own line, and refuses to build over history it did not push unless --adopt", async () => {
    const genome = lc.path("artyfact", "keep-in-touch.genome");
    const before = headOf(genome);
    writeFileSync(join(dir, "system", "README.md"), "changed\n");
    const p = mockPlatform();
    const ok = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).toMatch(/keep-in-touch\.genome: pushed/);
    expect(sh(tmp, "--git-dir", genome, "rev-parse", "main^")).toBe(before);

    // Someone else pushes to the Genome repo.
    const other = join(tmp, "other-clone");
    sh(tmp, "clone", "-q", genome, other);
    writeFileSync(join(other, "theirs.txt"), "theirs\n");
    sh(other, "add", "-A");
    sh(other, "-c", "user.name=o", "-c", "user.email=o@o", "commit", "-qm", "theirs");
    sh(other, "push", "-q", "origin", "HEAD:main");
    const foreign = headOf(genome);
    const refused = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`keep-in-touch.genome has commits this checkout did not push (head ${foreign.slice(0, 7)})`);
    expect(refused.err).toContain("--adopt");
    expect(headOf(genome)).toBe(foreign);
    const adopted = await run(["init", "--dir", dir, "--adopt"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(adopted.code, adopted.err).toBe(0);
    expect(sh(tmp, "--git-dir", genome, "rev-parse", "main^")).toBe(foreign);
    noTokenLeaks(lc.tokens, ok.out, refused.err, adopted.out);
  });

  it("tells the user to pass --force on 409 already-imported", async () => {
    const p = mockPlatform(() => [409, { error: { code: "already-imported", message: "system system.keep-in-touch is already imported from x" } }]);
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Re-run with --force");
    const forced = mockPlatform((b) => (b.force ? [201, { head: "sc-2-x" }] : [409, {}]));
    expect((await run(["init", "--dir", dir, "--force"], { cloud: lc.cloud, fetch: forced.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } })).code).toBe(0);
    expect(forced.requests[0]!.body.force).toBe(true);
  });

  it("without ARTYFACT_ADMIN_TOKEN prints the curl line with a placeholder and exits 0", async () => {
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch });
    expect(r.code, r.err).toBe(0);
    expect(p.requests).toEqual([]);
    expect(r.out).toContain("ARTYFACT_ADMIN_TOKEN is not set");
    expect(r.out).toContain(`curl -sS -XPOST http://platform.test/api/systems/import -H "authorization: Bearer $ARTYFACT_ADMIN_TOKEN"`);
    expect(r.out).toContain(`"genomeRepo":"keep-in-touch.genome"`);
  });

  it("works on the examples layout with --genome and --app", async () => {
    const cloud = localCloud(join(tmp, "cloud-examples"));
    const p = mockPlatform();
    const r = await run(["init", "--genome", join(ROOT, "examples/keep-in-touch-system"), "--app", join(ROOT, "examples/keep-in-touch-app"), "--dir", join(tmp, "ex-state")],
      { cloud: cloud.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    // Inside the checkout the repo's own ignore rules apply: no build output in the Genome.
    expect(filesAt(cloud.path("artyfact", "keep-in-touch.genome")).some((f) => f.startsWith("dist/"))).toBe(false);
  });
});

describe("artyfact platform-sync", { timeout: 60_000 }, () => {
  it("pushes once and is a no-op when nothing changed", async () => {
    const lc = localCloud(join(tmp, "cloud-sync"));
    const a = await run(["platform-sync", "--namespace", "artyfact-test"], { cloud: lc.cloud });
    expect(a.code, a.err).toBe(0);
    expect(a.out).toMatch(/platform: created at/);
    const b = await run(["platform-sync", "--namespace", "artyfact-test"], { cloud: lc.cloud });
    expect(b.out).toMatch(/platform: unchanged/);
    expect(count(lc.path("artyfact-test", "platform"))).toBe(1);
    const manifest = JSON.parse(sh(tmp, "--git-dir", lc.path("artyfact-test", "platform"), "show", "main:manifest.json"));
    expect(manifest).toEqual({ version: 1, bundleHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});

describe("artyfact init --from-template", { timeout: 60_000 }, () => {
  it("seeds <slug>.app from the platform scaffold subtree and records scaffoldFrom", async () => {
    const lc = localCloud(join(tmp, "cloud-tpl"));
    const dir = project("tpl-proj", false);
    writeFileSync(join(dir, "system", "system.yaml"), readFileSync(join(dir, "system", "system.yaml"), "utf8").replace("id: system.keep-in-touch", "id: system.Fresh_App"));
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir, "--from-template", "template.thing.cloudflare-worker-webapp@1"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    const platformHead = headOf(lc.path("artyfact", "platform"));
    const path = "templates/thing/cloudflare-worker-webapp@1/scaffold";
    expect(p.requests[0]!.body).toEqual({
      systemId: "system.Fresh_App", genomeRepo: "fresh_app.genome", appRepo: "fresh_app.app", force: false,
      scaffoldFrom: { repo: "platform", commit: platformHead, path },
    });
    expect(filesAt(lc.path("artyfact", "fresh_app.app"))).toEqual(filesAt(lc.path("artyfact", "platform")).filter((f) => f.startsWith(`${path}/`)).map((f) => f.slice(path.length + 1)));
    const again = await run(["init", "--dir", dir, "--from-template", "template.thing.cloudflare-worker-webapp@1"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(again.out).toContain("fresh_app.app: already has history");
    expect(p.requests[1]!.body).not.toHaveProperty("scaffoldFrom");
    noTokenLeaks(lc.tokens, r.out, r.err, again.out);
  });

  it("forks a whole-repo scaffold such as another System's <slug>.app", async () => {
    const lc = localCloud(join(tmp, "cloud-fork"));
    // A checkout whose only Thing template scaffolds from another System's app repo.
    const root = join(tmp, "fork-root");
    mkdirSync(join(root, "packages/templates/thing/from-other@1"), { recursive: true });
    writeFileSync(join(root, "packages/templates/thing/from-other@1/template.yaml"), "id: template.thing.from-other\nversion: '1'\n");
    writeFileSync(join(root, "packages/templates/thing/from-other@1/scaffold.yaml"), "repo: other.app\n");
    lc.cloud.ensureNamespace("artyfact");
    lc.cloud.createRepo("artyfact", "other.app");
    const seed = join(tmp, "other-seed");
    sh(tmp, "init", "-q", "-b", "main", seed);
    writeFileSync(join(seed, "index.ts"), "export {}\n");
    sh(seed, "add", "-A");
    sh(seed, "-c", "user.name=o", "-c", "user.email=o@o", "commit", "-qm", "other");
    sh(seed, "push", "-q", lc.path("artyfact", "other.app"), "HEAD:main");
    const otherHead = headOf(lc.path("artyfact", "other.app"));
    const dir = project("fork-proj", false);
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir, "--from-template", "template.thing.from-other@1"], { cloud: lc.cloud, fetch: p.fetch, root, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(`keep-in-touch.app: forked from other.app@${otherHead.slice(0, 12)}`);
    expect(headOf(lc.path("artyfact", "keep-in-touch.app"))).toBe(otherHead);
    expect(p.requests[0]!.body.scaffoldFrom).toEqual({ repo: "other.app", commit: otherHead });
  });

  it("refuses ambiguous input", async () => {
    const lc = localCloud(join(tmp, "cloud-bad"));
    const dir = project("bad-proj");
    const both = await run(["init", "--dir", dir, "--from-template", "template.thing.cloudflare-worker-webapp@1"], { cloud: lc.cloud });
    expect([both.code, both.err]).toEqual([1, expect.stringContaining("exists")]);
    const none = await run(["init", "--dir", join(tmp, "nowhere")], { cloud: lc.cloud });
    expect([none.code, none.err]).toEqual([1, expect.stringContaining("no system.yaml")]);
  });
});
