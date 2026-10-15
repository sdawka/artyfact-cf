#!/usr/bin/env node
// The single CI definition. Hosted CI (.github/workflows/ci.yml) runs the four jobs in parallel; the pre-push hook runs --fast.
//   npm run ci                        full run: every job, in sequence
//   npm run ci -- --changed           only the jobs affected by the commits being pushed
//   npm run ci -- --job <name>        one job: unit | e2e-fixture | e2e-fake | site
//   npm run ci -- --fast              typecheck and unit tests of the changed workspaces only, two workers, no e2e
//   npm run ci -- --plan              print `job=true|false` lines for the jobs that would run, then exit
//   --base <ref>                      compare against <ref> instead of the upstream or origin/main
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const changedOnly = flag("--changed") || flag("--fast");
const fast = flag("--fast");
const plan = flag("--plan");
const only = option("--job");

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

/** Files changed by the commits a push would send, against the upstream or origin/main. null when no base exists. */
function changedFiles() {
  const explicit = option("--base");
  const upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  for (const base of explicit ? [explicit] : [upstream, "origin/main"].filter(Boolean)) {
    const mergeBase = git("merge-base", "HEAD", base);
    if (!mergeBase) continue;
    const files = git("diff", "--name-only", `${mergeBase}..HEAD`);
    if (files !== null) return files.split("\n").filter(Boolean);
  }
  return null;
}

const isDoc = (f) => /\.(md|mdx|txt|png|jpe?g|gif|svg|webp|mp4|webm)$/i.test(f) || f.startsWith("docs/") || f.startsWith("licenses/") || f === "LICENSE";
// Site job inputs: apps/site, packages/effects, packages/cli, the lockfile, and this script and workflow.
const isSite = (f) =>
  f.startsWith("apps/site/") ||
  f.startsWith("packages/effects/") ||
  f.startsWith("packages/cli/") ||
  f === "package-lock.json" ||
  f.startsWith("scripts/ci") ||
  f === ".github/workflows/ci.yml";
// Every other code change runs the platform jobs (the root typecheck and tests also cover effects and cli).
const isSiteOnly = (f) => f.startsWith("apps/site/");

const JOBS = ["unit", "e2e-fixture", "e2e-fake", "site"];
if (only && !JOBS.includes(only)) {
  console.error(`ci: unknown --job "${only}"; expected one of ${JOBS.join(", ")}`);
  process.exit(2);
}

let platform = true;
let site = true;
let code = null; // changed code files, when --changed found a base
if (changedOnly) {
  const files = changedFiles();
  if (files === null) {
    (plan ? console.error : console.log)("ci: no base to compare with, running everything");
  } else {
    code = files.filter((f) => !isDoc(f));
    site = code.some(isSite);
    platform = code.some((f) => !isSiteOnly(f));
    // --plan is piped into $GITHUB_OUTPUT, which accepts only key=value lines, so the note goes to stderr there.
    (plan ? console.error : console.log)(`ci: ${files.length} changed file(s): platform ${platform ? "run" : "skip"}, site ${site ? "run" : "skip"}`);
    if (!platform && !site && !plan) {
      console.log("ci: no code changes, nothing to run");
      process.exit(0);
    }
  }
}

const selected = { unit: platform, "e2e-fixture": platform, "e2e-fake": platform, site };
if (plan) {
  for (const job of JOBS) console.log(`${job.replace(/-/g, "_")}=${selected[job]}`);
  process.exit(0);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Git exports GIT_DIR, GIT_INDEX_FILE and friends to hooks; left in place they redirect the git calls made by tests.
const clean = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|QUARANTINE_PATH|COMMON_DIR)$/.test(k)),
);
// GitHub runner conditions: CI=true (retries, no reused servers), software WebGL, a free port for the platform preview server.
const env = { ...clean, CI: "true", ARTYFACT_E2E_NO_GPU: "1", ARTYFACT_E2E_PORT: String(await freePort()) };

/** The workspace directory (packages/x, apps/x, examples/x) a changed file belongs to, or null for a root-level file. */
const workspaceOf = (f) => f.match(/^((?:packages|apps|examples)\/[^/]+)\//)?.[1] ?? null;
const pkg = (dir) => JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));

/** --fast: typecheck plus unit tests, scoped to the changed workspaces; a root-level change widens it to every workspace. */
function fastSteps() {
  const dirs = code === null ? null : [...new Set(code.map(workspaceOf))];
  if (dirs === null || dirs.includes(null)) {
    return [["fast: typecheck", "npm run typecheck"], ["fast: unit tests", "npx vitest run --maxWorkers=2"]];
  }
  const workspaces = dirs.filter((d) => existsSync(`${d}/package.json`));
  const steps = [];
  const tsc = [];
  for (const dir of workspaces) {
    const { name, scripts } = pkg(dir);
    if (scripts?.typecheck) steps.push([`fast: typecheck ${name}`, `npm run typecheck -w ${name}`]);
    else if (existsSync(`${dir}/tsconfig.json`)) tsc.push(dir);
  }
  if (tsc.length) steps.unshift(["fast: typecheck", `npx tsc -b ${tsc.join(" ")}`]);
  if (workspaces.length) steps.push(["fast: unit tests", `npx vitest run --maxWorkers=2 --passWithNoTests ${workspaces.map((d) => `${d}/`).join(" ")}`]);
  return steps;
}

const jobSteps = {
  unit: [
    ["platform: typecheck", "npm run typecheck"],
    ["platform: unit tests", "npm test"],
    ["platform: build", "npm run build -w @artyfact/platform"],
  ],
  "e2e-fixture": [["platform: e2e (fixture)", "npm run e2e"]],
  "e2e-fake": [["platform: e2e (fake platform)", "npm run e2e:fake -w @artyfact/platform"]],
  site: [
    ["site: typecheck", "npm run typecheck -w @artyfact/site"],
    ["site: unit tests", "npm run test -w @artyfact/site"],
    ["site: build", "npm run build -w @artyfact/site"],
    ["site: test:build", "npm run test:build -w @artyfact/site"],
    ["site: e2e", "npm run e2e -w @artyfact/site"],
  ],
};

let steps;
if (fast) {
  steps = fastSteps();
} else if (only) {
  if (!selected[only]) {
    console.log(`ci: job "${only}" is not affected by these changes, nothing to run`);
    process.exit(0);
  }
  steps = jobSteps[only];
} else {
  steps = JOBS.filter((job) => selected[job]).flatMap((job) => jobSteps[job]);
}
if (steps.length === 0) {
  console.log("ci: nothing to run");
  process.exit(0);
}

const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

// Each step runs in its own process group, so an interrupt, cancel or failure never leaves preview servers behind on a shared runner.
let child = null;
const killGroup = (sig) => {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, sig);
  } catch {}
};
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    killGroup("SIGTERM");
    process.exit(128);
  });
}
process.on("exit", () => killGroup("SIGKILL"));
const run = (cmd) =>
  new Promise((resolve) => {
    child = spawn(cmd, { shell: true, stdio: "inherit", env, detached: true });
    child.on("exit", (code, signal) => {
      killGroup("SIGKILL"); // sweep stragglers left in the group
      resolve(code ?? (signal ? 1 : 0));
    });
  });

const started = Date.now();
const timings = [];
for (const [name, cmd] of steps) {
  console.log(`\n==> ${name}  (${cmd})`);
  const t = Date.now();
  const status = await run(cmd);
  const ms = Date.now() - t;
  if (status !== 0) {
    console.error(`\nci: FAILED at step "${name}" after ${fmt(ms)}. Fix it, or skip the hook once with git push --no-verify.`);
    process.exit(status);
  }
  timings.push([name, ms]);
  console.log(`<== ${name} ok in ${fmt(ms)}`);
}
console.log("\nci: all steps passed");
for (const [name, ms] of timings) console.log(`  ${fmt(ms).padStart(8)}  ${name}`);
console.log(`  ${fmt(Date.now() - started).padStart(8)}  total`);
