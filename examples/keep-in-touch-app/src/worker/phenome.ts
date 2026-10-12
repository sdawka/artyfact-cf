import type { Context } from "hono";
import type { Env } from "./env";

/** Minimal slice of ExecutionContext the helper needs. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Report a Phenome event to the artyfact platform with the standard header: which System, Thing, Artifact,
 * build and deployment emitted it, so events trace back to a version. Silent no-op unless ARTYFACT_PLATFORM_URL
 * and ARTYFACT_SYSTEM_ID are set; never throws and never blocks the response. Keep payloads free of personal data.
 */
export function emitPhenome(env: Env, kind: string, payload: unknown, ctx?: WaitUntil, opts: { subject?: string } = {}): void {
  const base = env.ARTYFACT_PLATFORM_URL?.trim();
  const systemId = env.ARTYFACT_SYSTEM_ID?.trim();
  if (!base || !systemId) return;
  const buildId = env.BUILD_ID || "dev";
  const event = {
    id: crypto.randomUUID(),
    systemId,
    thingId: env.ARTYFACT_THING_ID || "unknown",
    artifactId: env.ARTYFACT_ARTIFACT_ID || "unknown",
    buildId,
    commit: buildId,
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
  }).then(() => undefined, () => undefined);
  ctx?.waitUntil(send);
}

/** The request's ExecutionContext, or undefined when the app is called directly (tests). */
export function ctxOf(c: Context): WaitUntil | undefined {
  try { return c.executionCtx; } catch { return undefined; }
}
