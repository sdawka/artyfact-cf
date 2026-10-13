import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agreeOnAccount, cloudCli, type Cloud, type Exec } from "../src/cloud.ts";
import { appArtifactIds, flatYaml, systemIdOf } from "../src/init.ts";
import { WORKSPACE_IGNORES } from "../src/ignore.ts";
import { main } from "../src/main.ts";

// A hook or wrapper can export GIT_DIR, GIT_INDEX_FILE and friends; every git call here must target its own temp repos, never the caller's.
for (const k of Object.keys(process.env)) {
  if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|QUARANTINE_PATH|NAMESPACE|CEILING_DIRECTORIES|CONFIG\w*)$/.test(k)) delete process.env[k];
}

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
  cpSync(join(ROOT, "examples/peopling-system"), join(dir, "genome"), { recursive: true, filter: skip });
  if (withApp) cpSync(join(ROOT, "examples/peopling-app"), join(dir, "app"), { recursive: true, filter: skip });
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
    env: { ARTYFACT_URL: "https://platform.test", ...opts.env }, cloud: opts.cloud, fetch: opts.fetch, root: opts.root ?? ROOT, pollMs: 0,
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
    expect(systemIdOf("# c\nid: system.peopling\nname: x\n")).toBe("system.peopling");
    expect(() => systemIdOf("name: x")).toThrow(/id/);
    expect(appArtifactIds(join(ROOT, "examples/peopling-system"))).toEqual(["artifact.webapp"]);
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
      if (args.includes("get")) return { status: 1, stdout: "", stderr: "Access denied [code: 10004]" };
      return { status: 0, stdout: "{}", stderr: "" };
    };
    const c = cloudCli(exec, {});
    expect(c.account()).toBe(ACCOUNT);
    expect(c.ensureNamespace("artyfact")).toBe("created");
    expect(argvs.some((a) => a.includes("list"))).toBe(false);
    expect(c.token("artyfact", "x.app", "write")).toBe("art_v1_secret?expires=1");
    c.fork("artyfact", "other.app", "x.app");
    expect(c.remote("artyfact", "x.app")).toBe(`https://${ACCOUNT}.artifacts.cloudflare.net/git/artyfact/x.app.git`);
    expect(argvs.flat().join(" ")).not.toContain("art_v1_secret");
    expect(argvs).toContainEqual(["cf", "artifacts", "namespaces", "repos", "fork", "other.app", "--namespace", "artyfact", "--body", JSON.stringify({ name: "x.app", default_branch_only: true })]);
    const bad = cloudCli((cmd, args) => (args.includes("whoami") ? { status: 0, stdout: JSON.stringify({ accounts: [{ id: cmd === "cf" ? "f".repeat(32) : ACCOUNT }] }), stderr: "" } : { status: 0, stdout: "", stderr: "" }), {});
    expect(() => bad.account()).toThrow(/different accounts/);
  });

  it("decides namespace existence by get, else by create confirmed with list; an empty repo list is never proof", () => {
    const who = JSON.stringify({ accounts: [{ id: ACCOUNT }] });
    const listed = JSON.stringify([{ namespace: "artyfact", jurisdiction: "unrestricted", repo_count: 16 }]);
    // The real cf answer for an existing namespace (captured live).
    const exists409 = `\n┌ APIError\n│ [10201] Namespace already exists\n│ 409 Conflict · HTTP /accounts/${ACCOUNT}/artifacts/namespaces\n└\n`;
    const cloudWith = (create: { status: number; stderr: string }, list = listed) => {
      const argvs: string[][] = [];
      const c = cloudCli((cmd, args) => {
        argvs.push([cmd, ...args]);
        if (args.includes("whoami")) return { status: 0, stdout: who, stderr: "" };
        if (args.includes("get")) return { status: 1, stdout: "", stderr: "Access denied [code: 10004]" };
        if (cmd === "cf" && args[2] === "list") return { status: 0, stdout: list, stderr: "" };
        // A missing namespace's repos list as an empty array: never consulted.
        if (args.includes("list")) return { status: 0, stdout: "[]", stderr: "" };
        if (args.includes("create")) return { ...create, stdout: "" };
        return { status: 0, stdout: "{}", stderr: "" };
      }, {});
      c.account();
      return { c, argvs };
    };
    const fresh = cloudWith({ status: 0, stderr: "" }, "[]");
    expect(fresh.c.ensureNamespace("brand-new")).toBe("created");
    expect(fresh.argvs).toContainEqual(["cf", "artifacts", "namespaces", "create", "--body", JSON.stringify({ namespace: "brand-new" })]);
    expect(fresh.argvs.some((a) => a[0] === "npx" && a.includes("list"))).toBe(false);

    const existing = cloudWith({ status: 1, stderr: exists409 });
    expect(existing.c.ensureNamespace("artyfact")).toBe("exists");
    expect(existing.argvs).toContainEqual(["cf", "artifacts", "namespaces", "list"]);
    // 10201 but not listed: refuse rather than guess.
    expect(() => cloudWith({ status: 1, stderr: exists409 }, "[]").c.ensureNamespace("artyfact")).toThrow(/says it exists, but .* list does not show it/);

    const denied = cloudWith({ status: 1, stderr: `401 Unauthorized · HTTP /accounts/${ACCOUNT}/artifacts/namespaces` }, "[]");
    expect(() => denied.c.ensureNamespace("artyfact")).toThrow(/cf artifacts namespaces create artyfact failed: 401 Unauthorized · HTTP \/accounts\/01234567…\/artifacts/);
    try { denied.c.ensureNamespace("artyfact"); } catch (e) { expect((e as Error).message).not.toContain(ACCOUNT); }
    // A failed create of a namespace that is listed (e.g. a transient error) still counts as exists.
    expect(cloudWith({ status: 1, stderr: "502 Bad Gateway" }).c.ensureNamespace("artyfact")).toBe("exists");
  });
});

describe("artyfact init", { timeout: 60_000 }, () => {
  const lc = localCloud();
  const dir = project("proj");

  it("derives names, creates and pushes the repos and platform, imports, and never leaks the token", async () => {
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "adm-tok" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("system.peopling -> peopling.genome, peopling.app (namespace artyfact)");
    expect(r.out).toContain("account 01234567… (wrangler and cf agree)");
    expect(r.out).not.toContain(ACCOUNT);
    expect(r.out).toMatch(/peopling\.genome: created at [0-9a-f]{12}/);
    expect(r.out).toContain("System: https://platform.test/s/system.peopling/r/head/overview");
    expect(p.requests).toEqual([{
      url: "https://platform.test/api/systems/import", auth: "Bearer adm-tok",
      body: { systemId: "system.peopling", genomeRepo: "peopling.genome", appRepo: "peopling.app", force: false },
    }]);
    expect(filesAt(lc.path("artyfact", "peopling.genome"))).toContain("node.yaml");
    expect(filesAt(lc.path("artyfact", "peopling.app"))).toContain("wrangler.jsonc");
    expect(filesAt(lc.path("artyfact", "peopling.app")).some((f) => f.includes("node_modules"))).toBe(false);
    const platform = filesAt(lc.path("artyfact", "platform"));
    expect(platform).toEqual(expect.arrayContaining([
      "README.md", "manifest.json", "templates/rule-packs/metamodel@1/pack.dl", "templates/system/social-networking.cloudflare@1/template.yaml",
      "templates/thing/cloudflare-worker-webapp@1/scaffold.yaml", "templates/thing/cloudflare-worker-webapp@1/scaffold/package.json",
    ]));
    noTokenLeaks(lc.tokens, r.out, r.err, readFileSync(join(dir, ".artyfact", "init.json"), "utf8"));
  });

  it("is idempotent: a re-run pushes nothing and re-imports with force false", async () => {
    const heads = ["peopling.genome", "peopling.app", "platform"].map((n) => headOf(lc.path("artyfact", n)));
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "adm-tok" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/peopling\.genome: unchanged/);
    expect(r.out).toMatch(/platform: exists at [0-9a-f]{12}, left alone \(update it with 'npx artyfact platform-sync --namespace artyfact'\)/);
    expect(["peopling.genome", "peopling.app", "platform"].map((n) => headOf(lc.path("artyfact", n)))).toEqual(heads);
    expect(p.requests[0]!.body.force).toBe(false);
  });

  it("fast-forwards its own line, and refuses to build over history it did not push unless --adopt", async () => {
    const genome = lc.path("artyfact", "peopling.genome");
    const before = headOf(genome);
    writeFileSync(join(dir, "genome", "README.md"), "changed\n");
    const p = mockPlatform();
    const ok = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).toMatch(/peopling\.genome: pushed/);
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
    expect(refused.err).toContain(`peopling.genome has commits this checkout did not push (head ${foreign.slice(0, 7)})`);
    expect(refused.err).toContain("--adopt");
    expect(headOf(genome)).toBe(foreign);
    const adopted = await run(["init", "--dir", dir, "--adopt"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(adopted.code, adopted.err).toBe(0);
    expect(sh(tmp, "--git-dir", genome, "rev-parse", "main^")).toBe(foreign);
    noTokenLeaks(lc.tokens, ok.out, refused.err, adopted.out);
  });

  it("prints the review URL when the import is pending, and --no-review sends review: false", async () => {
    const pendingImport = mockPlatform(() => [201, { head: "sc-1-abc", warnings: [], system: { importReview: { status: "pending" } } }]);
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: pendingImport.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("review: pending — open https://platform.test/s/system.peopling/r/head/review?panel=import");
    expect(pendingImport.requests[0]!.body.review).toBeUndefined();

    const p = mockPlatform();
    const skipped = await run(["init", "--dir", dir, "--no-review"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(skipped.code, skipped.err).toBe(0);
    expect(p.requests[0]!.body.review).toBe(false);
    expect(skipped.out).not.toContain("review: pending");
  });

  it("tells the user to pass --force on 409 already-imported", async () => {
    const p = mockPlatform(() => [409, { error: { code: "already-imported", message: "system system.peopling is already imported from x" } }]);
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
    expect(r.out).toContain(`curl -sS -XPOST https://platform.test/api/systems/import -H "authorization: Bearer $ARTYFACT_ADMIN_TOKEN"`);
    expect(r.out).toContain(`"genomeRepo":"peopling.genome"`);
  });

  it("without ARTYFACT_ADMIN_TOKEN and no identified platform, still pushes and prints the curl line for the default URL", async () => {
    const lc = localCloud(join(tmp, "cloud-no-platform"));
    const dir2 = project("no-platform");
    const seenUrls: string[] = [];
    const nothing = (async (input: string | URL | Request, init?: RequestInit) => {
      seenUrls.push(String(input));
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as typeof fetch;
    const r = await run(["init", "--dir", dir2], { cloud: lc.cloud, fetch: nothing, env: { ARTYFACT_URL: "" } });
    expect(r.code, r.err).toBe(0);
    expect(existsSync(lc.path("artyfact", "peopling.genome"))).toBe(true);
    expect(r.out).toContain(`curl -sS -XPOST http://localhost:1337/api/systems/import -H "authorization: Bearer $ARTYFACT_ADMIN_TOKEN"`);
    expect(r.err).toContain("no artyfact platform found on localhost:1337–1346; the import line uses http://localhost:1337");
    expect(seenUrls.every((u) => u.endsWith("/api/health"))).toBe(true);
  });

  it("ships the app scaffold's .gitignore into the app repo (dependencies, Wrangler state, secrets)", async () => {
    const files = filesAt(lc.path("artyfact", "peopling.app"));
    expect(files).toContain(".gitignore");
    expect(files).toContain(".dev.vars.example");
    expect(filesAt(lc.path("artyfact", "platform"))).toContain("templates/thing/cloudflare-worker-webapp@1/scaffold/.gitignore");
    // The scaffold ignores exactly what start excludes in a clone: dependencies, Wrangler state, build output, secrets.
    const lines = readFileSync(join(ROOT, "examples/peopling-app/.gitignore"), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
    expect(lines).toEqual([...WORKSPACE_IGNORES]);
  });

  it("works on the examples layout with --genome and --app", async () => {
    const cloud = localCloud(join(tmp, "cloud-examples"));
    const p = mockPlatform();
    const r = await run(["init", "--genome", join(ROOT, "examples/peopling-system"), "--app", join(ROOT, "examples/peopling-app"), "--dir", join(tmp, "ex-state")],
      { cloud: cloud.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    // Inside the checkout the repo's own ignore rules apply: no build output in the Genome.
    expect(filesAt(cloud.path("artyfact", "peopling.genome")).some((f) => f.startsWith("dist/"))).toBe(false);
    expect(filesAt(cloud.path("artyfact", "peopling.genome"))).toContain("node.yaml");
  });

  it("imports the repo's own Genome from <dir>/genome (a Genome-only System)", async () => {
    const cloud = localCloud(join(tmp, "cloud-self"));
    const dir = join(tmp, "self");
    cpSync(join(ROOT, "genome"), join(dir, "genome"), { recursive: true });
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: cloud.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("system.artyfact -> artyfact.genome (namespace artyfact)");
    expect(p.requests[0]!.body).toEqual({ systemId: "system.artyfact", genomeRepo: "artyfact.genome", force: false });
    expect(filesAt(cloud.path("artyfact", "artyfact.genome"))).toEqual(expect.arrayContaining(["node.yaml", "thing.cli/node.yaml"]));
    expect(filesAt(cloud.path("artyfact", "platform"))).toContain("templates/thing/cloudflare-worker-webapp@1/template.yaml");
    expect(existsSync(cloud.path("artyfact", "artyfact.app"))).toBe(false);
  });

  it("imports a Genome-only System without creating or naming an app repo", async () => {
    const cloud = localCloud(join(tmp, "cloud-genome-only"));
    const dir = project("genome-only", false);
    const file = join(dir, "genome/thing.webapp/node.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^  artifacts:\n(?:    [^\n]*\n)*/m, ""));
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: cloud.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("system.peopling -> peopling.genome (namespace artyfact)");
    expect(p.requests[0]!.body).toEqual({ systemId: "system.peopling", genomeRepo: "peopling.genome", force: false });
    expect(existsSync(cloud.path("artyfact", "peopling.app"))).toBe(false);
  });
});

describe("artyfact init --genome-only (migrating a deployed System's Genome)", { timeout: 60_000 }, () => {
  const lc = localCloud(join(tmp, "cloud-migrate"));
  const dir = project("proj-migrate");

  it("commits the Genome on top of the repo's head and re-imports, never touching the app repo", async () => {
    const first = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: mockPlatform().fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(first.code, first.err).toBe(0);
    const genome = lc.path("artyfact", "peopling.genome"), app = lc.path("artyfact", "peopling.app");
    // Prod moved on: a promotion on the Genome repo this checkout did not push.
    const other = join(tmp, "migrate-other");
    sh(tmp, "clone", "-q", genome, other);
    writeFileSync(join(other, "theirs.txt"), "theirs\n");
    sh(other, "add", "-A");
    sh(other, "-c", "user.name=o", "-c", "user.email=o@o", "commit", "-qm", "theirs");
    sh(other, "push", "-q", "origin", "HEAD:main");
    const [genomeBefore, appBefore] = [headOf(genome), headOf(app)];
    // The converted tree, and a local app that differs from the app repo: neither may reach the app repo.
    writeFileSync(join(dir, "genome", "README.md"), "converted\n");
    writeFileSync(join(dir, "app", "LOCAL-ONLY.md"), "never pushed\n");

    const p = mockPlatform((b) => (b.force ? [201, { head: "sc-9-x" }] : [409, {}]));
    const r = await run(["init", "--dir", dir, "--genome-only", "--adopt", "--force"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("peopling.app: left alone (--genome-only)");
    expect(headOf(app)).toBe(appBefore);
    expect(filesAt(app)).not.toContain("LOCAL-ONLY.md");
    expect(sh(tmp, "--git-dir", genome, "rev-parse", "main^")).toBe(genomeBefore);
    expect(sh(tmp, "--git-dir", genome, "show", "main:README.md")).toBe("converted");
    expect(p.requests).toEqual([expect.objectContaining({ body: { systemId: "system.peopling", genomeRepo: "peopling.genome", appRepo: "peopling.app", force: true } })]);
    noTokenLeaks(lc.tokens, r.out, r.err);
  });

  it("refuses --app or --from-template, and a missing app repo", async () => {
    const withApp = await run(["init", "--dir", dir, "--genome-only", "--app", join(dir, "app")], { cloud: lc.cloud });
    expect(withApp.code).toBe(1);
    expect(withApp.err).toContain("--genome-only never pushes an app");
    const fresh = localCloud(join(tmp, "cloud-migrate-empty"));
    const missing = await run(["init", "--dir", dir, "--genome-only"], { cloud: fresh.cloud, fetch: mockPlatform().fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("--genome-only needs the existing peopling.app");
  });
});

describe("init and an existing platform repo", { timeout: 60_000 }, () => {
  it("leaves a non-empty platform alone (an older checkout never overwrites it); platform-sync is the update path", async () => {
    const lc = localCloud(join(tmp, "cloud-plat-old"));
    expect((await run(["platform-sync"], { cloud: lc.cloud })).code).toBe(0);
    const head = headOf(lc.path("artyfact", "platform"));
    // A checkout whose templates differ (older or newer) runs init against the same namespace.
    const root = join(tmp, "old-root");
    mkdirSync(join(root, "packages/templates/thing/old@1"), { recursive: true });
    writeFileSync(join(root, "packages/templates/thing/old@1/template.yaml"), "id: template.thing.old\nversion: '1'\n");
    const r = await run(["init", "--dir", project("plat-old")], { cloud: lc.cloud, root, fetch: mockPlatform().fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(`platform: exists at ${head.slice(0, 12)}, left alone`);
    expect(headOf(lc.path("artyfact", "platform"))).toBe(head);
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
    writeFileSync(join(dir, "genome", "node.yaml"), readFileSync(join(dir, "genome", "node.yaml"), "utf8").replace("id: system.peopling", "id: system.fresh_app"));
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir, "--from-template", "template.thing.cloudflare-worker-webapp@1"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    const platformHead = headOf(lc.path("artyfact", "platform"));
    const path = "templates/thing/cloudflare-worker-webapp@1/scaffold";
    expect(p.requests[0]!.body).toEqual({
      systemId: "system.fresh_app", genomeRepo: "fresh_app.genome", appRepo: "fresh_app.app", force: false,
      scaffoldFrom: { repo: "platform", commit: platformHead, path },
    });
    const scaffoldFiles = filesAt(lc.path("artyfact", "platform")).filter((f) => f.startsWith(`${path}/`)).map((f) => f.slice(path.length + 1));
    expect(filesAt(lc.path("artyfact", "fresh_app.app"))).toEqual([...scaffoldFiles, ".artyfact/template.json"].sort());
    expect(filesAt(lc.path("artyfact", "fresh_app.app"))).toContain(".gitignore");
    // The template lock: the template, the platform commit and the blob id of every scaffolded file, as git has them.
    const app = lc.path("artyfact", "fresh_app.app");
    const lock = JSON.parse(sh(tmp, "--git-dir", app, "show", "main:.artyfact/template.json")) as { template: string; scaffoldCommit: string; files: Record<string, string> };
    expect(lock.template).toBe("thing/cloudflare-worker-webapp@1");
    expect(lock.scaffoldCommit).toBe(platformHead);
    expect(Object.keys(lock.files)).toEqual(scaffoldFiles);
    for (const f of scaffoldFiles) {
      expect(lock.files[f], f).toBe(sh(tmp, "--git-dir", app, "rev-parse", `main:${f}`));
      expect(lock.files[f], f).toBe(sh(tmp, "--git-dir", lc.path("artyfact", "platform"), "rev-parse", `main:${path}/${f}`));
    }
    const again = await run(["init", "--dir", dir, "--from-template", "template.thing.cloudflare-worker-webapp@1"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(again.out).toContain("fresh_app.app: already has history");
    expect(p.requests[1]!.body).not.toHaveProperty("scaffoldFrom");
    // Re-running without the flag works too: the app lives only in its repo (the platform keeps the recorded scaffoldFrom).
    const plain = await run(["init", "--dir", dir, "--force"], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(plain.code, plain.err).toBe(0);
    expect(plain.out).toContain(`fresh_app.app: no local app; using its head ${headOf(lc.path("artyfact", "fresh_app.app")).slice(0, 12)}`);
    expect(p.requests[2]!.body).toEqual({ systemId: "system.fresh_app", genomeRepo: "fresh_app.genome", appRepo: "fresh_app.app", force: true });
    noTokenLeaks(lc.tokens, r.out, r.err, again.out, plain.out);
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
    expect(r.out).toContain(`peopling.app: forked from other.app@${otherHead.slice(0, 12)}`);
    expect(headOf(lc.path("artyfact", "peopling.app"))).toBe(otherHead);
    expect(p.requests[0]!.body.scaffoldFrom).toEqual({ repo: "other.app", commit: otherHead });
  });

  it("refuses ambiguous input", async () => {
    const lc = localCloud(join(tmp, "cloud-bad"));
    const dir = project("bad-proj");
    const both = await run(["init", "--dir", dir, "--from-template", "template.thing.cloudflare-worker-webapp@1"], { cloud: lc.cloud });
    expect([both.code, both.err]).toEqual([1, expect.stringContaining("exists")]);
    const none = await run(["init", "--dir", join(tmp, "nowhere")], { cloud: lc.cloud });
    expect([none.code, none.err]).toEqual([1, expect.stringContaining("no node.yaml")]);
    const noApp = await run(["init", "--dir", project("bad-noapp", false)], { cloud: lc.cloud });
    expect([noApp.code, noApp.err]).toEqual([1, expect.stringContaining("peopling.app has no commits; pass --app <dir>, or --from-template")]);
  });
});

describe("security", { timeout: 60_000 }, () => {
  const setId = (dir: string, id: string) =>
    writeFileSync(join(dir, "genome", "node.yaml"), readFileSync(join(dir, "genome", "node.yaml"), "utf8").replace("id: system.peopling", `id: ${id}`));

  it("skips a symlink to /etc inside the project and pushes nothing outside it", async () => {
    const lc = localCloud(join(tmp, "cloud-sec-link"));
    const dir = project("sec-link");
    symlinkSync("/etc", join(dir, "genome", "etc"));
    symlinkSync("/etc/hosts", join(dir, "app", "hosts"));
    symlinkSync("README.md", join(dir, "app", "readme-link"));
    // Points inside the project, but by absolute path: the text would leak a local path and dangle in a clone.
    symlinkSync(join(realpathSync(dir), "app", "README.md"), join(dir, "app", "abs-link"));
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: mockPlatform().fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("skipped etc (absolute or outside symlink");
    expect(r.out).toContain("skipped hosts (absolute or outside symlink");
    expect(r.out).toContain("skipped abs-link (absolute or outside symlink");
    const genome = filesAt(lc.path("artyfact", "peopling.genome"));
    const app = filesAt(lc.path("artyfact", "peopling.app"));
    expect(genome.some((f) => f.startsWith("etc"))).toBe(false);
    expect(app).not.toContain("hosts");
    expect(app).not.toContain("abs-link");
    // A link that stays inside the project is kept as a link, never dereferenced.
    expect(app).toContain("readme-link");
    expect(sh(tmp, "--git-dir", lc.path("artyfact", "peopling.app"), "cat-file", "-p", "main:readme-link")).toBe("README.md");
  });

  for (const mode of ["no git", "git, untracked", "git, tracked"] as const) {
    it(`never pushes secret files (${mode}); .dev.vars.example is kept`, async () => {
      const lc = localCloud(join(tmp, `cloud-sec-secrets-${mode.replace(/\W+/g, "-")}`));
      const dir = project(`sec-secrets-${mode.replace(/\W+/g, "-")}`);
      const app = join(dir, "app");
      const secrets = [".dev.vars", ".dev.vars.staging", ".env", ".env.local", ".env.production", "sub/.env.local"];
      mkdirSync(join(app, "sub"), { recursive: true });
      for (const f of [...secrets, ".dev.vars.example", ".env.example"]) writeFileSync(join(app, f), "SECRET=1\n");
      if (mode !== "no git") {
        sh(app, "init", "-q", "-b", "main");
        writeFileSync(join(app, ".gitignore"), "node_modules\n");
        if (mode === "git, tracked") {
          sh(app, "add", "-f", "-A");
          sh(app, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "tracked secrets");
        }
      }
      const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: mockPlatform().fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
      expect(r.code, r.err).toBe(0);
      const pushed = filesAt(lc.path("artyfact", "peopling.app"));
      for (const f of secrets) expect(pushed, f).not.toContain(f);
      expect(pushed).toEqual(expect.arrayContaining([".dev.vars.example", ".env.example"]));
    });
  }

  it("stops with a clear message when the server rejects the push", async () => {
    const lc = localCloud(join(tmp, "cloud-sec-reject"));
    const dir = project("sec-reject");
    const first = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: mockPlatform().fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(first.code, first.err).toBe(0);
    const genome = lc.path("artyfact", "peopling.genome");
    const before = headOf(genome);
    writeFileSync(join(genome, "hooks", "pre-receive"), "#!/bin/sh\necho 'main moved' >&2\nexit 1\n");
    chmodSync(join(genome, "hooks", "pre-receive"), 0o755);
    writeFileSync(join(dir, "genome", "README.md"), "changed\n");
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
    expect(r.code).toBe(1);
    expect(r.err).toContain("push to peopling.genome was rejected");
    expect(headOf(genome)).toBe(before);
    expect(p.requests).toEqual([]);
  });

  it("names the account by its prefix only, also in git errors that echo the remote", async () => {
    const lc = localCloud(join(tmp, "cloud-sec-acct"));
    const cloud: Cloud = { ...lc.cloud, accountId: () => ACCOUNT, remote: (ns, repo) => `file:///nonexistent/${ACCOUNT}/${ns}/${repo}.git` };
    const r = await run(["init", "--dir", project("sec-acct")], { cloud });
    expect(r.code).toBe(1);
    expect(r.err).toContain("git ls-remote failed");
    expect(r.err).toContain("01234567…");
    expect(r.err).not.toContain(ACCOUNT);
  });

  it("sends the admin token over https or to localhost only", async () => {
    const lc = localCloud(join(tmp, "cloud-sec-http"));
    const dir = project("sec-http");
    const p = mockPlatform();
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a", ARTYFACT_URL: "http://platform.test" } });
    expect([r.code, r.err]).toEqual([1, expect.stringContaining("refusing to send ARTYFACT_ADMIN_TOKEN to http://platform.test")]);
    expect(p.requests).toEqual([]);
    for (const url of ["http://localhost:1339", "http://127.0.0.1:1339"]) {
      const ok = await run(["init", "--dir", dir, "--platform", url], { cloud: lc.cloud, fetch: p.fetch, env: { ARTYFACT_ADMIN_TOKEN: "a" } });
      expect(ok.code, ok.err).toBe(0);
    }
    expect(p.requests.map((q) => q.url)).toEqual(["http://localhost:1339/api/systems/import", "http://127.0.0.1:1339/api/systems/import"]);
  });

  it("never sends a credential to a local server that did not identify itself as artyfact", async () => {
    const lc = localCloud(join(tmp, "cloud-sec-foreign"));
    const dir = project("sec-foreign");
    const authed: string[] = [];
    // Port 1337 serves some other app with 200; nothing else listens.
    const foreign = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (new Headers(init?.headers).get("authorization")) authed.push(url.href);
      if (url.port === "1337") return new Response("<html>other app</html>", { status: 200 });
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as typeof fetch;
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud, fetch: foreign, env: { ARTYFACT_URL: "", ARTYFACT_ADMIN_TOKEN: "adm-tok" } });
    expect(r.code).toBe(1);
    expect(r.err).toContain("no artyfact platform found on localhost:1337–1346");
    expect(authed).toEqual([]);
    // Stopped before anything was pushed.
    expect(existsSync(lc.path("artyfact", "peopling.genome"))).toBe(false);

    const s = await run(["start", "realization.1.r1", "--dir", join(tmp, "sec-foreign-ws"), "--system", "system.peopling", "--evolution", "evolution.1"],
      { cloud: lc.cloud, fetch: foreign, env: { ARTYFACT_URL: "", ARTYFACT_SECRET: "ab".repeat(32), ARTYFACT_TOKEN: "art_v1_x" } });
    expect(s.code).toBe(1);
    expect(s.err).toContain("no artyfact platform found on localhost:1337–1346");
    expect(authed).toEqual([]);
  });

  it("refuses a default project dir that resolves outside --dir", async () => {
    const lc = localCloud(join(tmp, "cloud-sec-out"));
    const outside = project("sec-outside");
    const dir = join(tmp, "sec-escape");
    mkdirSync(dir);
    symlinkSync(join(outside, "genome"), join(dir, "genome"));
    const r = await run(["init", "--dir", dir], { cloud: lc.cloud });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/genome dir .* resolves to .*, outside/);
    expect(existsSync(lc.path("artyfact", "peopling.genome"))).toBe(false);
  });

  it("rejects option-like and path-like names before any argv", async () => {
    const lc = localCloud(join(tmp, "cloud-sec-names"));
    const dir = project("sec-names");
    for (const ns of ["-c", "--upload-pack=touch /tmp/pwned", "a/b", ".."]) {
      const r = await run(["init", "--dir", dir, `--namespace=${ns}`], { cloud: lc.cloud });
      expect([r.code, r.err], ns).toEqual([1, expect.stringContaining("invalid namespace")]);
    }
    const t = await run(["init", "--dir", join(tmp, "sec-names-tpl"), "--genome", join(dir, "genome"), "--from-template=-c"], { cloud: lc.cloud });
    expect([t.code, t.err]).toEqual([1, expect.stringContaining("invalid template ref")]);
    for (const id of ["system.a/b", "system..x", "--upload-pack=evil", "-c", "system.Peopling"]) {
      setId(dir, id);
      const r = await run(["init", "--dir", dir], { cloud: lc.cloud });
      expect([r.code, r.err], id).toEqual([1, expect.stringContaining("invalid system id")]);
    }
    expect(existsSync(join(lc.root, "artyfact"))).toBe(false);
  });

  it("rejects a scaffold repo that looks like an option and a scaffold path that leaves the repo", async () => {
    for (const [scaffold, message] of [["repo: --upload-pack=evil\n", "invalid scaffold repo"], ["repo: platform\npath: ../../etc\n", "must be a relative path inside the repo"]] as const) {
      const lc = localCloud(join(tmp, `cloud-sec-sc-${message.length}`));
      const root = join(tmp, `sec-sc-root-${message.length}`);
      mkdirSync(join(root, "packages/templates/thing/evil@1"), { recursive: true });
      writeFileSync(join(root, "packages/templates/thing/evil@1/template.yaml"), "id: template.thing.evil\nversion: '1'\n");
      writeFileSync(join(root, "packages/templates/thing/evil@1/scaffold.yaml"), scaffold);
      const dir = project(`sec-sc-${message.length}`, false);
      const r = await run(["init", "--dir", dir, "--from-template", "template.thing.evil@1"], { cloud: lc.cloud, root });
      expect([r.code, r.err]).toEqual([1, expect.stringContaining(message)]);
      expect(existsSync(lc.path("artyfact", "peopling.app"))).toBe(false);
    }
  });
});
