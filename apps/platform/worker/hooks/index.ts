/**
 * Hook wiring. Defaults are no-ops so the backend runs before the hooks slice lands. At merge, set:
 *   runner: (env) => createHookRunner({ s1Env: env })        // ./run
 *   queue:  createQueueHandler(queueContextFor)               // ./queue, ../service
 */
import type { HookRunner } from "./contract";

export type HookRunnerFactory = (env: Env) => HookRunner;
export type QueueEntry = (batch: MessageBatch<unknown>, env: Env) => Promise<void>;

export const noopHookRunner: HookRunner = {
  async runSubmission() { return []; },
  async runGenome() {
    return { readiness: { snapshotHash: "", packs: [], findings: [], derived: {}, incomplete: true, actionable: false }, review: [], evaluations: [] };
  },
  async conflicts() { return []; },
};

/** Acks everything: no consumer yet. */
export const ackAllQueue: QueueEntry = async (batch) => { batch.ackAll(); };

const defaults = { runner: (() => noopHookRunner) as HookRunnerFactory, queue: ackAllQueue };
let current = { ...defaults };

export const hookRunner = (env: Env): HookRunner => current.runner(env);
export const queueEntry: QueueEntry = (batch, env) => current.queue(batch, env);

/** Tests swap implementations here. */
export function setHooks(h: Partial<{ runner: HookRunnerFactory; queue: QueueEntry }>): void {
  current = { ...current, ...h };
}
export function resetHooks(): void {
  current = { ...defaults };
}
