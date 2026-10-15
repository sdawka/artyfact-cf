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

/** A provenance key for people: `engineVersion` → "Engine version", `selected_by` → "Selected by". */
export function humanKey(k: string): string {
  const words = k.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : k;
}

/** An ISO time to the minute in UTC ("2026-01-01 00:00 UTC"); anything unparseable stays as given. */
export function stamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
