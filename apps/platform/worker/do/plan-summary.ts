/**
 * `SystemSummary.planCounts` over the stored realization plans (docs/design/lifecycle.md, "Contract addendum").
 * Pure, so the summary and its tests share one definition.
 */
import type { PlanCounts } from "../../shared/api";
import type { RealizationPlan, Task } from "../../shared/lifecycle";

const live = (t: Task | undefined, now: number): boolean => {
  const last = t?.attempts.at(-1);
  return !!last && last.status !== "ended" && Date.parse(last.leaseExpiresAt) > now;
};

/**
 * Whether an agent can take `t` now, by the claim rules of lifecycle-store.ts: pending with every dependency selected,
 * or claimed/working with the lease lapsed; and no task it conflicts with has a live attempt.
 */
export function awaitsAgent(plan: RealizationPlan, t: Task, now: number): boolean {
  const byId = (id: string) => plan.tasks.find((x) => x.id === id);
  const ready = t.status === "pending"
    ? t.dependsOn.every((d) => !!byId(d)?.selectedCandidate)
    : (t.status === "claimed" || t.status === "working") && !live(t, now);
  if (!ready) return false;
  return !plan.analysis.conflicts.some((c) => c.tasks.includes(t.id) && live(byId(c.tasks.find((id) => id !== t.id)!), now));
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
