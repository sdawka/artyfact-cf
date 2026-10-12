import type { Evaluation } from "../../shared/api";
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

/** Accepts both the wire `Evaluation` and the model package's (which uses startedAt/finishedAt). */
type EvaluationLike = Pick<Evaluation, "criterion" | "candidate"> & {
  verdict: string;
  execution: string;
  at?: string;
  startedAt?: string;
  finishedAt?: string;
};

const KNOWN = new Set<string>(["pass", "fail", "unknown", "stale", "waived"]);
const time = (e: EvaluationLike) => e.at ?? e.finishedAt ?? e.startedAt ?? "";

/**
 * Verdict of a criterion from its latest evaluation (optionally for one candidate).
 * No evaluation, or one that never ran, is `not-run`; one that errored or timed out is
 * `unknown`. A `pass` only counts when execution `completed`.
 */
export function verdictOf(
  criterionId: string,
  evaluations: readonly EvaluationLike[],
  opts: { candidate?: string } = {},
): UiVerdict {
  let latest: EvaluationLike | undefined;
  for (const e of evaluations) {
    if (e.criterion !== criterionId) continue;
    if (opts.candidate !== undefined && e.candidate !== opts.candidate) continue;
    if (!latest || time(e) >= time(latest)) latest = e;
  }
  if (!latest) return "not-run";
  if (latest.verdict === "stale") return "stale";
  if (latest.verdict === "not-run") return "not-run";
  if (["not-run", "queued", "running", "deferred"].includes(latest.execution)) return "not-run";
  if (latest.execution !== "completed") return "unknown";
  return KNOWN.has(latest.verdict) ? (latest.verdict as UiVerdict) : "unknown";
}

/** Colour family for a verdict: only pass is success, fail is danger, everything else subtle. */
export const verdictTone = (v: UiVerdict): "pass" | "fail" | "subtle" =>
  v === "pass" ? "pass" : v === "fail" ? "fail" : "subtle";

const KEY: Record<UiVerdict, keyof Rollup> = {
  pass: "pass", fail: "fail", unknown: "unknown", stale: "stale", "not-run": "notRun", waived: "waived",
};

/** Verdict counts over the non-deferred criteria whose subject is `nodeId` or any containment descendant. */
export function rollup(
  index: ModelIndex,
  nodeId: string,
  evaluations: readonly EvaluationLike[],
  opts: { candidate?: string } = {},
): Rollup {
  const out = emptyRollup();
  const seen = new Set<string>();
  for (const id of index.descendants(nodeId)) {
    for (const c of index.criteriaFor(id)) {
      if (c.deferred || seen.has(c.id)) continue;
      seen.add(c.id);
      out[KEY[verdictOf(c.id, evaluations, opts)]]++;
    }
  }
  return out;
}
