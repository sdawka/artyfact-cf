/**
 * `artyfact release`: build the platform and site, commit the build outputs to the Artifacts repo
 * `<namespace>/platform.builds` (one commit and one tag per source commit), then deploy each Worker from that
 * checkout. The deployed version therefore comes from Artifacts, never from a local worktree; `release.json` in the
 * repo is the deployment record. Design: docs/design/release-artifacts.md.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cloudCli, spawnExec, type Cloud } from "./cloud.ts";
import { CliError, git } from "./git.ts";
import { assertName } from "./safety.ts";

export const BUILDS_REPO = "platform.builds";
const DEFAULT_NS = "artyfact";
const IDENTITY = ["-c", "user.name=artyfact", "-c", "user.email=artyfact@localhost"];

/** A Worker in the release: where its build output comes from and the config `wrangler deploy` reads in the checkout. */
export interface ReleaseWorker {
  name: string;
  /** Build output directory under the monorepo, copied whole into the release tree. */
  from: string;
  /** Path of the copied directory in the release tree. */
  to: string;
  /** Wrangler config inside the release tree, relative to its root. */
  config: string;
  /** Files the output tree must contain (fails closed when a build is missing or partial). */
  expect: string[];
}

export const WORKERS: ReleaseWorker[] = [
  // @cloudflare/vite-plugin writes a self-contained config (main index.js, no_bundle, assets ../client) under dist/.
  { name: "artyfact-platform", from: "apps/platform/dist", to: "platform", config: "platform/artyfact_platform/wrangler.json",
    expect: ["artyfact_platform/wrangler.json", "artyfact_platform/index.js", "client/index.html"] },
  // The site is assets only; its wrangler.jsonc names ./dist, so the config and dist travel together.
  { name: "artyfact-site", from: "apps/site/dist", to: "site/dist", config: "site/wrangler.jsonc", expect: ["index.html"] },
];

export interface ReleaseManifest {
  /** Tag name, `v<yyyymmdd>-<7-char git sha>`. */
  version: string;
  /** Monorepo commit the outputs were built from. */
  gitCommit: string;
  /** Tree hash of the repo-root `genome/` at that commit: the self-Genome (`system.artyfact`) these outputs realize. */
  genomeTree: string;
  builtAt: string;
  workers: Record<string, { config: string }>;
  versions: { node: string; wrangler?: string };
}

export interface ReleaseIo {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  cloud?: Cloud;
  /** Monorepo root (defaults to this package's). */
  root?: string;
  /** Builds the workspaces (default: `npm run build -w` each). */
  build?: (root: string) => void;
  /** Deploys one Worker with cwd in the release checkout (default: wrangler from the monorepo's node_modules). */
  deploy?: (checkout: string, config: string, opts: { dryRun: boolean; env: Record<string, string | undefined> }) => void;
  now?: () => Date;
}

export interface ReleaseOptions {
  ns?: string;
  repo?: string;
  dryRun?: boolean;
  noBuild?: boolean;
  noDeploy?: boolean;
  allowDirty?: boolean;
}

export interface ReleaseResult {
  manifest: ReleaseManifest;
  /** Commit in the builds repo that holds this release. */
  buildsCommit: string;
  action: "created" | "reused" | "dry-run";
  deployed: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = () => resolve(here, "../../..");

/** `v20261014-abc1234` from a build date (UTC) and the source commit. */
export function releaseTag(date: Date, gitCommit: string): string {
  const ymd = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `v${ymd}-${gitCommit.slice(0, 7)}`;
}

function defaultBuild(root: string): void {
  for (const w of ["@artyfact/platform", "@artyfact/site"]) {
    const r = spawnSync("npm", ["run", "build", "-w", w], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) throw new CliError(`npm run build -w ${w} failed`);
  }
}

/** `wrangler deploy --config <config>` with cwd in the checkout; wrangler comes from the monorepo (the checkout has no node_modules). */
function wranglerDeploy(root: string) {
  return (checkout: string, config: string, opts: { dryRun: boolean; env: Record<string, string | undefined> }) => {
    const bin = join(root, "node_modules/wrangler/bin/wrangler.js");
    if (!existsSync(bin)) throw new CliError("wrangler is not installed; run npm install");
    const args = [bin, "deploy", "--config", config, ...(opts.dryRun ? ["--dry-run"] : [])];
    const r = spawnSync(process.execPath, args, { cwd: checkout, stdio: "inherit", env: { ...process.env, ...opts.env } });
    if (r.status !== 0) throw new CliError(`wrangler deploy --config ${config} failed`);
  };
}

function wranglerVersion(root: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(root, "node_modules/wrangler/package.json"), "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** Copies a build output into the release tree, without `.vite` or other dot-directories, and checks it is complete. */
function stageWorker(root: string, tree: string, w: ReleaseWorker): void {
  const src = join(root, w.from);
  if (!existsSync(src)) throw new CliError(`${w.from} is missing; build first (or drop --no-build)`);
  for (const f of w.expect) if (!existsSync(join(src, f))) throw new CliError(`${w.from}/${f} is missing; the ${w.name} build is incomplete`);
  cpSync(src, join(tree, w.to), { recursive: true, dereference: false, filter: (p) => !/(^|\/)\.[^/]+$/.test(p) || p === src });
}

/** The release tree (a temp dir) for the current build outputs plus its manifest. */
export function stageRelease(root: string, manifest: ReleaseManifest): string {
  const tree = mkdtempSync(join(tmpdir(), "artyfact-release-"));
  for (const w of WORKERS) stageWorker(root, tree, w);
  cpSync(join(root, "apps/site/wrangler.jsonc"), join(tree, "site/wrangler.jsonc"));
  writeFileSync(join(tree, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return tree;
}

/** Everything in `dir` except `.git`. */
const entriesOf = (dir: string) => readdirSync(dir).filter((e) => e !== ".git");

export async function release(opts: ReleaseOptions, io: ReleaseIo): Promise<ReleaseResult> {
  const root = io.root ?? defaultRoot();
  const ns = assertName("namespace", opts.ns ?? io.env.ARTYFACT_NAMESPACE ?? DEFAULT_NS);
  const repo = assertName("repo name", opts.repo ?? BUILDS_REPO);
  const dryRun = !!opts.dryRun;
  const now = io.now ?? (() => new Date());

  // 1. Source facts, fail closed on a dirty tree: the record must name the commit that was built.
  const gitCommit = git(root, ["rev-parse", "HEAD"]);
  if (!opts.allowDirty && git(root, ["status", "--porcelain", "--untracked-files=no"]) !== "")
    throw new CliError("the source tree has uncommitted changes; commit them or pass --allow-dirty");
  const genomeTree = git(root, ["rev-parse", `${gitCommit}:genome`]);
  const version = releaseTag(now(), gitCommit);

  // 2. Account and remote. The cloud's own checks keep names off argv and tokens off stdout.
  const cloud = io.cloud ?? cloudCli(spawnExec(root), io.env);
  const account = cloud.account();
  io.out(`release ${version} from ${gitCommit.slice(0, 7)} (account ${account.slice(0, 8)}…) to ${ns}/${repo}${dryRun ? " [dry-run]" : ""}`);
  const exists = cloud.repoExists(ns, repo);
  if (!exists && !dryRun) {
    cloud.createRepo(ns, repo);
    io.out(`  created repo ${repo}`);
  }
  const remote = exists || !dryRun ? { url: cloud.remote(ns, repo), token: cloud.token(ns, repo, dryRun ? "read" : "write") } : null;

  // 3. Checkout of the builds repo (shallow). A tag for this source commit means the release exists: reuse it.
  const parent = mkdtempSync(join(tmpdir(), "artyfact-builds-"));
  const checkout = join(parent, "repo");
  let tree: string | undefined;
  try {
    if (remote) git(parent, ["clone", "-q", "--depth=1", "--", remote.url, checkout], remote.token);
    else git(parent, ["init", "-q", "-b", "main", checkout]);
    let action: ReleaseResult["action"];
    let buildsCommit: string;
    const tagged = remote ? git(checkout, ["ls-remote", "--tags", "--", remote.url, `refs/tags/${version}`], remote.token) : "";
    if (tagged) {
      git(checkout, ["fetch", "-q", "--depth=1", "--", remote!.url, `refs/tags/${version}:refs/tags/${version}`], remote!.token);
      git(checkout, ["checkout", "-q", "--detach", `refs/tags/${version}`]);
      buildsCommit = git(checkout, ["rev-parse", "HEAD"]);
      action = "reused";
      io.out(`  ${version} already in ${repo} at ${buildsCommit.slice(0, 7)}; deploying that release`);
    } else {
      if (!opts.noBuild) (io.build ?? defaultBuild)(root);
      const manifest: ReleaseManifest = {
        version, gitCommit, genomeTree, builtAt: now().toISOString(),
        workers: Object.fromEntries(WORKERS.map((w) => [w.name, { config: w.config }])),
        versions: { node: process.version, wrangler: wranglerVersion(root) },
      };
      tree = stageRelease(root, manifest);
      for (const e of entriesOf(checkout)) rmSync(join(checkout, e), { recursive: true, force: true });
      for (const e of entriesOf(tree)) cpSync(join(tree, e), join(checkout, e), { recursive: true });
      git(checkout, ["add", "-A", "--", "."]);
      git(checkout, [...IDENTITY, "commit", "-q", "-m", `release ${version} from ${gitCommit}`, "--"]);
      git(checkout, [...IDENTITY, "tag", "-a", version, "-m", `release ${version}`]);
      buildsCommit = git(checkout, ["rev-parse", "HEAD"]);
      if (dryRun) {
        action = "dry-run";
        io.out(`  would push ${buildsCommit.slice(0, 7)} as main and tag ${version}`);
      } else {
        git(checkout, ["push", "-q", "--", remote!.url, "HEAD:refs/heads/main", `refs/tags/${version}`], remote!.token);
        action = "created";
        io.out(`  pushed ${buildsCommit.slice(0, 7)} as main, tag ${version}`);
      }
    }
    const manifest = JSON.parse(readFileSync(join(checkout, "release.json"), "utf8")) as ReleaseManifest;

    // 4. Deploy each Worker from the checkout, never from the worktree.
    const deployed: string[] = [];
    if (!opts.noDeploy) {
      const deploy = io.deploy ?? wranglerDeploy(root);
      const env = { CLOUDFLARE_ACCOUNT_ID: account };
      for (const w of WORKERS) {
        if (!existsSync(join(checkout, w.config))) throw new CliError(`${w.config} is missing from ${repo} at ${buildsCommit.slice(0, 7)}`);
        io.out(`  deploy ${w.name} from ${repo}@${buildsCommit.slice(0, 7)} (${w.config})${dryRun ? " [dry-run]" : ""}`);
        deploy(checkout, w.config, { dryRun, env });
        deployed.push(w.name);
      }
    }
    io.out(`release ${manifest.version}: ${repo}@${buildsCommit.slice(0, 7)}, ${action}${deployed.length ? `, deployed ${deployed.join(", ")}` : ""}`);
    return { manifest, buildsCommit, action, deployed };
  } finally {
    rmSync(parent, { recursive: true, force: true });
    if (tree) rmSync(tree, { recursive: true, force: true });
  }
}

export async function releaseCommand(args: string[], io: ReleaseIo): Promise<number> {
  const { values } = parseArgs({
    args, strict: true, allowPositionals: false,
    options: {
      namespace: { type: "string" }, repo: { type: "string" },
      "dry-run": { type: "boolean" }, "no-build": { type: "boolean" }, "no-deploy": { type: "boolean" }, "allow-dirty": { type: "boolean" }, json: { type: "boolean" },
    },
  });
  const r = await release({
    ns: values.namespace, repo: values.repo, dryRun: values["dry-run"], noBuild: values["no-build"], noDeploy: values["no-deploy"], allowDirty: values["allow-dirty"],
  }, io);
  if (values.json) io.out(JSON.stringify(r));
  return 0;
}
