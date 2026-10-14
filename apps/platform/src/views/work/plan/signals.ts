import type { PlanCounts } from "../../../../shared/api";
import { plural } from "./lib";

/**
 * Plan work that waits on someone, from `SystemSummary.planCounts`, as separate items: tasks an agent can take now,
 * submitted tasks whose candidate awaits selection, and integrated plans awaiting promotion. Home shows one labelled
 * Needs-you row per item kind (`tasksAwaitText`, `selectionText`, `promotionText`); the rail shows their sum after "Work".
 */
export function workWaiting(c: PlanCounts | undefined): number {
  return c ? c.awaitingAgent + c.submitted + c.integrated : 0;
}

/** "2 tasks await an agent". */
export const tasksAwaitText = (n: number) => `${plural(n, "task")} ${n === 1 ? "awaits" : "await"} an agent`;

/** "a plan awaits promotion" / "2 plans await promotion". */
export const promotionText = (n: number) => (n > 1 ? `${n} plans await promotion` : "a plan awaits promotion");

/** "1 task awaits selection" / "2 tasks await selection". */
export const selectionText = (n: number) => `${plural(n, "task")} ${n === 1 ? "awaits" : "await"} selection`;
