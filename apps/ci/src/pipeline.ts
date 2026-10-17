/**
 * The artyfact CI pipeline as plain functions: which runners to start, what to report, and the run itself over
 * injected `step`, `ci`, `fetch` and repo reads. `src/index.ts` wires these to `@cloudflare/ci`; tests drive them
 * with fakes. The deploy half lives in `deploy-config.ts`.
 */
import { ALLOWED_COMMANDS, type BuildReport, type BuildStatus, type BuildStep, type CiBuildParams } from "./contract";
import {
  bundleCommand, bundleConfig, CONFIG_ENV, CONFIG_FILES, deployCommand, deployConfig, DeployRefused, SECRET_VARS, SECRETS_ENV,
  systemD1Ids, systemFlagshipAppIds, validateRepoConfig, type FlagshipAppIds, type D1Ids, type DeploySpec,
} from "./deploy-config";
import { runnerFailure } from "./runner-failure";

export { shQuote } from "./deploy-config";

const COMMIT_RE = /^[0-9a-f]{40}$/;
/** Worker script names: lowercase alphanumerics and dashes, at most 63 characters, no leading or trailing dash. */
const WORKER_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const ERROR_MAX = 4000;

export type StepName = "install" | "test" | "build" | "bundle" | "deploy";

/** One `ci.runner()` call. Field names match `@cloudflare/ci` RunnerOptions. */
export interface PlannedStep {
  name: StepName;
  command: string;
  cache?: { inputs: string[] };
  /** Literal env for this runner only (redacted from step notifications by `@cloudflare/ci`). */
  env?: Record<string, string>;
  config: { retries: { limit: number; delay: number; backoff?: "constant" | "linear" | "exponential" }; retryCommandFailures?: boolean };
  cloudflareCredentials?: { accountId: string };
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
  if (!p.commands || typeof p.commands !== "object") problems.push("commands are required");
  for (const k of ["install", "test", "build", "deploy"] as const) {
    const v = p.commands?.[k];
    const required = k === "install" || k === "deploy";
    if (v === undefined && !required) continue;
    if (!(ALLOWED_COMMANDS[k] as readonly unknown[]).includes(v)) problems.push(`commands.${k} must be one of ${ALLOWED_COMMANDS[k].join(", ")}`);
  }
  for (const [k, v] of Object.entries(p.vars ?? {})) {
    if (!VAR_NAME_RE.test(k)) problems.push(`var ${k} is not an UPPER_SNAKE name`);
    if (typeof v !== "string" || /[\0\r\n]/.test(v)) problems.push(`var ${k} must be a single-line string`);
  }
  if (problems.length) throw new Error(`invalid CI params: ${problems.join("; ")}`);
}

/** Plain vars for `--var`: runtime and lineage identities come from the signed platform params, never caller vars. */
export function deployVars(p: CiBuildParams): Record<string, string> {
  const reserved = new Set(["BUILD_ID", "ARTYFACT_SOURCE_COMMIT", "ARTYFACT_GENOME_COMMIT", "ARTYFACT_THING_ID", "ARTYFACT_ARTIFACT_ID"]);
  const plain = Object.entries(p.vars ?? {}).filter(([k]) => !SECRET_VARS.has(k) && !reserved.has(k));
  return {
    ...Object.fromEntries(plain), BUILD_ID: p.buildId, ARTYFACT_SOURCE_COMMIT: p.commit,
    ...(p.genomeCommit && { ARTYFACT_GENOME_COMMIT: p.genomeCommit }),
    ...(p.thingId && { ARTYFACT_THING_ID: p.thingId }),
    ...(p.artifactId && { ARTYFACT_ARTIFACT_ID: p.artifactId }),
  };
}

/** Credentials among `vars`: uploaded as Worker secrets by the deploy step and seen by no other step. */
export function deploySecrets(p: CiBuildParams): Record<string, string> {
  return Object.fromEntries(Object.entries(p.vars ?? {}).filter(([k]) => SECRET_VARS.has(k)));
}

export interface PlanOptions {
  accountId: string;
  /** The validated repo Wrangler config. */
  spec: DeploySpec;
  /** 32 hex chars from a durable step; names the bundle directory. */
  nonce: string;
}

/**
 * install (cached on the lockfile) → test → build → bundle → deploy. Only deploy holds credentials or secrets, and
 * only bundle and deploy run Wrangler, always the pinned image copy under a cleared environment. Test, build and
 * bundle failures are deterministic and not retried; install and deploy retry once, including a failing command.
 */
export function planSteps(p: CiBuildParams, o: PlanOptions): PlannedStep[] {
  validateParams(p);
  if (!o.accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");
  if (!NONCE_RE.test(o.nonce)) throw new Error("bundle nonce must be 32 hex chars");
  const once = { retries: { limit: 1, delay: 10_000, backoff: "constant" as const }, retryCommandFailures: true };
  const never = { retries: { limit: 0, delay: 1_000 } };
  const target = { workerName: p.workerName, accountId: o.accountId };
  const secrets = deploySecrets(p);
  const hasSecrets = Object.keys(secrets).length > 0;
  const steps: PlannedStep[] = [
    { name: "install", command: p.commands.install, cache: { inputs: ["package.json", "package-lock.json"] }, config: once },
  ];
  if (p.commands.test) steps.push({ name: "test", command: p.commands.test, config: never });
  if (p.commands.build) steps.push({ name: "build", command: p.commands.build, config: never });
  steps.push(
    { name: "bundle", command: bundleCommand(o.nonce), env: { [CONFIG_ENV]: JSON.stringify(bundleConfig(o.spec, target)) }, config: never },
    {
      name: "deploy",
      command: deployCommand(o.spec, { nonce: o.nonce, workerName: p.workerName, vars: deployVars(p), hasSecrets }),
      env: { [CONFIG_ENV]: JSON.stringify(deployConfig(o.spec, { ...target, nonce: o.nonce })), ...(hasSecrets && { [SECRETS_ENV]: JSON.stringify(secrets) }) },
      config: once,
      cloudflareCredentials: { accountId: o.accountId },
    },
  );
  return steps;
}

/** The first Wrangler config at the commit, in Wrangler's lookup order. */
export async function readRepoConfig(readFile: (path: string) => Promise<string | null>): Promise<{ file: string; text: string } | null> {
  for (const file of CONFIG_FILES) {
    const text = await readFile(file);
    if (text !== null) return { file, text };
  }
  return null;
}

const randomNonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

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
  if (status === "passed") body.buildId = p.buildId;
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
  /** Sandbox logs; only deploy stdout is inspected for the exact deployed Worker version. */
  logs?: { stdout: string | ReadableStream<Uint8Array> };
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
  /** Reads a file of `params.repo` at `params.commit` (null when absent), outside the sandbox. */
  readFile: (path: string) => Promise<string | null>;
  reportToken: string;
  platformUrl: string;
  workersSubdomain: string;
  accountId: string;
  /** `systemId` -> (`database_name` -> account D1 id); the build's System picks its own entry. */
  d1DatabaseIds?: Readonly<Record<string, D1Ids>>;
  flagshipAppIds?: Readonly<Record<string, FlagshipAppIds>>;
  workflowName?: string;
}

const VERSION_ID = /^[ \t]*(?:Current|Worker) Version ID:[ \t]*([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})[ \t]*\r?$/im;
const MAX_DEPLOY_LOG_BYTES = 128 * 1024;

/** A stable API locator for the exact Worker version Wrangler reported after the upload. */
export function workerVersionLocator(accountId: string, workerName: string, versionId: string): string {
  return `cloudflare:workers:accounts/${encodeURIComponent(accountId)}/workers/${encodeURIComponent(workerName)}/versions/${versionId.toLowerCase()}`;
}

/** Consume at most one bounded deploy stdout stream and retain only Wrangler's version identifier. */
export async function deployedVersionId(runner: { logs?: { stdout: string | ReadableStream<Uint8Array> } } | null): Promise<string | undefined> {
  const stdout = runner?.logs?.stdout;
  if (!stdout) return undefined;
  let text = "";
  let capped = false;
  if (typeof stdout === "string") {
    // Slice before encoding so arbitrarily long string logs never allocate an unbounded byte buffer.
    const bytes = new TextEncoder().encode(stdout.slice(0, MAX_DEPLOY_LOG_BYTES));
    text = new TextDecoder().decode(bytes.subarray(0, MAX_DEPLOY_LOG_BYTES));
    capped = bytes.byteLength >= MAX_DEPLOY_LOG_BYTES;
  } else {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let remaining = MAX_DEPLOY_LOG_BYTES;
    try {
      while (remaining > 0) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value.subarray(0, remaining);
        remaining -= chunk.byteLength;
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      capped = remaining === 0;
    } finally {
      await reader.cancel();
    }
  }
  // At the cap, a trailing line may be incomplete; never turn its truncated prefix into output identity.
  if (capped && !text.endsWith("\n")) text = text.slice(0, text.lastIndexOf("\n") + 1);
  return VERSION_ID.exec(text)?.[1]?.toLowerCase();
}

export async function deployedOutput(p: CiBuildParams, accountId: string, runner: RunnerLike | null): Promise<BuildReport["output"]> {
  const versionId = await deployedVersionId(runner);
  return versionId ? { locator: workerVersionLocator(accountId, p.workerName, versionId) } : undefined;
}

/**
 * Report running → check the repo's Wrangler config → install → test → build → bundle → deploy → report passed with
 * the Worker URL. A refused config or a runner command that exits non-zero or times out reports `failed` (its step
 * marked failed); anything else, a lost sandbox included, reports `error`. Either way the error is rethrown afterwards
 * so the Workflow instance ends errored. Every report, read and timestamp is its own durable step.
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
  try {
    validateParams(p);
  } catch (e) {
    await send("report error", reportBody(p, "error", { ...base, error: (e as Error).message }));
    throw e;
  }

  const startedAt = await now("started");
  await send("report running", reportBody(p, "running", { ...base, startedAt }));
  const steps: BuildStep[] = [];
  let current: string = "config";
  try {
    const config = await step("read wrangler config", () => readRepoConfig(input.readFile));
    if (!config) throw new DeployRefused(`no ${CONFIG_FILES.join(" / ")} at ${p.commit.slice(0, 7)}`);
    const spec = validateRepoConfig(config.file, config.text, { accountId: input.accountId, d1DatabaseIds: systemD1Ids(input.d1DatabaseIds, p.systemId), flagshipAppIds: systemFlagshipAppIds(input.flagshipAppIds, p.systemId) });
    steps.push({ name: "config", status: "passed" });
    const nonce = await step("bundle nonce", async () => randomNonce());
    const plan = planSteps(p, { accountId: input.accountId, spec, nonce });
    let workspace: RunnerLike | null = null;
    for (const s of plan) {
      current = s.name;
      const t0 = Date.parse(await now(`${s.name}: started`));
      workspace = await (workspace ? workspace.runner(s) : input.ci.runner(s));
      steps.push({ name: s.name, status: "passed", durationMs: Date.parse(await now(`${s.name}: finished`)) - t0 });
    }
    const output = await step("deployed output", () => deployedOutput(p, input.accountId, workspace));
    const finishedAt = await now("finished");
    const passed = reportBody(p, "passed", { ...base, url: workerUrl(p.workerName, input.workersSubdomain), steps, startedAt, finishedAt });
    if (output) passed.output = output;
    await send("report passed", passed);
    return passed;
  } catch (e) {
    const failure = runnerFailure(e);
    const failed = failure?.commandFailed === true || (e as Error)?.name === "DeployRefused";
    steps.push({ name: failure && failure.runner !== "unknown" ? failure.runner : current, status: failed ? "failed" : "error" });
    const finishedAt = await now("finished");
    const body = reportBody(p, failed ? "failed" : "error", { ...base, steps, startedAt, finishedAt, error: (e as Error)?.message ?? String(e) });
    await send(`report ${body.status}`, body);
    throw e;
  }
}
