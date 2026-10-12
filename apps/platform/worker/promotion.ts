/**
 * Promotion gate inputs (computed in the Worker, enforced by the DO, which fails closed on anything missing).
 *
 * Blocking set = (the Evolution's acceptanceCriteria ∪ criteria whose `gates` include `promotion`)
 *                ∩ `severity: hard` ∩ has ≥1 hook with `binding: bound`, non-deferred.
 * Acceptance criteria block regardless of their own `gates`: they are what the Evolution promised.
 * For a Genome candidate (accept; `/promote` refuses Genome candidates with 409 `use-accept`), promotion-gated criteria
 * that target the artifact are left out of the pool: a Genome change has no app tree to evaluate them on. They gate app candidates.
 * Every other criterion in that pool is an advisory when not pass+completed; advisories need a non-empty rationale.
 * Hook selection (`selectHooks`) decides which hooks RUN; it does not shape the gate.
 */
import type { schema, SystemModel } from "@artyfact/model";
import type { CandidateRef } from "./hooks/contract";

export interface GateCriterion {
  id: string;
  severity: "hard" | "soft" | "advisory";
  /** Must be pass+completed for this candidate. */
  blocking: boolean;
  /** Deferred acceptance criterion: known to the gate, neither blocking nor advisory. */
  deferred?: true;
  /**
   * Hooks of this criterion whose `triggers` include none of submission, candidate or promotion (deployment, outcome
   * or selection stage). Their `not-run` rows cannot exist before promotion and are disregarded; nothing else is.
   */
  offTriggerHooks?: string[];
}

const PRE_PROMOTION = ["submission", "candidate", "promotion"];
/** Hook ids of `c` that never run before promotion, from the Genome's hook definitions. */
export const offTriggerHooks = (m: SystemModel, c: schema.Criterion): string[] =>
  hooksOf(m, c).filter((h) => !h.triggers.some((t) => PRE_PROMOTION.includes(t))).map((h) => h.id);

/** Hooks attached to a criterion (index ∪ the criterion's own list). */
export function hooksOf(m: SystemModel, c: schema.Criterion): schema.AssayHook[] {
  const ids = new Set([...(m.index.hooksByCriterion[c.id] ?? []), ...c.hooks]);
  return m.hooks.filter((h) => ids.has(h.id));
}

/** Hard, non-deferred, with a bound hook. Whether it is in the blocking set also depends on acceptance/promotion. */
export const isBlocking = (m: SystemModel, c: schema.Criterion): boolean =>
  (c.severity ?? "hard") === "hard" && !c.deferred && hooksOf(m, c).some((h) => h.binding === "bound");

/**
 * Gate criteria for `candidate` of `evolution`. Throws if the model or selection is unusable; callers must treat a
 * throw as "gate unavailable", never as "no gates". Acceptance ids missing from the Genome come back blocking.
 *
 * For a Genome candidate, promotion-gated criteria with `targetKind: "artifact"` are left out (they gate app candidates;
 * their hooks inspect the app tree). This keys on the criterion's target kind, not on whether its hooks could run
 * on a Genome: it assumes artifact-targeted criteria carry only artifact hooks (manifest, http-health, scope). An
 * artifact criterion with a `model-rules` or `system-one` hook would be dropped from a Genome candidate's gate;
 * no Genome has one today. The Evolution's own acceptance criteria are always kept.
 */
export function gateCriteria(m: SystemModel, evolution: Pick<schema.Evolution, "acceptanceCriteria">, candidate?: Pick<CandidateRef, "target">): GateCriterion[] {
  const byId = new Map(m.criteria.map((c) => [c.id, c] as const));
  const out = new Map<string, GateCriterion>();
  const add = (id: string, blockingSet: boolean) => {
    const c = byId.get(id);
    const prev = out.get(id);
    if (!c) {
      // An acceptance criterion the Genome does not define cannot be evaluated: fail closed.
      out.set(id, { id, severity: "hard", blocking: true });
      return;
    }
    if (c.deferred) {
      if (!prev) out.set(id, { id, severity: c.severity ?? "hard", blocking: false, deferred: true });
      return;
    }
    const blocking = (prev?.blocking ?? false) || (blockingSet && isBlocking(m, c));
    const off = offTriggerHooks(m, c);
    out.set(id, { id, severity: c.severity ?? "hard", blocking, ...(off.length && { offTriggerHooks: off }) });
  };
  for (const id of evolution.acceptanceCriteria) add(id, true);
  const genome = candidate?.target === "genome";
  for (const c of m.criteria) if (c.gates.includes("promotion") && !(genome && c.targetKind === "artifact")) add(c.id, true);
  return [...out.values()];
}
