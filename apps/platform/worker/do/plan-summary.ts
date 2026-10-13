/**
 * `SystemSummary.planCounts` over the stored realization plans (docs/design/lifecycle.md, "Contract addendum").
 * Pure, so the summary and its tests share one definition.
 */
import type { PlanCounts } from "../../shared/api";
import type { RealizationPlan, Task } from "../../shared/lifecycle";

/** Whether an agent can take `t` now: pending with every dependency selected, or its live attempt's lease lapsed. */
export function awaitsAgent(plan: RealizationPlan, t: Task, now: number): boolean {
  if (t.status === "pending") {
    return t.dependsOn.every((d) => { const dep = plan.tasks.find((x) => x.id === d); return !!dep?.selectedCandidate; });
  }
  if (t.status === "claimed" || t.status === "working") {
    const last = t.attempts.at(-1);
    return !last || last.status === "ended" || Date.parse(last.leaseExpiresAt) <= now;
  }
  return false;
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
