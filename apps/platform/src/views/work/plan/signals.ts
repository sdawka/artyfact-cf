import type { PlanCounts } from "../../../../shared/api";
import { plural } from "./lib";

/**
 * Plan work that waits on someone, from `SystemSummary.planCounts`: tasks an agent can take now, submitted tasks whose
 * candidate awaits selection, and integrated plans awaiting promotion. The rail shows the sum after "Work".
 */
export function workWaiting(c: PlanCounts | undefined): number {
  return c ? c.awaitingAgent + c.submitted + c.integrated : 0;
}

/** "2 tasks await an agent". */
export const tasksAwaitText = (n: number) => `${plural(n, "task")} ${n === 1 ? "awaits" : "await"} an agent`;

/** "a plan awaits promotion" / "2 plans await promotion". */
export const promotionText = (n: number) => (n > 1 ? `${n} plans await promotion` : "a plan awaits promotion");
