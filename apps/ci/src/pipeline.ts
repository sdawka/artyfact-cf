/**
 * The artyfact CI pipeline as plain functions: which runners to start, what to report, and the run itself over
 * injected `step`, `ci` and `fetch`. `src/index.ts` wires these to `@cloudflare/ci`; tests drive them with fakes.
 */
import type { BuildReport, BuildStatus, BuildStep, CiBuildParams } from "./contract";

const COMMIT_RE = /^[0-9a-f]{40}$/;
/** Worker script names: lowercase alphanumerics and dashes, at most 63 characters, no leading or trailing dash. */
const WORKER_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const ERROR_MAX = 4000;

export type StepName = "install" | "test" | "build" | "deploy";

/** One `ci.runner()` call. Field names match `@cloudflare/ci` RunnerOptions. */
export interface PlannedStep {
  name: StepName;
  command: string;
  cache?: { inputs: string[] };
  config: { retries: { limit: number; delay: number; backoff?: "constant" | "linear" | "exponential" } };
  cloudflareCredentials?: true | { accountId: string };
}

/** Throws with every problem when `p` is not a usable {@link CiBuildParams}. */
export function validateParams(p: CiBuildParams): void {
  const problems: string[] = [];
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!p || typeof p !== "object") throw new Error("params must be an object");
  for (const k of ["buildId", "systemId", "namespace", "repo", "reportUrl"] as const) if (!nonEmpty(p[k])) problems.push(`${k} is required`);
  if (typeof p.commit !== "string" || !COMMIT_RE.test(p.commit)) problems.push("commit must be 40 lowercase hex");
  if (p.kind !== "preview" && p.kind !== "production") problems.push("kind must be preview or production");
  if (typeof p.workerName !== "string" || !WORKER_NAME_RE.test(p.workerName)) problems.push("workerName must be a Worker script name");
  if (!p.commands || !nonEmpty(p.commands.install) || !nonEmpty(p.commands.deploy)) problems.push("commands.install and commands.deploy are required");
  for (const k of ["test", "build"] as const) {
    if (p.commands?.[k] !== undefined && typeof p.commands[k] !== "string") problems.push(`commands.${k} must be a string`);
  }
  for (const [k, v] of Object.entries(p.vars ?? {})) {
    if (!VAR_NAME_RE.test(k)) problems.push(`var ${k} is not an UPPER_SNAKE name`);
    if (typeof v !== "string" || /[\0\r\n]/.test(v)) problems.push(`var ${k} must be a single-line string`);
  }
  if (problems.length) throw new Error(`invalid CI params: ${problems.join("; ")}`);
}

/** POSIX single-quoting: the value reaches the command verbatim. */
export const shQuote = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

/** `--var` flags for the deploy; `BUILD_ID` is always the commit, whatever `vars` says. */
export function deployVars(p: CiBuildParams): Record<string, string> {
  return { ...p.vars, BUILD_ID: p.commit };
}

export function deployCommand(p: CiBuildParams): string {
  const vars = Object.entries(deployVars(p)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `--var ${shQuote(`${k}:${v}`)}`);
  return [p.commands.deploy.trim(), "--name", shQuote(p.workerName), ...vars].join(" ");
}

/**
 * install (cached on the lockfile) → test → build → deploy (the only step that sees Cloudflare credentials).
 * Test and build failures are deterministic and not retried; install and deploy retry once.
 */
export function planSteps(p: CiBuildParams, opts: { accountId?: string } = {}): PlannedStep[] {
  validateParams(p);
  const once = { retries: { limit: 1, delay: 10_000, backoff: "constant" as const } };
  const never = { retries: { limit: 0, delay: 1_000 } };
  const steps: PlannedStep[] = [
    { name: "install", command: p.commands.install.trim(), cache: { inputs: ["package.json", "package-lock.json"] }, config: once },
  ];
  if (p.commands.test?.trim()) steps.push({ name: "test", command: p.commands.test.trim(), config: never });
  if (p.commands.build?.trim()) steps.push({ name: "build", command: p.commands.build.trim(), config: never });
  steps.push({ name: "deploy", command: deployCommand(p), config: once, cloudflareCredentials: opts.accountId ? { accountId: opts.accountId } : true });
  return steps;
}

export const workerUrl = (workerName: string, subdomain: string) => `https://${workerName}.${subdomain}.workers.dev`;

/** The Workflows dashboard page of one instance. */
export const instanceLogsUrl = (accountId: string, workflow: string, instanceId: string) =>
  `https://dash.cloudflare.com/${accountId}/workers/workflows/${workflow}/instance/${encodeURIComponent(instanceId)}`;

export interface ReportExtra {
  url?: string;
  steps?: BuildStep[];
  error?: string;
  externalId?: string;
  logsUrl?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** The {@link BuildReport} for one status change of the build `p.buildId`. */
export function reportBody(p: CiBuildParams, status: BuildStatus, extra: ReportExtra = {}): BuildReport {
  const body: BuildReport = { id: p.buildId, status, kind: p.kind, commit: p.commit };
  if (status === "passed") body.buildId = p.commit;
  if (extra.url && status === "passed") body.url = extra.url;
  if (p.deploymentId) body.deploymentId = p.deploymentId;
  if (extra.externalId) body.externalId = extra.externalId;
  if (extra.logsUrl) body.logsUrl = extra.logsUrl;
  if (extra.steps?.length) body.steps = extra.steps;
  if (extra.error) body.error = extra.error.length > ERROR_MAX ? `${extra.error.slice(0, ERROR_MAX - 1)}…` : extra.error;
  if (extra.startedAt) body.startedAt = extra.startedAt;
  if (extra.finishedAt) body.finishedAt = extra.finishedAt;
  return body;
}

/** `reportUrl` must sit under `platformUrl` (same origin): the report token is never sent anywhere else. */
export function assertReportUrl(reportUrl: string, platformUrl: string): URL {
  let url: URL, base: URL;
  try {
    url = new URL(reportUrl);
    base = new URL(platformUrl);
  } catch {
    throw new Error(`reportUrl ${reportUrl} or PLATFORM_URL ${platformUrl} is not a URL`);
  }
  if (url.origin !== base.origin) throw new Error(`reportUrl ${url.origin} is not the platform (${base.origin})`);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("reportUrl must be https");
  return url;
}

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** POST one report with the CI bearer; a non-2xx answer throws (so the Workflow step retries). */
export async function report(fetchFn: FetchLike, opts: { reportUrl: string; platformUrl: string; token: string }, body: BuildReport): Promise<{ status: number }> {
  const url = assertReportUrl(opts.reportUrl, opts.platformUrl);
  if (!opts.token) throw new Error("CI_REPORT_TOKEN is not configured");
  const res = await fetchFn(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`report ${body.status} for ${body.id} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return { status: res.status };
}

/** The subset of `WorkflowStep.do` the pipeline uses. */
export type DoStep = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export interface RunnerLike {
  exitCode: number;
  runner(options: PlannedStep): Promise<RunnerLike>;
}
export interface CiLike {
  runner(options: PlannedStep): Promise<RunnerLike>;
}

export interface PipelineInput {
  params: CiBuildParams;
  instanceId: string;
  step: DoStep;
  ci: CiLike;
  fetch: FetchLike;
  reportToken: string;
  platformUrl: string;
  workersSubdomain: string;
  accountId?: string;
  workflowName?: string;
}

/** A runner failure from `@cloudflare/ci` (`CiRunnerFailure`), recognised without importing the Workers-only package. */
function failedRunner(e: unknown): string | null {
  const err = e as { name?: string; runner?: { name?: string } };
  return err?.name === "CiRunnerFailure" ? (err.runner?.name ?? "unknown") : null;
}

/**
 * Report running → install → test → build → deploy → report passed with the Worker URL. A failing runner reports
 * `failed` (its step marked failed); anything else reports `error`. Either way the error is rethrown afterwards so
 * the Workflow instance ends errored. Every report and timestamp is its own durable step.
 */
export async function runPipeline(input: PipelineInput): Promise<BuildReport> {
  const { params: p, step } = input;
  const target = { reportUrl: p.reportUrl, platformUrl: input.platformUrl, token: input.reportToken };
  const send = (name: string, body: BuildReport) => step(name, () => report(input.fetch, target, body));
  const now = (name: string) => step(name, async () => new Date().toISOString());
  const base = {
    externalId: input.instanceId,
    ...(input.accountId && { logsUrl: instanceLogsUrl(input.accountId, input.workflowName ?? "artyfact-ci", input.instanceId) }),
  };

  assertReportUrl(p.reportUrl, input.platformUrl);
  let plan: PlannedStep[];
  try {
    plan = planSteps(p, { accountId: input.accountId });
  } catch (e) {
    await send("report error", reportBody(p, "error", { ...base, error: (e as Error).message }));
    throw e;
  }

  const startedAt = await now("started");
  await send("report running", reportBody(p, "running", { ...base, startedAt }));
  const steps: BuildStep[] = [];
  try {
    let workspace: RunnerLike | null = null;
    for (const s of plan) {
      const t0 = Date.parse(await now(`${s.name}: started`));
      workspace = await (workspace ? workspace.runner(s) : input.ci.runner(s));
      steps.push({ name: s.name, status: "passed", durationMs: Date.parse(await now(`${s.name}: finished`)) - t0 });
    }
    const finishedAt = await now("finished");
    const passed = reportBody(p, "passed", { ...base, url: workerUrl(p.workerName, input.workersSubdomain), steps, startedAt, finishedAt });
    await send("report passed", passed);
    return passed;
  } catch (e) {
    const runner = failedRunner(e);
    const failedAt = plan.find((s) => s.name === runner) ?? plan[steps.length];
    if (failedAt) steps.push({ name: failedAt.name, status: runner ? "failed" : "error" });
    const finishedAt = await now("finished");
    const body = reportBody(p, runner ? "failed" : "error", { ...base, steps, startedAt, finishedAt, error: (e as Error)?.message ?? String(e) });
    await send(`report ${body.status}`, body);
    throw e;
  }
}
