import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { BuildReport, CiBuildParams } from "../src/contract";
import {
  CONFIG_ENV, DeployRefused, SECRETS_ENV, WRANGLER, bundleConfig, deployConfig, parseD1DatabaseIds, parseJsonc, systemD1Ids, validateRepoConfig, type DeploySpec,
} from "../src/deploy-config";
import {
  assertReportUrl, deployedOutput, deployVars, planSteps, report, reportBody, runPipeline, shQuote, validateParams,
  type CiLike, type DoStep, type FetchLike, type PlannedStep, type RunnerLike,
} from "../src/pipeline";

const COMMIT = "a".repeat(40);
const PLATFORM = "https://artyfact-platform.example.workers.dev";
const INGEST = "ingest-secret-value";
const NONCE = "0123456789abcdef0123456789abcdef";
const ACCOUNT = "acc";

const params = (over: Partial<CiBuildParams> = {}): CiBuildParams => ({
  buildId: "build.realization.1.aaaaaaa.ci", systemId: "system.peopling", realizationId: "realization.1", candidateId: "candidate.1.r1.aaaaaaa",
  namespace: "artyfact", repo: "peopling.app--r1", commit: COMMIT, kind: "preview", workerName: "peopling-app-r1",
  vars: { ARTYFACT_SYSTEM_ID: "system.peopling", ARTYFACT_PLATFORM_URL: PLATFORM, BUILD_ID: "dev", ARTYFACT_INGEST_TOKEN: INGEST },
  commands: { install: "npm ci", test: "npm test", build: "npm run build", deploy: "npx wrangler deploy" },
  reportUrl: `${PLATFORM}/api/systems/system.peopling/realizations/realization.1/builds`,
  ...over,
});

const REPO_CONFIG = `{
  "$schema": "node_modules/wrangler/config-schema.json", // editor hint
  "name": "peopling",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-12",
  /* static files */
  "assets": { "directory": "public", "binding": "ASSETS" },
  "durable_objects": { "bindings": [{ "name": "STORE", "class_name": "Store" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Store"] }],
  "vars": { "GREETING": "hi // not a comment" },
}`;
const spec = (text = REPO_CONFIG): DeploySpec => validateRepoConfig("wrangler.jsonc", text, { accountId: ACCOUNT });
const plan = (p = params()) => planSteps(p, { accountId: ACCOUNT, spec: spec(), nonce: NONCE });
const step = (steps: PlannedStep[], name: string) => steps.find((s) => s.name === name)!;
const shellSyntaxOk = (script: string) => execFileSync("sh", ["-n", "-c", script]);

describe("planSteps", () => {
  it("installs with a lockfile cache, tests, builds, bundles, then deploys; credentials only on deploy", () => {
    const steps = plan();
    expect(steps.map((s) => s.name)).toEqual(["install", "test", "build", "bundle", "deploy"]);
    expect(steps[0]).toMatchObject({ command: "npm ci", cache: { inputs: ["package.json", "package-lock.json"] } });
    expect(steps.filter((s) => s.cloudflareCredentials)).toEqual([expect.objectContaining({ name: "deploy", cloudflareCredentials: { accountId: ACCOUNT } })]);
    expect(step(steps, "test").config.retries.limit).toBe(0);
  });

  it("keeps the ingest token and platform secrets away from every step but deploy, and off the deploy command line", () => {
    const steps = plan();
    for (const s of steps.filter((x) => x.name !== "deploy")) {
      expect(JSON.stringify(s)).not.toContain(INGEST);
      expect(s.env?.[SECRETS_ENV]).toBeUndefined();
      expect(s.cloudflareCredentials).toBeUndefined();
    }
    for (const s of steps.filter((x) => ["install", "test", "build"].includes(x.name))) expect(s.env).toBeUndefined();
    const deploy = step(steps, "deploy");
    expect(JSON.parse(deploy.env![SECRETS_ENV]!)).toEqual({ ARTYFACT_INGEST_TOKEN: INGEST });
    expect(deploy.command).not.toContain(INGEST);
    expect(deploy.command).not.toContain("ARTYFACT_INGEST_TOKEN");
    expect(deploy.command).toContain(`--secrets-file "$C/secrets.json"`);
    expect(deployVars(params())).not.toHaveProperty("ARTYFACT_INGEST_TOKEN");
  });

  it("runs only the pinned image Wrangler, under a cleared environment, on platform-written configs", () => {
    const steps = plan();
    for (const name of ["bundle", "deploy"]) {
      const cmd = step(steps, name).command;
      expect(cmd).toContain(`/usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=`);
      expect(cmd).toContain(`${WRANGLER} deploy`);
      expect(cmd).toContain("--env-file=/dev/null --autoconfig=false");
      expect(cmd).toMatch(/^set -eu\nexport PATH=\/usr\/local\/bin:\/usr\/bin:\/bin\nunset NODE_OPTIONS/);
      expect(cmd).not.toMatch(/\bnpx\b|\bnpm\b|node_modules/);
      expect(cmd).not.toMatch(/--config '?\/workspace/);
      shellSyntaxOk(cmd);
    }
    expect(step(steps, "bundle").command).toContain(`--dry-run --config '/tmp/artyfact-${NONCE}'/wrangler.json --outdir '/workspace/.artyfact-build-${NONCE}'`);
    const deploy = step(steps, "deploy").command;
    expect(deploy).toContain("CLOUDFLARE_API_BASE_URL=https://api.cloudflare.com/client/v4");
    expect(deploy).toContain(`CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"`);
    expect(deploy).toContain(`[ -z "$(find '/workspace/.artyfact-build-${NONCE}' -type l -print -quit)" ]`);
    expect(deploy).toContain(`case "$A/" in /workspace/*)`);
    expect(JSON.parse(step(steps, "deploy").env![CONFIG_ENV]!)).toMatchObject({ no_bundle: true, main: `/workspace/.artyfact-build-${NONCE}/index.js` });
  });

  it("deploys under the worker name with a unique runtime build id and authoritative lineage vars", () => {
    const cmd = step(plan(params({ vars: { ARTYFACT_NOTE: "it's; rm -rf /", BUILD_ID: "dev" } })), "deploy").command;
    expect(cmd).toContain(`--name 'peopling-app-r1' --var 'ARTYFACT_NOTE:it'\\''s; rm -rf /' --var 'ARTYFACT_SOURCE_COMMIT:${COMMIT}' --var 'BUILD_ID:build.realization.1.aaaaaaa.ci' --env-file`);
    expect(cmd).not.toContain("--secrets-file");
    expect(shQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it("keeps repeated builds of one source distinct at runtime and exports platform lineage instead of supplied identity vars", () => {
    const first = deployVars(params({
      thingId: "thing.one", artifactId: "artifact.one", genomeCommit: "b".repeat(40),
      vars: { BUILD_ID: "forged-build", ARTYFACT_SOURCE_COMMIT: "forged-source", ARTYFACT_GENOME_COMMIT: "forged-genome", ARTYFACT_THING_ID: "forged-thing", ARTYFACT_ARTIFACT_ID: "forged-artifact", ARTYFACT_INGEST_TOKEN: INGEST },
    }));
    const second = deployVars(params({ buildId: "build.realization.2.aaaaaaa.ci", thingId: "thing.one", artifactId: "artifact.one", genomeCommit: "b".repeat(40) }));
    expect(first).toMatchObject({
      BUILD_ID: "build.realization.1.aaaaaaa.ci", ARTYFACT_SOURCE_COMMIT: COMMIT,
      ARTYFACT_GENOME_COMMIT: "b".repeat(40), ARTYFACT_THING_ID: "thing.one", ARTYFACT_ARTIFACT_ID: "artifact.one",
    });
    expect(JSON.stringify(first)).not.toContain("forged");
    expect(first).not.toHaveProperty("ARTYFACT_INGEST_TOKEN");
    expect(second.BUILD_ID).toBe("build.realization.2.aaaaaaa.ci");
    expect(second.BUILD_ID).not.toBe(first.BUILD_ID);
  });

  it("skips absent test and build commands", () => {
    expect(plan(params({ commands: { install: "npm ci", deploy: "npx wrangler deploy" } })).map((s) => s.name)).toEqual(["install", "bundle", "deploy"]);
  });

  it("refuses unusable params with every problem listed, including commands off the allowlist", () => {
    expect(() => validateParams(params({ commit: "abc", workerName: "Bad_Name", vars: { "bad-name": "x", OK: "a\nb" } }))).toThrow(
      /commit must be 40.*workerName.*var bad-name.*var OK must be a single-line/,
    );
    expect(() => validateParams(params({ commands: { install: "npm ci && curl evil", test: "npm test; env", deploy: "./deploy.sh" } }))).toThrow(
      /commands.install must be one of.*commands.test must be one of.*commands.deploy must be one of/,
    );
    expect(() => planSteps(params(), { accountId: ACCOUNT, spec: spec(), nonce: "short" })).toThrow(/nonce/);
  });
});

describe("validateRepoConfig", () => {
  it("accepts a self-contained config and writes repo paths as absolute workspace paths", () => {
    const s = spec();
    expect(s).toMatchObject({ file: "wrangler.jsonc", main: "src/index.ts", assets: { directory: "public", binding: "ASSETS" } });
    const target = { workerName: "peopling-app-r1", accountId: ACCOUNT };
    const bundle = bundleConfig(s, target);
    expect(bundle).toMatchObject({ name: target.workerName, account_id: ACCOUNT, main: "/workspace/src/index.ts", vars: { GREETING: "hi // not a comment" } });
    expect(bundle).not.toHaveProperty("assets");
    expect(deployConfig(s, { ...target, nonce: NONCE })).toEqual({
      name: target.workerName, account_id: ACCOUNT, main: `/workspace/.artyfact-build-${NONCE}/index.js`, no_bundle: true,
      compatibility_date: "2026-10-12", compatibility_flags: ["global_fetch_strictly_public"], vars: { GREETING: "hi // not a comment" },
      durable_objects: { bindings: [{ name: "STORE", class_name: "Store" }] }, migrations: [{ tag: "v1", new_sqlite_classes: ["Store"] }],
      assets: { directory: "/workspace/public", binding: "ASSETS" },
    });
  });

  describe("compatibility_flags", () => {
    const withFlags = (flags?: unknown) => JSON.stringify({ main: "src/index.ts", compatibility_date: "2026-10-12", ...(flags !== undefined && { compatibility_flags: flags }) });
    const target = { workerName: "peopling-app-r1", accountId: ACCOUNT };
    const generated = (text: string) => {
      const s = spec(text);
      return [bundleConfig(s, target).compatibility_flags, deployConfig(s, { ...target, nonce: NONCE }).compatibility_flags];
    };

    it("adds global_fetch_strictly_public when the repo sets no flags", () => {
      expect(generated(withFlags())).toEqual([["global_fetch_strictly_public"], ["global_fetch_strictly_public"]]);
    });
    it("merges with the repo's flags, keeping their order", () => {
      expect(generated(withFlags(["nodejs_compat"]))).toEqual([["nodejs_compat", "global_fetch_strictly_public"], ["nodejs_compat", "global_fetch_strictly_public"]]);
    });
    it("does not duplicate a flag the repo already lists", () => {
      const flags = ["global_fetch_strictly_public", "nodejs_compat"];
      expect(generated(withFlags(flags))).toEqual([flags, flags]);
    });
    it("refuses global_fetch_private_origin", () => {
      expect(() => spec(withFlags(["global_fetch_private_origin"]))).toThrow(/compatibility_flags lists global_fetch_private_origin/);
    });
  });

  it("refuses build.command with a clear reason", () => {
    const text = JSON.stringify({ main: "src/index.ts", compatibility_date: "2026-10-12", build: { command: "npm run build" } });
    expect(() => spec(text)).toThrow(/refusing to deploy wrangler.jsonc: build.command is set: artyfact CI never runs a Wrangler custom build/);
  });

  it("refuses keys that reach outside the repo or the preview Worker", () => {
    const text = JSON.stringify({
      main: "/proc/self/environ", compatibility_date: "2026-10-12", account_id: "other",
      assets: { directory: "../../etc" }, rules: [{ type: "Text", globs: ["**/environ"] }],
      services: [{ binding: "P", service: "artyfact-platform" }],
      durable_objects: { bindings: [{ name: "SA", class_name: "SystemAuthority", script_name: "artyfact-platform" }] },
      vars: { ARTYFACT_INGEST_TOKEN: "x" }, made_up: 1,
    });
    let message = "";
    try {
      spec(text);
    } catch (e) {
      message = (e as Error).message;
    }
    for (const bit of [
      "rules is not supported", "services is not supported", "made_up is not supported",
      "account_id names another account", "main must be a path inside the repo", "assets.directory must be a path inside the repo",
      "durable_objects SA binds another Worker's class", "vars.ARTYFACT_INGEST_TOKEN is set by the platform",
    ]) expect(message).toContain(bit);
    expect(() => validateRepoConfig("wrangler.toml", 'main = "x"', { accountId: ACCOUNT })).toThrow(/wrangler.json or wrangler.jsonc only/);
    expect(() => spec("{ nope")).toThrow(/not valid JSON/);
  });

  const d1Config = (database_id?: string) => JSON.stringify({
    main: "src/index.ts", compatibility_date: "2026-10-12",
    d1_databases: [{ binding: "DB", database_name: "peopling", ...(database_id !== undefined && { database_id }), migrations_dir: "migrations" }],
  });
  const REAL_ID = "11111111-2222-3333-4444-555555555555";
  const MAPPED_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const d1Target = { workerName: "peopling-app-r1", accountId: ACCOUNT };
  const withIds = (text: string, ids: Record<string, string>) => validateRepoConfig("wrangler.jsonc", text, { accountId: ACCOUNT, d1DatabaseIds: ids });

  it("substitutes the platform's D1 id for a placeholder or missing database_id", () => {
    for (const id of ["00000000-0000-0000-0000-000000000000", undefined]) {
      const s = withIds(d1Config(id), { "peopling": MAPPED_ID });
      const d1 = [{ binding: "DB", database_name: "peopling", database_id: MAPPED_ID, migrations_dir: "migrations" }];
      expect(deployConfig(s, { ...d1Target, nonce: NONCE })).toMatchObject({ d1_databases: d1 });
      expect(bundleConfig(s, d1Target)).toMatchObject({ d1_databases: d1 });
    }
  });

  it("refuses a placeholder database_id whose database_name has no mapping", () => {
    expect(() => withIds(d1Config("00000000-0000-0000-0000-000000000000"), { other: MAPPED_ID }))
      .toThrow(/d1_databases DB: no account database is mapped to database_name "peopling".*D1_DATABASE_IDS/);
    expect(() => spec(d1Config(undefined))).toThrow(/no account database is mapped/);
    expect(() => withIds(d1Config(undefined), {})).toThrow(DeployRefused);
    expect(() => spec(JSON.stringify({ main: "src/index.ts", d1_databases: { binding: "DB" } }))).toThrow(/d1_databases must be a list/);
    expect(() => spec(JSON.stringify({ main: "src/index.ts", d1_databases: [{ binding: "DB" }] }))).toThrow(/needs binding and database_name/);
  });

  it("accepts a real database_id only when it is this System's mapped id", () => {
    const s = withIds(d1Config(MAPPED_ID), { "peopling": MAPPED_ID });
    expect(deployConfig(s, { ...d1Target, nonce: NONCE })).toMatchObject({ d1_databases: [{ database_id: MAPPED_ID }] });
    expect(() => withIds(d1Config(REAL_ID), { "peopling": MAPPED_ID })).toThrow(/database_id is not this System's "peopling" database/);
    expect(() => spec(d1Config(REAL_ID))).toThrow(/no account database is mapped to database_name "peopling" for this System/);
  });

  it("parses D1_DATABASE_IDS per System and picks only the build's System", () => {
    const raw = { "system.a": { a: MAPPED_ID, b: 3, c: "00000000-0000-0000-0000-000000000000" }, "system.b": { b: REAL_ID }, junk: "x" };
    const all = parseD1DatabaseIds(raw);
    expect(all).toEqual({ "system.a": { a: MAPPED_ID }, "system.b": { b: REAL_ID } });
    expect(parseD1DatabaseIds(JSON.stringify(raw))).toEqual(all);
    expect(systemD1Ids(all, "system.a")).toEqual({ a: MAPPED_ID });
    expect(systemD1Ids(all, "system.c")).toEqual({});
    expect(systemD1Ids(all, "__proto__")).toEqual({});
    expect(systemD1Ids(undefined, "system.a")).toEqual({});
    for (const bad of [undefined, null, "not json", "[1]", ["x"], 7]) expect(parseD1DatabaseIds(bad)).toEqual({});
    // Another System's database cannot be bound by name.
    expect(() => withIds(d1Config(undefined), systemD1Ids(all, "system.b"))).toThrow(/no account database is mapped/);
  });

  it("refuses migrations that transfer another Worker's Durable Object state", () => {
    const base = { main: "src/index.ts", compatibility_date: "2026-10-12" };
    const transfer = { ...base, migrations: [{ tag: "v2", transferred_classes: [{ from: "SystemAuthority", from_script: "artyfact-platform", to: "X" }] }] };
    expect(() => spec(JSON.stringify(transfer))).toThrow(/migration v2: transferred_classes is not supported/);
    const rename = { ...base, migrations: [{ tag: "v3", renamed_classes: [{ from: "SystemAuthority", to: "X", from_script: "artyfact-platform" }] }] };
    expect(() => spec(JSON.stringify(rename))).toThrow(/migration v3: from_script pulls another Worker's Durable Object state/);
    const ok = { ...base, migrations: [{ tag: "v1", new_sqlite_classes: ["A"] }, { tag: "v2", renamed_classes: [{ from: "A", to: "B" }], deleted_classes: ["C"] }] };
    expect(() => spec(JSON.stringify(ok))).not.toThrow();
  });

  it("refuses workflows (their names are account-wide)", () => {
    const text = JSON.stringify({ main: "src/index.ts", compatibility_date: "2026-10-12", workflows: [{ name: "artyfact-ci", binding: "W", class_name: "C" }] });
    expect(() => spec(text)).toThrow(/workflows is not supported \(Workflow names are account-wide/);
  });

  it("parses JSONC comments and trailing commas without touching strings", () => {
    expect(parseJsonc('{ "a": "x // y /* z */", /* c */ "b": [1, 2,], // d\n }')).toEqual({ a: "x // y /* z */", b: [1, 2] });
    expect(parseJsonc('{ "q": "say \\"hi\\" // ok" }')).toEqual({ q: 'say "hi" // ok' });
  });
});

describe("reportBody", () => {
  it("carries the build row id, kind and commit; runtime buildId and url only when passed", () => {
    expect(reportBody(params(), "running", { externalId: "inst", startedAt: "t0" })).toEqual({
      id: "build.realization.1.aaaaaaa.ci", status: "running", kind: "preview", commit: COMMIT, externalId: "inst", startedAt: "t0",
    });
    expect(reportBody(params({ kind: "production", deploymentId: "deploy.1" }), "passed", { url: "https://x.workers.dev" })).toMatchObject({
      status: "passed", kind: "production", buildId: "build.realization.1.aaaaaaa.ci", url: "https://x.workers.dev", deploymentId: "deploy.1",
    });
    const failed = reportBody(params(), "failed", { url: "https://x", error: "e".repeat(5000) });
    expect(failed.url).toBeUndefined();
    expect(failed.buildId).toBeUndefined();
    expect(failed.error!.length).toBe(4000);
  });
});

describe("report", () => {
  it("posts JSON with the CI bearer and throws on a non-2xx answer", async () => {
    const seen: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const ok: FetchLike = async (url, init) => (seen.push({ url, init }), { ok: true, status: 200, text: async () => "{}" });
    await report(ok, { reportUrl: params().reportUrl, platformUrl: PLATFORM, token: "tok" }, reportBody(params(), "running"));
    expect(seen[0]!.url).toBe(params().reportUrl);
    expect(seen[0]!.init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(seen[0]!.init.body)).toMatchObject({ status: "running", commit: COMMIT });
    const bad: FetchLike = async () => ({ ok: false, status: 403, text: async () => "forbidden" });
    await expect(report(bad, { reportUrl: params().reportUrl, platformUrl: PLATFORM, token: "tok" }, reportBody(params(), "running"))).rejects.toThrow(/403/);
  });

  it("never sends the token outside the platform origin or over plain http", () => {
    expect(() => assertReportUrl("https://evil.example/api", PLATFORM)).toThrow(/not the platform/);
    expect(() => assertReportUrl("http://p.example/api", "http://p.example")).toThrow(/https/);
    expect(assertReportUrl("http://localhost:1337/api/x", "http://localhost:1337").pathname).toBe("/api/x");
  });
});

// ---------------------------------------------------------------- runPipeline with fakes

function harness(opts: { failAt?: string; throwPlain?: boolean; reportStatus?: number; files?: Record<string, string>; deployStdout?: string } = {}) {
  const stepNames: string[] = [];
  const step: DoStep = async (name, fn) => (stepNames.push(name), fn());
  const ran: PlannedStep[] = [];
  const runnerFor = (logs?: RunnerLike["logs"]): RunnerLike => ({
    exitCode: 0,
    ...(logs && { logs }),
    runner: async (s) => run(s),
  });
  const run = async (s: PlannedStep): Promise<RunnerLike> => {
    ran.push(s);
    if (s.name === opts.failAt) {
      if (opts.throwPlain) throw new Error("sandbox unavailable");
      throw Object.assign(new Error(`${s.name} failed: exit code 1`), { name: "CiRunnerFailure", runner: { name: s.name } });
    }
    return runnerFor(s.name === "deploy" && opts.deployStdout ? { stdout: opts.deployStdout } : undefined);
  };
  const ci: CiLike = { runner: run };
  const reports: BuildReport[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    reports.push(JSON.parse(init.body) as BuildReport);
    return { ok: (opts.reportStatus ?? 200) < 300, status: opts.reportStatus ?? 200, text: async () => "" };
  };
  const files = opts.files ?? { "wrangler.jsonc": REPO_CONFIG };
  const readFile = async (path: string) => files[path] ?? null;
  const input = { instanceId: "inst-1", step, ci, fetch: fetchFn, readFile, reportToken: "tok", platformUrl: PLATFORM, workersSubdomain: "dawka", accountId: ACCOUNT };
  return { stepNames, ran, reports, input };
}

describe("runPipeline", () => {
  it("reports a passed deployment with an exact Worker version locator from deploy stdout", async () => {
    const h = harness();
    const out = await runPipeline({ ...h.input, params: params() });
    expect(h.ran.map((s) => s.name)).toEqual(["install", "test", "build", "bundle", "deploy"]);
    expect(h.reports.map((r) => r.status)).toEqual(["running", "passed"]);
    expect(out).toMatchObject({ status: "passed", url: "https://peopling-app-r1.dawka.workers.dev", buildId: "build.realization.1.aaaaaaa.ci", externalId: "inst-1" });
    expect(out.output).toBeUndefined();
    expect(out.logsUrl).toBe("https://dash.cloudflare.com/acc/workers/workflows/artyfact-ci/instance/inst-1");
    expect(out.steps!.map((s) => [s.name, s.status])).toEqual([
      ["config", "passed"], ["install", "passed"], ["test", "passed"], ["build", "passed"], ["bundle", "passed"], ["deploy", "passed"],
    ]);
    // Each report, the config read and the nonce are durable steps of their own.
    expect(h.stepNames).toEqual(expect.arrayContaining(["report running", "read wrangler config", "bundle nonce", "report passed"]));
    expect(JSON.stringify(h.reports)).not.toContain(INGEST);
    expect(h.ran.find((s) => s.name === "deploy")!.command).toContain("--var 'BUILD_ID:build.realization.1.aaaaaaa.ci'");
  });

  it("records the exact deployed Worker version and leaves output unknown when Wrangler does not establish one", async () => {
    const version = "01234567-89ab-cdef-0123-456789abcdef";
    const withVersion = harness({ deployStdout: `Uploaded peopling-app-r1\nCurrent Version ID: ${version}\n` });
    const out = await runPipeline({ ...withVersion.input, params: params() });
    expect(out.output).toEqual({ locator: `cloudflare:workers:accounts/${ACCOUNT}/workers/peopling-app-r1/versions/${version}` });

    const unknown = harness({ deployStdout: "Deployed to https://peopling-app-r1.dawka.workers.dev" });
    const unknownOut = await runPipeline({ ...unknown.input, params: params() });
    expect(unknownOut.output).toBeUndefined();
  });

  it("keeps two builds of the same source distinct in runtime and realized output identity", async () => {
    const first = await runPipeline({ ...harness({ deployStdout: "Current Version ID: 11111111-1111-1111-1111-111111111111" }).input, params: params() });
    const second = await runPipeline({
      ...harness({ deployStdout: "Current Version ID: 22222222-2222-2222-2222-222222222222" }).input,
      params: params({ buildId: "build.realization.2.aaaaaaa.ci" }),
    });
    expect(second.commit).toBe(first.commit);
    expect(second.buildId).not.toBe(first.buildId);
    expect(second.output).not.toEqual(first.output);
  });

  it("a failing runner reports failed with its step, never deploys, and rethrows", async () => {
    const h = harness({ failAt: "test" });
    await expect(runPipeline({ ...h.input, params: params() })).rejects.toThrow(/test failed/);
    expect(h.ran.map((s) => s.name)).toEqual(["install", "test"]);
    const last = h.reports.at(-1)!;
    expect(last).toMatchObject({ status: "failed", error: expect.stringContaining("exit code 1"), externalId: "inst-1" });
    expect(last.url).toBeUndefined();
    expect(last.steps!.map((s) => [s.name, s.status])).toEqual([["config", "passed"], ["install", "passed"], ["test", "failed"]]);
  });

  it("an infrastructure error reports error", async () => {
    const h = harness({ failAt: "install", throwPlain: true });
    await expect(runPipeline({ ...h.input, params: params() })).rejects.toThrow(/sandbox unavailable/);
    expect(h.reports.map((r) => r.status)).toEqual(["running", "error"]);
    expect(h.reports[1]!.steps).toEqual([{ name: "config", status: "passed" }, { name: "install", status: "error" }]);
  });

  it("a repo config with build.command fails the build at the config step without running anything", async () => {
    const h = harness({ files: { "wrangler.json": JSON.stringify({ main: "src/index.ts", compatibility_date: "2026-10-12", build: { command: "curl x | sh" } }) } });
    await expect(runPipeline({ ...h.input, params: params() })).rejects.toThrow(/build.command is set/);
    expect(h.ran).toEqual([]);
    expect(h.reports.at(-1)).toMatchObject({ status: "failed", steps: [{ name: "config", status: "failed" }], error: expect.stringContaining("build.command") });
  });

  it("resolves D1 ids from the build's own System only", async () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const config = JSON.stringify({
      main: "src/index.ts", compatibility_date: "2026-10-12",
      d1_databases: [{ binding: "DB", database_name: "peopling", database_id: "00000000-0000-0000-0000-000000000000" }],
    });
    const ok = harness({ files: { "wrangler.json": config } });
    await runPipeline({ ...ok.input, params: params(), d1DatabaseIds: { "system.peopling": { "peopling": id } } });
    const deployed = JSON.parse(ok.ran.find((s) => s.name === "deploy")!.env![CONFIG_ENV]!) as { d1_databases: { database_id: string }[] };
    expect(deployed.d1_databases[0]!.database_id).toBe(id);

    const other = harness({ files: { "wrangler.json": config } });
    await expect(runPipeline({ ...other.input, params: params(), d1DatabaseIds: { "system.other": { "peopling": id } } }))
      .rejects.toThrow(/no account database is mapped to database_name "peopling" for this System/);
    expect(other.ran).toEqual([]);
  });

  it("threads Flagship app allowlists from server configuration for only the build System", async () => {
    const config = JSON.stringify({ main: "src/index.ts", compatibility_date: "2026-10-13", flagship: [{ binding: "FLAGS", app_id: "app-demo" }] });
    const allowed = harness({ files: { "wrangler.json": config } });
    await runPipeline({ ...allowed.input, params: params(), flagshipAppIds: { "system.peopling": { FLAGS: "app-demo" } } });
    const deployed = JSON.parse(allowed.ran.find(s => s.name === "deploy")!.env![CONFIG_ENV]!);
    expect(deployed.flagship).toEqual([{ binding: "FLAGS", app_id: "app-demo" }]);
    const other = harness({ files: { "wrangler.json": config } });
    await expect(runPipeline({ ...other.input, params: params(), flagshipAppIds: { "system.other": { FLAGS: "app-demo" } } })).rejects.toThrow(/not configured for this System/);
    expect(other.ran).toEqual([]);
  });

  it("a commit without a Wrangler config fails at the config step", async () => {
    const h = harness({ files: {} });
    await expect(runPipeline({ ...h.input, params: params() })).rejects.toThrow(/no wrangler.json/);
    expect(h.ran).toEqual([]);
    expect(h.reports.at(-1)).toMatchObject({ status: "failed", steps: [{ name: "config", status: "failed" }] });
  });

  it("invalid params report error without running anything", async () => {
    const h = harness();
    await expect(runPipeline({ ...h.input, params: params({ commit: "nope" }) })).rejects.toThrow(/invalid CI params/);
    expect(h.ran).toEqual([]);
    expect(h.reports).toEqual([expect.objectContaining({ status: "error", error: expect.stringContaining("commit") })]);
  });

  it("a reportUrl outside the platform stops before any report or runner", async () => {
    const h = harness();
    await expect(runPipeline({ ...h.input, params: params({ reportUrl: "https://evil.example/x" }) })).rejects.toThrow(/not the platform/);
    expect(h.reports).toEqual([]);
    expect(h.ran).toEqual([]);
  });
});


describe("bounded deployed output logs", () => {
  const version = "11111111-1111-1111-1111-111111111111";
  const runner = (stdout: string | ReadableStream<Uint8Array>) => ({ exitCode: 0, logs: { stdout }, runner: async () => { throw new Error("unused"); } });
  it("ignores identifiers beyond the byte cap in a single oversized chunk", async () => {
    const bytes = new TextEncoder().encode("x".repeat(128 * 1024) + `\nCurrent Version ID: ${version}\n`);
    const stdout = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
    expect(await deployedOutput(params(), ACCOUNT, runner(stdout))).toBeUndefined();
  });
  it("caps string logs by UTF-8 bytes, rather than characters", async () => {
    const stdout = "é".repeat(70 * 1024) + `\nCurrent Version ID: ${version}\n`;
    expect(await deployedOutput(params(), ACCOUNT, runner(stdout))).toBeUndefined();
  });
  it("does not identify an incomplete line truncated at the cap", async () => {
    const line = `Current Version ID: ${version}`;
    const stdout = "x".repeat(128 * 1024 - line.length - 1) + `\n${line}` + "extra\n";
    expect(await deployedOutput(params(), ACCOUNT, runner(stdout))).toBeUndefined();
  });
  it("reads version identifiers split across stream chunks", async () => {
    const stdout = new ReadableStream<Uint8Array>({ start(c) {
      for (const piece of [`Current Version ID: ${version.slice(0, 15)}`, `${version.slice(15)}\n`]) c.enqueue(new TextEncoder().encode(piece));
      c.close();
    } });
    expect(await deployedOutput(params(), ACCOUNT, runner(stdout))).toEqual({ locator: workerVersionLocatorForTest() });
    function workerVersionLocatorForTest() { return `cloudflare:workers:accounts/${ACCOUNT}/workers/${params().workerName}/versions/${version}`; }
  });
});
