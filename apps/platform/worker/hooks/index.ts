/**
 * Hook wiring: the real runner (./run) and queue consumer (./queue). Tests swap them with `setHooks`.
 * `noopHookRunner` is kept for tests and as a building block.
 */
import { queueContextFor } from "../service";
import type { HookRunner } from "./contract";
import { createQueueHandler } from "./queue";
import { createHookRunner } from "./run";

export type HookRunnerFactory = (env: Env) => HookRunner;
export type QueueEntry = (batch: MessageBatch<unknown>, env: Env) => Promise<void>;

export const noopHookRunner: HookRunner = {
  async runSubmission() { return []; },
  async runGenome() {
    return { readiness: { snapshotHash: "", packs: [], findings: [], derived: {}, incomplete: true, actionable: false }, review: [], evaluations: [] };
  },
  async conflicts() { return []; },
};

/** Acks everything (tests). */
export const ackAllQueue: QueueEntry = async (batch) => { batch.ackAll(); };

const realRunner: HookRunnerFactory = (env) => createHookRunner({ s1Env: env });
// Built lazily: service.ts imports this module, so `queueContextFor` is only safe to read at call time.
const realQueue: QueueEntry = (batch, env) => createQueueHandler(queueContextFor)(batch, env);

const defaults = { runner: realRunner, queue: realQueue };
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
