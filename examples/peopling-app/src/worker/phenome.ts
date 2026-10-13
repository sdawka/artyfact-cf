import type { Context } from "hono";
import type { Env } from "./env";

/** Minimal slice of ExecutionContext the helper needs. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

const lastSent = new Map<string, number>();
/** Test hook: forget when throttled events were last sent. */
export function resetPhenomeThrottle(): void {
  lastSent.clear();
}

/**
 * Report a Phenome event to the artyfact platform with the standard header: which System, Thing, Artifact,
 * build and deployment emitted it, so events trace back to a version. Silent no-op unless ARTYFACT_PLATFORM_URL
 * and ARTYFACT_SYSTEM_ID are set and source identity is a commit hash; never throws and never blocks the response. Keep payloads free of personal data.
 */
export function emitPhenome(env: Env, kind: string, payload: unknown, ctx?: WaitUntil, opts: { subject?: string; minIntervalMs?: number } = {}): void {
  const base = env.ARTYFACT_PLATFORM_URL?.trim();
  const systemId = env.ARTYFACT_SYSTEM_ID?.trim();
  if (!base || !systemId) return;
  const buildId = env.BUILD_ID || "dev";
  // Current CI separates runtime build identity from source. Old hex BUILD_ID values remain compatible.
  const commit = env.ARTYFACT_SOURCE_COMMIT ?? buildId;
  if (!/^[0-9a-f]{7,64}$/.test(commit)) return;
  if (opts.minIntervalMs) {
    // Per isolate: noisy sources (a public, polled /health) must not flood the platform's capped event log.
    const key = `${kind}|${opts.subject ?? ""}`, now = Date.now();
    if (now - (lastSent.get(key) ?? -Infinity) < opts.minIntervalMs) return;
    lastSent.set(key, now);
  }
  const event = {
    id: crypto.randomUUID(),
    systemId,
    thingId: env.ARTYFACT_THING_ID || "unknown",
    artifactId: env.ARTYFACT_ARTIFACT_ID || "unknown",
    buildId,
    commit,
    ...(env.ARTYFACT_DEPLOYMENT_ID ? { deploymentId: env.ARTYFACT_DEPLOYMENT_ID } : {}),
    emittedAt: new Date().toISOString(),
    kind,
    ...(opts.subject ? { subject: opts.subject } : {}),
    payload,
  };
  const send = fetch(`${base.replace(/\/+$/, "")}/api/systems/${encodeURIComponent(systemId)}/phenome/events`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(env.ARTYFACT_INGEST_TOKEN ? { authorization: `Bearer ${env.ARTYFACT_INGEST_TOKEN}` } : {}) },
    body: JSON.stringify({ events: [event] }),
    signal: AbortSignal.timeout(5000),
  }).then(() => undefined, () => undefined);
  ctx?.waitUntil(send);
}

/** The request's ExecutionContext, or undefined when the app is called directly (tests). */
export function ctxOf(c: Context): WaitUntil | undefined {
  try { return c.executionCtx; } catch { return undefined; }
}
