import type { Evaluation } from "../../../shared/api";
import { verdictOf, type UiVerdict } from "@/model/status";

/** Verdict of one evaluation, using the same rules as scoped verdicts (only completed passes are pass). */
export const evaluationVerdict = (e: Evaluation): UiVerdict =>
  verdictOf(e.criterion, [e], { source: "selected", candidates: [e.candidate] });

const time = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";

/** Newest first. */
export const newestFirst = (xs: readonly Evaluation[]): Evaluation[] => [...xs].sort((a, b) => time(b).localeCompare(time(a)));

export function durationMs(e: Evaluation): number | undefined {
  if (!e.finishedAt) return undefined;
  const ms = Date.parse(e.finishedAt) - Date.parse(e.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

export const VERDICT_FILTERS: UiVerdict[] = ["pass", "fail", "unknown", "stale", "not-run", "waived"];
export const EXECUTION_FILTERS = ["not-run", "queued", "running", "completed", "deferred", "error"] as const;
