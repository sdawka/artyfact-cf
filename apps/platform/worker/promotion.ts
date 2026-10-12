/**
 * Promotion gate inputs. The criteria in play for a candidate are exactly those the hooks select for it
 * (acceptance ∪ changed subjects ∪ System submission gates, non-deferred). A criterion BLOCKS promotion when it
 * is `severity: hard` and at least one of its hooks has `binding: bound`; every other non-passing criterion is an
 * advisory the promoter acknowledges with a non-empty rationale.
 */
import type { schema, SystemModel } from "@artyfact/model";
import type { CandidateRef } from "./hooks/contract";
import { selectHooks } from "./hooks/run";

export interface GateCriterion {
  id: string;
  severity: "hard" | "soft" | "advisory";
  /** Hard with ≥1 bound hook: must be pass+completed. */
  blocking: boolean;
}

/** Hooks attached to a criterion (index ∪ the criterion's own list). */
export function hooksOf(m: SystemModel, c: schema.Criterion): schema.AssayHook[] {
  const ids = new Set([...(m.index.hooksByCriterion[c.id] ?? []), ...c.hooks]);
  return m.hooks.filter((h) => ids.has(h.id));
}

export const isBlocking = (m: SystemModel, c: schema.Criterion): boolean =>
  (c.severity ?? "hard") === "hard" && !c.deferred && hooksOf(m, c).some((h) => h.binding === "bound");

export function gateCriteria(m: SystemModel, candidate: CandidateRef): GateCriterion[] {
  const out = new Map<string, GateCriterion>();
  for (const s of selectHooks(m, candidate)) {
    const c = s.criterion;
    if (out.has(c.id)) continue;
    out.set(c.id, { id: c.id, severity: c.severity ?? "hard", blocking: isBlocking(m, c) });
  }
  return [...out.values()];
}
