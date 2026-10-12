/**
 * One criterion's verdict over its evaluation rows, folded the way the promotion gate folds them (the DO's `gateItems`).
 * Shared by the UI (Map, inspector, Work, coverage table) and the Worker's readiness report so neither can show green
 * where the gate would refuse.
 */
import type { Evaluation } from "./api";

export type FoldedVerdict = "pass" | "fail" | "unknown" | "stale" | "not-run" | "waived";

const KNOWN = new Set<string>(["pass", "fail", "unknown", "stale", "waived"]);
const NOT_RUN = new Set<string>(["not-run", "queued", "running", "deferred"]);
/** Worst first: the folded verdict is the worst row's. */
const RANK: FoldedVerdict[] = ["fail", "stale", "unknown", "not-run", "waived", "pass"];
const PRE_PROMOTION = new Set(["submission", "candidate", "promotion"]);
const time = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";

/** Hook ids whose triggers include none of submission, candidate or promotion: their not-run rows cannot exist before promotion. */
export function offTriggerHookIds(hooks: readonly { id: string; triggers?: readonly string[] }[] | undefined): Set<string> {
  return new Set((hooks ?? []).filter((h) => !(h.triggers ?? []).some((t) => PRE_PROMOTION.has(t))).map((h) => h.id));
}

/** One row: stale stays stale, a run that never happened is not-run, anything but a completed run is unknown. */
export function rowVerdict(e: Evaluation): FoldedVerdict {
  if (e.verdict === "stale") return "stale";
  if (NOT_RUN.has(e.execution)) return "not-run";
  if (e.execution !== "completed") return "unknown";
  return KNOWN.has(e.verdict) ? (e.verdict as FoldedVerdict) : "unknown";
}

/**
 * Fold `rows` (one criterion, already scoped to the candidates that count): the latest row per hook counts (a later
 * candidate's run of a hook supersedes an earlier one); not-run rows of `offTrigger` hooks are disregarded. Any fail is
 * fail; pass needs every remaining row pass+completed; otherwise the worst of stale, unknown, not-run and waived.
 * No rows: not-run.
 */
export function foldVerdict(rows: readonly Evaluation[], offTrigger: ReadonlySet<string> = new Set()): FoldedVerdict {
  const latest = new Map<string, Evaluation>();
  for (const e of rows) {
    const k = e.hook || "none";
    const prev = latest.get(k);
    if (!prev || time(e) >= time(prev)) latest.set(k, e);
  }
  const counted = [...latest.values()].filter((e) => !(e.execution === "not-run" && offTrigger.has(e.hook)));
  if (!counted.length) return "not-run";
  return RANK[Math.min(...counted.map((e) => RANK.indexOf(rowVerdict(e))))]!;
}
