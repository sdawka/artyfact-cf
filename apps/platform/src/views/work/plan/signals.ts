import type { PlanCounts } from "../../../../shared/api";
import { plural } from "./lib";

/** Work attention counts Tasks an agent can take; decisions are counted in Review. */
export function workWaiting(c: PlanCounts | undefined): number {
  return c ? c.awaitingAgent : 0;
}

/** "2 tasks await an agent". */
export const tasksAwaitText = (n: number) => `${plural(n, "task")} ${n === 1 ? "awaits" : "await"} an agent`;

/** "a plan awaits promotion" / "2 plans await promotion". */
export const promotionText = (n: number) => (n > 1 ? `${n} plans await promotion` : "a plan awaits promotion");

/** "1 task awaits selection" / "2 tasks await selection". */
export const selectionText = (n: number) => `${plural(n, "task")} ${n === 1 ? "awaits" : "await"} selection`;
