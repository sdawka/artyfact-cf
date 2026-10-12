/**
 * Hook wiring. Defaults are no-ops so the backend runs before slice 1.3 lands; at merge, replace the
 * two defaults below with the real `run.ts` factory and `queue.ts` handler.
 */
import type { HookRunner, HookRunnerFactory, QueueHandler } from "./contract";

export const noopHookRunner: HookRunner = {
  async runSubmission() { return []; },
  async runGenome() { return { readiness: null, review: [], evaluations: [] }; },
  async conflicts() { return []; },
};

/** Acks everything: no consumer yet. */
export const ackAllQueue: QueueHandler = async (batch) => { batch.ackAll(); };

const defaults = { runner: (() => noopHookRunner) as HookRunnerFactory, queue: ackAllQueue };
let current = { ...defaults };

export const hookRunner = (env: Env): HookRunner => current.runner(env);
export const queueHandler: QueueHandler = (batch, ctx) => current.queue(batch, ctx);

/** Tests (and the 1.3 merge, if preferred) swap implementations here. */
export function setHooks(h: Partial<{ runner: HookRunnerFactory; queue: QueueHandler }>): void {
  current = { ...current, ...h };
}
export function resetHooks(): void {
  current = { ...defaults };
}
