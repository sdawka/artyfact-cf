/**
 * Queue consumer for Artifacts `cf.artifacts.repo.pushed` events (backend.md B.4). The CLI `submit` is the primary
 * path; this is the safety net.
 *
 * Per message: parse → ignore other types / branch deletions → resolve the fork to a realization (unknown repo →
 * ack) → dedupe on `pushed:<namespace>/<repo>:<ref>:<after>` via markEventSeen → submit(realization, after, 'event')
 * → ack. Failures in resolve/dedupe/submit → retry. A redelivery (attempts > 1) bypasses dedupe, because the first
 * attempt marked the event seen before failing; submit is idempotent on (realization, commit), so this is safe.
 *
 * Wiring (slice 1.2, worker/index.ts):
 *   export default { fetch: app.fetch, queue: createQueueHandler((env) => queueContextFor(env)) };
 */
import type { QueueContext } from "./contract";
import { errorMessage } from "./provenance";

export const PUSHED = "cf.artifacts.repo.pushed";
const ZERO_SHA = /^0+$/;

/** Structural subset of the Workers `Message` type, so tests need no runtime. */
export interface QueueMessageLike {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatchLike {
  readonly queue: string;
  readonly messages: readonly QueueMessageLike[];
}

export type QueueAction = "submitted" | "duplicate" | "unknown-repo" | "ignored" | "malformed" | "retry";
export interface QueueResult {
  messageId: string;
  action: QueueAction;
  eventId?: string;
  realizationId?: string;
  error?: string;
}

interface PushedEvent {
  namespace: string;
  repoName: string;
  ref: string;
  after: string;
}

function parse(body: unknown): { event: PushedEvent } | { ignored: string } | { malformed: string } {
  let v = body;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (e) {
      return { malformed: `body is not JSON: ${errorMessage(e)}` };
    }
  }
  if (!v || typeof v !== "object") return { malformed: "body is not an object" };
  const o = v as { type?: unknown; source?: { namespace?: unknown; repoName?: unknown }; payload?: { ref?: unknown; after?: unknown } };
  if (o.type !== PUSHED) return { ignored: `event type ${String(o.type)}` };
  const namespace = o.source?.namespace, repoName = o.source?.repoName, after = o.payload?.after, ref = o.payload?.ref;
  if (typeof namespace !== "string" || typeof repoName !== "string" || typeof after !== "string" || !after) {
    return { malformed: "pushed event lacks source.namespace, source.repoName or payload.after" };
  }
  if (ZERO_SHA.test(after)) return { ignored: "branch deletion" };
  return { event: { namespace, repoName, after, ref: typeof ref === "string" ? ref : "" } };
}

export const eventIdOf = (e: PushedEvent) => `pushed:${e.namespace}/${e.repoName}:${e.ref}:${e.after}`;

async function handleOne(m: QueueMessageLike, ctx: QueueContext): Promise<QueueResult> {
  const p = parse(m.body);
  if ("malformed" in p) {
    console.error(`[queue] malformed message ${m.id}: ${p.malformed}`);
    m.ack();
    return { messageId: m.id, action: "malformed", error: p.malformed };
  }
  if ("ignored" in p) {
    m.ack();
    return { messageId: m.id, action: "ignored", error: p.ignored };
  }
  const eventId = eventIdOf(p.event);
  try {
    const realizationId = await ctx.resolveFork(p.event.namespace, p.event.repoName);
    if (!realizationId) {
      console.info(`[queue] ${eventId}: repo is not a known fork; acked`);
      m.ack();
      return { messageId: m.id, action: "unknown-repo", eventId };
    }
    const fresh = await ctx.markEventSeen(eventId);
    if (!fresh && m.attempts <= 1) {
      m.ack();
      return { messageId: m.id, action: "duplicate", eventId, realizationId };
    }
    await ctx.submit(realizationId, p.event.after, "event");
    m.ack();
    return { messageId: m.id, action: "submitted", eventId, realizationId };
  } catch (e) {
    const error = errorMessage(e);
    console.error(`[queue] ${eventId} attempt ${m.attempts} failed, retrying: ${error}`);
    m.retry();
    return { messageId: m.id, action: "retry", eventId, error };
  }
}

/** Sequential so two pushes to one fork are submitted in delivery order. */
export async function handleBatch(messages: readonly QueueMessageLike[], ctx: QueueContext): Promise<QueueResult[]> {
  const out: QueueResult[] = [];
  for (const m of messages) out.push(await handleOne(m, ctx));
  return out;
}

export function createQueueHandler<E>(contextFor: (env: E) => QueueContext) {
  return async (batch: QueueBatchLike, env: E, _ctx?: unknown): Promise<void> => {
    await handleBatch(batch.messages, contextFor(env));
  };
}
