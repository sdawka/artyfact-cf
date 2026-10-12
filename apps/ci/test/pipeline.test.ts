import { describe, expect, it } from "vitest";
import type { BuildReport, CiBuildParams } from "../src/contract";
import {
  assertReportUrl, deployCommand, planSteps, report, reportBody, runPipeline, shQuote, validateParams,
  type CiLike, type DoStep, type FetchLike, type PlannedStep, type RunnerLike,
} from "../src/pipeline";

const COMMIT = "a".repeat(40);
const PLATFORM = "https://artyfact-platform.example.workers.dev";

const params = (over: Partial<CiBuildParams> = {}): CiBuildParams => ({
  buildId: "build.realization.1.aaaaaaa.ci", systemId: "system.keep-in-touch", realizationId: "realization.1", candidateId: "candidate.1.r1.aaaaaaa",
  namespace: "artyfact", repo: "keep-in-touch.app--r1", commit: COMMIT, kind: "preview", workerName: "keep-in-touch-app-r1",
  vars: { ARTYFACT_SYSTEM_ID: "system.keep-in-touch", ARTYFACT_PLATFORM_URL: PLATFORM, BUILD_ID: "dev" },
  commands: { install: "npm ci", test: "npm test", build: "npm run build", deploy: "npx wrangler deploy" },
  reportUrl: `${PLATFORM}/api/systems/system.keep-in-touch/realizations/realization.1/builds`,
  ...over,
});

describe("planSteps", () => {
  it("installs with a lockfile cache, tests, builds, then deploys with credentials only on deploy", () => {
    const steps = planSteps(params(), { accountId: "acc" });
    expect(steps.map((s) => s.name)).toEqual(["install", "test", "build", "deploy"]);
    expect(steps[0]).toMatchObject({ command: "npm ci", cache: { inputs: ["package.json", "package-lock.json"] } });
    expect(steps.filter((s) => s.cloudflareCredentials)).toEqual([expect.objectContaining({ name: "deploy", cloudflareCredentials: { accountId: "acc" } })]);
    expect(steps.find((s) => s.name === "test")!.config.retries.limit).toBe(0);
  });

  it("skips absent test and build commands", () => {
    const steps = planSteps(params({ commands: { install: "npm ci", deploy: "npx wrangler deploy", test: " " } }));
    expect(steps.map((s) => s.name)).toEqual(["install", "deploy"]);
    expect(steps[1]!.cloudflareCredentials).toBe(true);
  });

  it("deploys under the worker name with BUILD_ID forced to the commit, every var quoted", () => {
    const cmd = deployCommand(params({ vars: { ARTYFACT_NOTE: "it's; rm -rf /", BUILD_ID: "dev" } }));
    expect(cmd).toBe(`npx wrangler deploy --name 'keep-in-touch-app-r1' --var 'ARTYFACT_NOTE:it'\\''s; rm -rf /' --var 'BUILD_ID:${COMMIT}'`);
    expect(shQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it("refuses unusable params with every problem listed", () => {
    expect(() => validateParams(params({ commit: "abc", workerName: "Bad_Name", vars: { "bad-name": "x", OK: "a\nb" } }))).toThrow(
      /commit must be 40.*workerName.*var bad-name.*var OK must be a single-line/,
    );
    expect(() => planSteps(params({ commands: { install: "", deploy: "" } }))).toThrow(/commands.install/);
  });
});

describe("reportBody", () => {
  it("carries the build row id, kind and commit; buildId and url only when passed", () => {
    expect(reportBody(params(), "running", { externalId: "inst", startedAt: "t0" })).toEqual({
      id: "build.realization.1.aaaaaaa.ci", status: "running", kind: "preview", commit: COMMIT, externalId: "inst", startedAt: "t0",
    });
    expect(reportBody(params({ kind: "production", deploymentId: "deploy.1" }), "passed", { url: "https://x.workers.dev" })).toMatchObject({
      status: "passed", kind: "production", buildId: COMMIT, url: "https://x.workers.dev", deploymentId: "deploy.1",
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

function harness(opts: { failAt?: string; throwPlain?: boolean; reportStatus?: number } = {}) {
  const stepNames: string[] = [];
  const step: DoStep = async (name, fn) => (stepNames.push(name), fn());
  const ran: PlannedStep[] = [];
  const runnerFor = (): RunnerLike => ({
    exitCode: 0,
    runner: async (s) => run(s),
  });
  const run = async (s: PlannedStep): Promise<RunnerLike> => {
    ran.push(s);
    if (s.name === opts.failAt) {
      if (opts.throwPlain) throw new Error("sandbox unavailable");
      throw Object.assign(new Error(`${s.name} failed: exit code 1`), { name: "CiRunnerFailure", runner: { name: s.name } });
    }
    return runnerFor();
  };
  const ci: CiLike = { runner: run };
  const reports: BuildReport[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    reports.push(JSON.parse(init.body) as BuildReport);
    return { ok: (opts.reportStatus ?? 200) < 300, status: opts.reportStatus ?? 200, text: async () => "" };
  };
  const input = { instanceId: "inst-1", step, ci, fetch: fetchFn, reportToken: "tok", platformUrl: PLATFORM, workersSubdomain: "dawka", accountId: "acc" };
  return { stepNames, ran, reports, input };
}

describe("runPipeline", () => {
  it("reports running, runs every runner chained, then reports passed with the workers.dev URL", async () => {
    const h = harness();
    const out = await runPipeline({ ...h.input, params: params() });
    expect(h.ran.map((s) => s.name)).toEqual(["install", "test", "build", "deploy"]);
    expect(h.reports.map((r) => r.status)).toEqual(["running", "passed"]);
    expect(out).toMatchObject({ status: "passed", url: "https://keep-in-touch-app-r1.dawka.workers.dev", buildId: COMMIT, externalId: "inst-1" });
    expect(out.logsUrl).toBe("https://dash.cloudflare.com/acc/workers/workflows/artyfact-ci/instance/inst-1");
    expect(out.steps!.map((s) => [s.name, s.status])).toEqual([["install", "passed"], ["test", "passed"], ["build", "passed"], ["deploy", "passed"]]);
    // Each report is a durable step of its own.
    expect(h.stepNames).toEqual(expect.arrayContaining(["report running", "report passed"]));
    expect(h.ran.find((s) => s.name === "deploy")!.command).toContain(`--var 'BUILD_ID:${COMMIT}'`);
  });

  it("a failing runner reports failed with its step, never deploys, and rethrows", async () => {
    const h = harness({ failAt: "test" });
    await expect(runPipeline({ ...h.input, params: params() })).rejects.toThrow(/test failed/);
    expect(h.ran.map((s) => s.name)).toEqual(["install", "test"]);
    const last = h.reports.at(-1)!;
    expect(last).toMatchObject({ status: "failed", error: expect.stringContaining("exit code 1"), externalId: "inst-1" });
    expect(last.url).toBeUndefined();
    expect(last.steps!.map((s) => [s.name, s.status])).toEqual([["install", "passed"], ["test", "failed"]]);
  });

  it("an infrastructure error reports error", async () => {
    const h = harness({ failAt: "install", throwPlain: true });
    await expect(runPipeline({ ...h.input, params: params() })).rejects.toThrow(/sandbox unavailable/);
    expect(h.reports.map((r) => r.status)).toEqual(["running", "error"]);
    expect(h.reports[1]!.steps).toEqual([{ name: "install", status: "error" }]);
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
