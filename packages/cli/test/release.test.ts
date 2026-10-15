import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Cloud } from "../src/cloud.ts";
import { main } from "../src/main.ts";
import { BUILDS_REPO, WORKERS, modelDigestAt, release, releaseTag, type ReleaseIo } from "../src/release.ts";

for (const k of Object.keys(process.env)) {
  if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|QUARANTINE_PATH|NAMESPACE|CEILING_DIRECTORIES|CONFIG\w*)$/.test(k)) delete process.env[k];
}

const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tmp = mkdtempSync(join(tmpdir(), "artyfact-release-test-"));
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const IDENT = ["-c", "user.name=t", "-c", "user.email=t@localhost"];
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Artifacts stand-in: bare repos under `<root>/<ns>/<repo>.git`, file:// remotes, recorded calls. */
function localCloud(root: string) {
  const calls: string[] = [];
  const path = (ns: string, repo: string) => join(root, ns, `${repo}.git`);
  const cloud: Cloud = {
    account: () => ACCOUNT,
    accountId: () => ACCOUNT,
    ensureNamespace: (ns) => (mkdirSync(join(root, ns), { recursive: true }), "exists"),
    repoExists: (ns, repo) => existsSync(path(ns, repo)),
    createRepo(ns, repo) {
      calls.push(`createRepo ${ns}/${repo}`);
      mkdirSync(join(root, ns), { recursive: true });
      sh(root, "init", "-q", "--bare", "-b", "main", path(ns, repo));
    },
    token(_ns, repo, scope) {
      calls.push(`token ${repo} ${scope}`);
      return `art_v1_${scope}${calls.length}?expires=9999999999`;
    },
    fork: () => { throw new Error("not used"); },
    remote: (ns, repo) => `file://${path(ns, repo)}`,
  };
  return { cloud, calls, path };
}

/** A monorepo stand-in: one commit, a `genome/` dir, and build outputs shaped like the real ones. */
function sourceRepo(name: string) {
  const root = join(tmp, name);
  mkdirSync(join(root, "system"), { recursive: true });
  writeFileSync(join(root, "system/node.yaml"), "id: system.artyfact\n");
  writeFileSync(join(root, "package.json"), "{}\n");
  mkdirSync(join(root, "apps/site"), { recursive: true });
  writeFileSync(join(root, "apps/site/wrangler.jsonc"), `{ "name": "artyfact-site", "assets": { "directory": "./dist" } }\n`);
  writeFileSync(join(root, ".gitignore"), "dist/\n");
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, ...IDENT, "commit", "-q", "-m", "source");
  return { root, head: sh(root, "rev-parse", "HEAD") };
}

/** Fake builder: writes the outputs @cloudflare/vite-plugin and vite would. */
function fakeBuild(root: string) {
  const p = join(root, "apps/platform/dist");
  mkdirSync(join(p, "artyfact_platform/assets"), { recursive: true });
  mkdirSync(join(p, "client/assets"), { recursive: true });
  writeFileSync(join(p, "artyfact_platform/wrangler.json"), JSON.stringify({ name: "artyfact-platform", main: "index.js", no_bundle: true, assets: { directory: "../client" } }));
  writeFileSync(join(p, "artyfact_platform/index.js"), "export default { fetch() { return new Response('ok') } }\n");
  writeFileSync(join(p, "client/index.html"), "<!doctype html>\n");
  const s = join(root, "apps/site/dist");
  mkdirSync(join(s, ".vite"), { recursive: true });
  writeFileSync(join(s, ".vite/manifest.json"), "{}");
  writeFileSync(join(s, "index.html"), "<!doctype html>site\n");
  writeFileSync(join(s, "_headers"), "/*\n  X-Test: 1\n");
}

interface Deploy { checkout: string; config: string; dryRun: boolean; account?: string; filesSeen: string[] }
function harness(name: string, cloudRoot = join(tmp, `${name}-cloud`)) {
  const src = sourceRepo(name);
  const lc = localCloud(cloudRoot);
  const out: string[] = [];
  const builds: string[] = [];
  const deploys: Deploy[] = [];
  const io: ReleaseIo = {
    out: (s) => out.push(s), err: (s) => out.push(`! ${s}`), cwd: src.root, env: {}, cloud: lc.cloud, root: src.root,
    build: (root) => { builds.push(root); fakeBuild(root); },
    deploy: (checkout, config, o) => deploys.push({ checkout, config, dryRun: o.dryRun, account: o.env.CLOUDFLARE_ACCOUNT_ID, filesSeen: [config, "release.json"].filter((f) => existsSync(join(checkout, f))) }),
    now: () => new Date("2026-10-14T21:05:00Z"),
  };
  const lsTree = () => sh(cloudRoot, "--git-dir", lc.path("artyfact", BUILDS_REPO), "ls-tree", "-r", "--name-only", "main").split("\n");
  const fileAt = (p: string) => sh(cloudRoot, "--git-dir", lc.path("artyfact", BUILDS_REPO), "show", `main:${p}`);
  return { ...src, lc, io, out, builds, deploys, lsTree, fileAt };
}

describe("releaseTag", () => {
  it("names the immutable source commit", () => {
    expect(releaseTag("abc1234def0000000000000000000000000000000")).toBe("v-abc1234def00");
  });
});

describe("artyfact release", () => {
  it("pushes the build outputs, a manifest and a tag to platform.builds, then deploys from that checkout", async () => {
    const h = harness("full");
    const r = await release({}, h.io);
    const tag = releaseTag(h.head);
    expect(r.action).toBe("created");
    expect(r.manifest.version).toBe(tag);
    expect(h.builds).toEqual([h.root]);
    expect(h.lc.calls).toEqual([`createRepo artyfact/${BUILDS_REPO}`, `token ${BUILDS_REPO} write`]);

    // Repo layout: one self-contained directory per Worker plus the manifest; no dot-directories, nothing from the source tree.
    const files = h.lsTree();
    expect(files).toEqual(expect.arrayContaining([
      "release.json",
      "platform/artyfact_platform/wrangler.json", "platform/artyfact_platform/index.js", "platform/client/index.html",
      "site/wrangler.jsonc", "site/dist/index.html", "site/dist/_headers",
    ]));
    expect(files.some((f) => f.includes(".vite") || f.startsWith("genome/") || f === "package.json")).toBe(false);
    for (const w of WORKERS) expect(files).toContain(w.config);

    // Manifest: source commit, accepted model prefix/digest, build time, workers and tool versions.
    const manifest = JSON.parse(h.fileAt("release.json"));
    expect(manifest).toMatchObject({
      version: tag, gitCommit: h.head, genome: { commit: h.head, prefix: "system", digest: modelDigestAt(h.root, h.head, "system") }, builtAt: "2026-10-14T21:05:00.000Z",
      workers: { "artyfact-platform": { config: "platform/artyfact_platform/wrangler.json" }, "artyfact-site": { config: "site/wrangler.jsonc" } },
    });
    expect(manifest.versions.node).toBe(process.version);

    // Tag and commit in the builds repo.
    const bare = h.lc.path("artyfact", BUILDS_REPO);
    expect(sh(h.root, "--git-dir", bare, "rev-parse", `${tag}^{commit}`)).toBe(r.buildsCommit);
    expect(sh(h.root, "--git-dir", bare, "rev-parse", "main")).toBe(r.buildsCommit);
    expect(sh(h.root, "--git-dir", bare, "log", "-1", "--format=%s", "main")).toBe(`release ${tag} from ${h.head}`);

    // Deploy ran from the checkout (its config paths are relative to the checkout and exist there), with the account.
    expect(h.deploys.map((d) => d.config)).toEqual(["platform/artyfact_platform/wrangler.json", "site/wrangler.jsonc"]);
    for (const d of h.deploys) {
      expect(d.dryRun).toBe(false);
      expect(d.account).toBe(ACCOUNT);
      expect(d.checkout.startsWith(h.root)).toBe(false);
      expect(d.filesSeen).toEqual([d.config, "release.json"]);
    }
    expect(r.deployed).toEqual(["artyfact-platform", "artyfact-site"]);
    expect(h.out.join("\n")).not.toMatch(/art_v1_/);
  });

  it("is idempotent: the same source commit reuses the existing release and deploys it again", async () => {
    const h = harness("twice");
    const first = await release({}, h.io);
    const before = sh(h.root, "--git-dir", h.lc.path("artyfact", BUILDS_REPO), "rev-list", "--count", "main");
    h.builds.length = 0;
    h.deploys.length = 0;
    const second = await release({}, h.io);
    expect(second.action).toBe("reused");
    expect(second.buildsCommit).toBe(first.buildsCommit);
    expect(h.builds).toEqual([]);
    expect(sh(h.root, "--git-dir", h.lc.path("artyfact", BUILDS_REPO), "rev-list", "--count", "main")).toBe(before);
    expect(h.deploys.map((d) => d.config)).toEqual(WORKERS.map((w) => w.config));
  });

  it("reuses the same release on a later UTC date", async () => {
    const h = harness("cross-day");
    const first = await release({}, h.io);
    h.io.now = () => new Date("2026-10-15T21:05:00Z");
    const second = await release({}, h.io);
    expect(second.action).toBe("reused");
    expect(second.manifest.version).toBe(first.manifest.version);
    expect(second.buildsCommit).toBe(first.buildsCommit);
  });

  it("--dry-run builds and stages but creates no repo, pushes nothing and deploys with --dry-run", async () => {
    const h = harness("dry");
    const r = await release({ dryRun: true }, h.io);
    expect(r.action).toBe("dry-run");
    expect(h.lc.calls).toEqual([]);
    expect(existsSync(h.lc.path("artyfact", BUILDS_REPO))).toBe(false);
    expect(h.builds).toEqual([h.root]);
    expect(h.deploys.map((d) => d.dryRun)).toEqual([true, true]);
    expect(h.deploys.every((d) => d.filesSeen.length === 2)).toBe(true);
    expect(h.out.join("\n")).toMatch(/would push/);
  });

  it("--dry-run against an existing repo reads with a read token only", async () => {
    const h = harness("dry-existing");
    await release({}, h.io);
    h.lc.calls.length = 0;
    const before = sh(h.root, "--git-dir", h.lc.path("artyfact", BUILDS_REPO), "rev-parse", "main");
    sh(h.root, ...IDENT, "commit", "-q", "--allow-empty", "-m", "next");
    const r = await release({ dryRun: true }, h.io);
    expect(r.action).toBe("dry-run");
    expect(h.lc.calls).toEqual([`token ${BUILDS_REPO} read`]);
    expect(sh(h.root, "--git-dir", h.lc.path("artyfact", BUILDS_REPO), "rev-parse", "main")).toBe(before);
  });

  it("fails closed on tracked or untracked source inputs, a missing build and --no-deploy skips deploys", async () => {
    const h = harness("closed");
    writeFileSync(join(h.root, "package.json"), "{ }\n");
    await expect(release({}, h.io)).rejects.toThrow(/uncommitted or untracked changes/);
    sh(h.root, "checkout", "--", "package.json");
    writeFileSync(join(h.root, "untracked-input.ts"), "export {}\n");
    await expect(release({}, h.io)).rejects.toThrow(/uncommitted or untracked changes/);
    rmSync(join(h.root, "untracked-input.ts"));
    await expect(release({ noBuild: true }, h.io)).rejects.toThrow(/apps\/platform\/dist is missing/);
    expect(h.lc.calls).toEqual([`createRepo artyfact/${BUILDS_REPO}`, `token ${BUILDS_REPO} write`]);
    const r = await release({ noDeploy: true }, h.io);
    expect(r.deployed).toEqual([]);
    expect(h.deploys).toEqual([]);
  });

  it("runs through the CLI as `artyfact release`", async () => {
    const h = harness("cli");
    const code = await main(["release", "--dry-run", "--json"], { ...h.io } as never);
    expect(code).toBe(0);
    const json = h.out.find((l) => l.startsWith("{"));
    expect(json && JSON.parse(json).action).toBe("dry-run");
    const bad = await main(["release", "--namespace", "../x"], { ...h.io } as never);
    expect(bad).toBe(1);
  });
});
