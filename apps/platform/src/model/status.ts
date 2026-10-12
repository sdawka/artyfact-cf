import type { Evaluation, SystemCommit } from "../../shared/api";
import type { ModelIndex } from "./index";

/** Verdict as the UI shows it. Only `pass` ever renders in the success colour. */
export type UiVerdict = "pass" | "fail" | "unknown" | "stale" | "not-run" | "waived";

export interface Rollup {
  pass: number;
  fail: number;
  unknown: number;
  stale: number;
  notRun: number;
  waived: number;
}

export const emptyRollup = (): Rollup => ({ pass: 0, fail: 0, unknown: 0, stale: 0, notRun: 0, waived: 0 });

/**
 * Which candidates' evaluations count. `selected`: the `?candidates=` param. `promoted`: the
 * candidates promoted into the current revision (from History). An empty list means nothing
 * counts, so every criterion is `not-run`; an unpromoted candidate's pass is never shown.
 */
export interface VerdictScope {
  source: "selected" | "promoted" | "revision";
  candidates: readonly string[];
}

const CANONICAL = new Set(["head", "canonical"]);

/**
 * Candidates promoted into `rev`. `commits` is History (newest first). `head`/`canonical`
 * includes every commit; a commit id includes that commit and its ancestors.
 */
export function promotedCandidates(commits: readonly SystemCommit[], rev: string): string[] {
  const start = CANONICAL.has(rev) ? 0 : commits.findIndex((c) => c.id === rev);
  if (start < 0) return [];
  return [...new Set(commits.slice(start).flatMap((c) => c.candidates))];
}

/**
 * The verdict scope for a view. Selected candidates win. Otherwise a canonical or commit revision
 * uses promoted candidates. Any other `rev` is treated as a candidate id and scopes to itself.
 */
export function verdictScope(selected: readonly string[], commits: readonly SystemCommit[], rev: string): VerdictScope {
  if (selected.length) return { source: "selected", candidates: selected };
  if (CANONICAL.has(rev) || commits.some((c) => c.id === rev)) {
    return { source: "promoted", candidates: promotedCandidates(commits, rev) };
  }
  return { source: "revision", candidates: [rev] };
}

const KNOWN = new Set<string>(["pass", "fail", "unknown", "stale", "waived"]);
const NOT_RUN = new Set<string>(["not-run", "queued", "running", "deferred"]);
const time = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";

/**
 * Verdict of a criterion from its latest in-scope evaluation. No such evaluation, or one that
 * never ran, is `not-run`; `error` is `unknown`. A `pass` only counts when execution `completed`.
 */
export function verdictOf(criterionId: string, evaluations: readonly Evaluation[], scope: VerdictScope): UiVerdict {
  const allowed = new Set(scope.candidates);
  let latest: Evaluation | undefined;
  for (const e of evaluations) {
    if (e.criterion !== criterionId || !allowed.has(e.candidate)) continue;
    if (!latest || time(e) >= time(latest)) latest = e;
  }
  if (!latest) return "not-run";
  if (latest.verdict === "stale") return "stale";
  if (NOT_RUN.has(latest.execution)) return "not-run";
  if (latest.execution !== "completed") return "unknown";
  return KNOWN.has(latest.verdict) ? latest.verdict : "unknown";
}

/** Colour family for a verdict: only pass is success, fail is danger, everything else subtle. */
export const verdictTone = (v: UiVerdict): "pass" | "fail" | "subtle" =>
  v === "pass" ? "pass" : v === "fail" ? "fail" : "subtle";

const KEY: Record<UiVerdict, keyof Rollup> = {
  pass: "pass", fail: "fail", unknown: "unknown", stale: "stale", "not-run": "notRun", waived: "waived",
};

/** Verdict counts over the non-deferred criteria whose subject is `nodeId` or any containment descendant. */
export function rollup(index: ModelIndex, nodeId: string, evaluations: readonly Evaluation[], scope: VerdictScope): Rollup {
  const out = emptyRollup();
  const seen = new Set<string>();
  for (const id of index.descendants(nodeId)) {
    for (const c of index.criteriaFor(id)) {
      if (c.deferred || seen.has(c.id)) continue;
      seen.add(c.id);
      out[KEY[verdictOf(c.id, evaluations, scope)]]++;
    }
  }
  return out;
}
