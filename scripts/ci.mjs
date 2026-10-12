#!/usr/bin/env node
// The single CI definition: .github/workflows/ci.yml and .githooks/pre-push both run this script.
//   npm run ci                full run (platform and site jobs)
//   npm run ci -- --changed   only the jobs affected by the commits being pushed
//   --base <ref>              compare against <ref> instead of the upstream or origin/main
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";

const changedOnly = process.argv.includes("--changed");
const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

/** Files changed by the commits a push would send, against the upstream or origin/main. null when no base exists. */
function changedFiles() {
  const i = process.argv.indexOf("--base");
  const explicit = i > 0 ? process.argv[i + 1] : null;
  const upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  for (const base of explicit ? [explicit] : [upstream, "origin/main"].filter(Boolean)) {
    const mergeBase = git("merge-base", "HEAD", base);
    if (!mergeBase) continue;
    const files = git("diff", "--name-only", `${mergeBase}..HEAD`);
    if (files !== null) return files.split("\n").filter(Boolean);
  }
  return null;
}

const isDoc = (f) => /\.(md|mdx|txt)$/i.test(f) || f.startsWith("docs/") || f.startsWith("licenses/") || f === "LICENSE";
// Site job inputs: apps/site, packages/effects, packages/cli, the lockfile, and this script and workflow.
const isSite = (f) =>
  f.startsWith("apps/site/") ||
  f.startsWith("packages/effects/") ||
  f.startsWith("packages/cli/") ||
  f === "package-lock.json" ||
  f.startsWith("scripts/ci") ||
  f === ".github/workflows/ci.yml";
// Every other code change runs the platform job (the root typecheck and tests also cover effects and cli).
const isSiteOnly = (f) => f.startsWith("apps/site/");

let platform = true;
let site = true;
if (changedOnly) {
  const files = changedFiles();
  if (files === null) {
    console.log("ci: no base to compare with, running everything");
  } else {
    const code = files.filter((f) => !isDoc(f));
    site = code.some(isSite);
    platform = code.some((f) => !isSiteOnly(f));
    console.log(`ci: ${files.length} changed file(s): platform ${platform ? "run" : "skip"}, site ${site ? "run" : "skip"}`);
    if (!platform && !site) {
      console.log("ci: no code changes, nothing to run");
      process.exit(0);
    }
  }
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

const steps = [];
if (platform) {
  steps.push(
    ["platform: typecheck", "npm run typecheck"],
    ["platform: unit tests", "npm test"],
    ["platform: build", "npm run build -w @artyfact/platform"],
    ["platform: e2e (fixture)", "npm run e2e"],
  );
}
if (site) {
  steps.push(
    ["site: typecheck", "npm run typecheck -w @artyfact/site"],
    ["site: unit tests", "npm run test -w @artyfact/site"],
    ["site: build", "npm run build -w @artyfact/site"],
    ["site: test:build", "npm run test:build -w @artyfact/site"],
    ["site: e2e", "npm run e2e -w @artyfact/site"],
  );
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
