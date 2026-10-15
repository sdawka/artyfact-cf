import type { Evaluation } from "../../../shared/api";
import { foldVerdict, rowVerdict, type FoldedVerdict } from "../../../shared/verdict";

/** One criterion's evidence on one candidate: the gate's fold over its hooks, and each hook's latest row. */
export interface CriterionEvidence {
  key: string;
  criterion: string;
  candidate: string;
  verdict: FoldedVerdict;
  /** The latest row per hook, by hook id. */
  hooks: { hook: string; verdict: FoldedVerdict; execution: Evaluation["execution"] }[];
}

const time = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";

/**
 * Evaluation rows as one entry per criterion and candidate, in first-seen order. A criterion checked by several hooks
 * records a row per hook, and a re-run adds rows; the entry folds them as the promotion gate does (`foldVerdict`: the
 * latest row per hook, any fail fails, pass only when every counted hook passed and completed), so the list never
 * repeats a criterion and never shows pass while one of its hooks has not run.
 */
export function criterionEvidence(evaluations: readonly Evaluation[], offTrigger: ReadonlySet<string> = new Set()): CriterionEvidence[] {
  const groups = new Map<string, Evaluation[]>();
  for (const e of evaluations) {
    const key = `${e.candidate}\0${e.criterion}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups].map(([key, rows]) => {
    const latest = new Map<string, Evaluation>();
    for (const e of rows) {
      const prev = latest.get(e.hook || "none");
      if (!prev || time(e) >= time(prev)) latest.set(e.hook || "none", e);
    }
    return {
      key, criterion: rows[0]!.criterion, candidate: rows[0]!.candidate, verdict: foldVerdict(rows, offTrigger),
      hooks: [...latest].map(([hook, e]) => ({ hook, verdict: rowVerdict(e), execution: e.execution })),
    };
  });
}
