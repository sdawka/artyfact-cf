/**
 * `SystemSummary.planCounts` over the stored realization plans (docs/design/lifecycle.md, "Contract addendum").
 * Pure, so the summary and its tests share one definition.
 */
import { taskAvailability } from '@artyfact/model';
import type { PlanCounts } from "../../shared/api";
import type { RealizationPlan, Task } from "../../shared/lifecycle";

/** Same availability and dependency rules used by the CLI's next action. */
export function awaitsAgent(plan: RealizationPlan, task: Task, now: number): boolean {
  return taskAvailability(plan, task, now) !== undefined;
}

export function planCounts(plans: RealizationPlan[], now: number = Date.now()): PlanCounts {
  const open = plans.filter((p) => p.status !== "promoted");
  return {
    open: open.length,
    awaitingAgent: open.reduce((n, p) => n + p.tasks.filter((t) => awaitsAgent(p, t, now)).length, 0),
    submitted: open.reduce((n, p) => n + p.tasks.filter((t) => t.status === "submitted").length, 0),
    integrated: open.filter((p) => p.status === "integrated").length,
  };
}
