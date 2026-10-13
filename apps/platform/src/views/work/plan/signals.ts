import type { Evolution } from "../../../../shared/api";

/** States in which an Evolution's plan may be worked: approved, actionable or already realizing. */
const WORKABLE = new Set<Evolution["state"]>(["genome-approved", "actionable", "realizing"]);

/**
 * What an Evolution's task plan says at a glance, derived from the plan summary on the board payload (counts only).
 * `runningWave` and `blocked` need full tasks, so they are left out rather than guessed.
 */
export interface TaskSignals {
  tasks: number;
  waves: number;
  /** A plan exists, no task has started, and the Evolution can be worked. */
  planReady: boolean;
  /** Tasks claimed and waiting on their agent. */
  awaitingAgent: number;
  /** Tasks realizing or evaluated. */
  running: number;
  /** Tasks promoted. */
  done: number;
}

export function taskSignals(e: Evolution): TaskSignals {
  const plan = e.plan;
  if (!plan) return { tasks: 0, waves: 0, planReady: false, awaitingAgent: 0, running: 0, done: 0 };
  const by = plan.byStatus;
  const started = Object.entries(by).some(([status, n]) => status !== "planned" && (n ?? 0) > 0);
  return {
    tasks: plan.tasks,
    waves: plan.waves,
    planReady: plan.tasks > 0 && !started && WORKABLE.has(e.state),
    awaitingAgent: by.claimed ?? 0,
    running: (by.realizing ?? 0) + (by.evaluated ?? 0),
    done: by.promoted ?? 0,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The plan line on a card, or undefined when there is nothing to say. Awaiting an agent outranks running outranks ready. */
export function planLine(s: TaskSignals): string | undefined {
  if (s.awaitingAgent > 0) return `${plural(s.awaitingAgent, "task")} ${s.awaitingAgent === 1 ? "awaits" : "await"} an agent`;
  if (s.running > 0) return `wave running · ${s.running} of ${plural(s.tasks, "task")}`;
  if (s.planReady) return `plan ready · ${plural(s.tasks, "task")} in ${plural(s.waves, "wave")}`;
  return undefined;
}
