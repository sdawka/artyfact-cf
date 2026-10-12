/**
 * `http` engine (C.webapp.health): GET `${previewUrl}${path}` with a 2 s timeout. Pass needs 200, `status === "ok"`
 * and a `buildId` that prefix-matches the candidate commit (either direction, ≥ 7 chars). No URL → not-run.
 *
 * `previewUrl` is agent-supplied, so it is validated before any request (SSRF): https only, hostname on the
 * allowlist (`*.workers.dev`, `*.pages.dev`, plus `PREVIEW_HOST_ALLOWLIST`), no IP literals, no credentials, default
 * port; `http(s)://localhost|127.0.0.1` only with `ALLOW_LOCAL_PREVIEW=1`. A rejected URL is `completed / fail`
 * (the agent gave a bad URL). Redirects are not followed (3xx → unknown). The body is never echoed: only
 * `{status, ok, buildId}` and short error messages are recorded. Transport failures and timeouts are
 * `execution: error`, never a verdict.
 */
import { notRun, type Outcome } from "./provenance";

export interface PreviewEnv {
  /** "1" allows http(s)://localhost and 127.0.0.1 (local dev only). */
  ALLOW_LOCAL_PREVIEW?: string;
  /** Extra allowed hosts, comma-separated: `app.example.com` (exact) or `*.example.com` (subdomains). */
  PREVIEW_HOST_ALLOWLIST?: string;
}

export interface PreviewPolicy {
  allowLocal: boolean;
  hosts: string[];
}

export const DEFAULT_PREVIEW_HOSTS = ["*.workers.dev", "*.pages.dev"];

const ALLOWLIST_ENTRY = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const normHost = (h: string) => h.trim().toLowerCase().replace(/\.$/, "");

export function previewPolicy(env: PreviewEnv = {}): PreviewPolicy {
  // Only well-formed host patterns: `host.tld` or `*.host.tld` (≥ 2 labels). Anything else (bare `*`, `*.`, schemes,
  // ports, paths) is ignored.
  const extra = (env.PREVIEW_HOST_ALLOWLIST ?? "").split(",").map(normHost).filter((h) => ALLOWLIST_ENTRY.test(h));
  return { allowLocal: env.ALLOW_LOCAL_PREVIEW === "1", hosts: [...DEFAULT_PREVIEW_HOSTS, ...extra] };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function hostAllowed(host: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.startsWith("*.") ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p));
}

export type PreviewCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Validate an agent-supplied preview URL against the policy. */
export function validatePreviewUrl(raw: string, policy: PreviewPolicy): PreviewCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.username || url.password) return { ok: false, reason: "credentials in URL are not allowed" };
  const host = normHost(url.hostname);
  if (policy.allowLocal && LOCAL_HOSTS.has(host) && (url.protocol === "http:" || url.protocol === "https:")) return { ok: true, url };
  if (url.protocol !== "https:") return { ok: false, reason: `scheme ${url.protocol.replace(":", "")} is not allowed; use https` };
  if (IPV4.test(host) || host.includes(":") || host.startsWith("[")) return { ok: false, reason: "IP address hosts are not allowed" };
  if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost")) return { ok: false, reason: "local hosts are not allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: `port ${url.port} is not allowed` };
  if (!hostAllowed(host, policy.hosts)) return { ok: false, reason: `host ${host.slice(0, 64)} is not on the preview allowlist` };
  return { ok: true, url };
}

export interface HealthInput {
  previewUrl?: string;
  commit: string;
  path?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  policy?: PreviewPolicy;
}

export const HEALTH_TIMEOUT_MS = 2000;
const MIN_PREFIX = 7;
const MAX_FIELD = 64;
const MAX_BODY_BYTES = 16 * 1024;

const clip = (s: string) => (s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD - 1)}…` : s);

export function buildIdMatches(buildId: unknown, commit: string): boolean {
  if (typeof buildId !== "string" || buildId.length < MIN_PREFIX || commit.length < MIN_PREFIX) return false;
  const a = buildId.toLowerCase(), c = commit.toLowerCase();
  return c.startsWith(a) || a.startsWith(c);
}

/** Read at most MAX_BODY_BYTES; returns null when the body is larger. */
async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

const rejected = (reason: string): Outcome => ({
  execution: "completed",
  verdict: "fail",
  observations: [`previewUrl rejected: ${reason}`],
  interpretation: `previewUrl rejected: ${reason}`,
  limitations: [],
});

export async function httpHealth(input: HealthInput): Promise<Outcome> {
  if (!input.previewUrl) return notRun("No previewUrl was submitted with this candidate.");
  const check = validatePreviewUrl(input.previewUrl, input.policy ?? previewPolicy());
  if (!check.ok) return rejected(check.reason);

  const path = input.path ?? "/health";
  const base = new URL(check.url.href.replace(/\/+$/, "") + "/");
  const target = new URL(path.replace(/^\/+/, ""), base);
  if (target.origin !== check.url.origin) return rejected("health path leaves the preview origin");
  const url = `${target.origin}${target.pathname}`;

  const timeoutMs = input.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const doFetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const provenance = { url, timeoutMs };
  let res: Response;
  let text: string | null;
  try {
    res = await doFetch(url, { signal: ctl.signal, redirect: "manual", headers: { accept: "application/json" } });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      text = "";
    } else {
      text = await readCapped(res);
    }
  } catch (e) {
    const timedOut = ctl.signal.aborted;
    const msg = clip(timedOut ? `GET timed out after ${timeoutMs} ms` : e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return { execution: "error", verdict: "unknown", observations: [{ url, error: msg }], interpretation: msg, limitations: [], provenance };
  } finally {
    clearTimeout(timer);
  }

  const done = (verdict: "pass" | "fail" | "unknown", obs: { status: number; ok?: unknown; buildId?: unknown }, problem?: string): Outcome => ({
    execution: "completed",
    verdict,
    observations: [{ url, status: obs.status, ok: obs.ok, buildId: typeof obs.buildId === "string" ? clip(obs.buildId) : obs.buildId === undefined ? undefined : typeof obs.buildId, ...(problem && { error: clip(problem) }) }],
    interpretation: problem ? clip(problem) : "Preview is healthy and serves this commit.",
    limitations: [
      "Checks the preview deployment only.",
      "A pass proves only that the allowlisted host served a matching buildId, not who operates that host.",
    ],
    provenance,
  });

  // The redirect target was never examined: not evidence either way. `fail` is reserved for an unusable URL.
  if (res.status >= 300 && res.status < 400) {
    return { execution: "completed", verdict: "unknown", observations: [{ url, status: res.status }], interpretation: `redirect (HTTP ${res.status}) not followed`, limitations: ["Redirects are not followed."], provenance };
  }
  if (text === null) return done("fail", { status: res.status }, `body larger than ${MAX_BODY_BYTES} bytes`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return done("fail", { status: res.status }, "health endpoint did not return JSON");
  }
  const b = (body && typeof body === "object" ? body : {}) as { status?: unknown; buildId?: unknown };
  const statusOk = b.status === "ok";
  const problems: string[] = [];
  if (res.status !== 200) problems.push(`HTTP ${res.status}`);
  if (!statusOk) problems.push("status is not ok");
  if (!buildIdMatches(b.buildId, input.commit)) problems.push("buildId does not match the commit");
  return done(problems.length ? "fail" : "pass", { status: res.status, ok: statusOk, buildId: b.buildId }, problems.length ? problems.join("; ") : undefined);
}
