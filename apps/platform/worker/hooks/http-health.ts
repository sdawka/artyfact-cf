/**
 * `http` engine (C.webapp.health): GET `${previewUrl}${path}` with a 2 s timeout. Pass needs 200, `status === "ok"`
 * and a `buildId` that prefix-matches the candidate commit (either direction, ≥ 7 chars). No URL → not-run.
 * Transport failures and timeouts are `execution: error` (the preview may be transiently down), never a verdict.
 */
import { errored, notRun, type Outcome } from "./provenance";

export interface HealthInput {
  previewUrl?: string;
  commit: string;
  path?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export const HEALTH_TIMEOUT_MS = 2000;
const MIN_PREFIX = 7;

export function buildIdMatches(buildId: unknown, commit: string): boolean {
  if (typeof buildId !== "string" || buildId.length < MIN_PREFIX || commit.length < MIN_PREFIX) return false;
  const a = buildId.toLowerCase(), c = commit.toLowerCase();
  return c.startsWith(a) || a.startsWith(c);
}

export async function httpHealth(input: HealthInput): Promise<Outcome> {
  if (!input.previewUrl) return notRun("No previewUrl was submitted with this candidate.");
  const timeoutMs = input.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const path = input.path ?? "/health";
  const url = `${input.previewUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const doFetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const provenance = { url, timeoutMs };
  let res: Response;
  let text: string;
  try {
    res = await doFetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    text = await res.text();
  } catch (e) {
    const timedOut = ctl.signal.aborted;
    return errored(timedOut ? new Error(`GET ${url} timed out after ${timeoutMs} ms`) : e, { provenance });
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { execution: "completed", verdict: "fail", observations: [{ url, status: res.status, body: text.slice(0, 200) }], interpretation: "Health endpoint did not return JSON.", limitations: [], provenance };
  }
  const b = (body && typeof body === "object" ? body : {}) as { status?: unknown; buildId?: unknown };
  const obs = { url, status: res.status, bodyStatus: b.status, buildId: b.buildId, commit: input.commit };
  const problems: string[] = [];
  if (res.status !== 200) problems.push(`HTTP ${res.status}`);
  if (b.status !== "ok") problems.push(`status is ${JSON.stringify(b.status)}`);
  if (!buildIdMatches(b.buildId, input.commit)) problems.push(`buildId ${JSON.stringify(b.buildId)} does not match commit ${input.commit.slice(0, 12)}`);
  return {
    execution: "completed",
    verdict: problems.length ? "fail" : "pass",
    observations: [obs],
    interpretation: problems.length ? problems.join("; ") : "Preview is healthy and serves this commit.",
    limitations: ["Checks the preview deployment only."],
    provenance,
  };
}
