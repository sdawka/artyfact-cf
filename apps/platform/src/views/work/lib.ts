import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { Candidate, ConflictReport, EvolutionState } from "../../../shared/api";
import type { UiVerdict } from "@/model/status";

export const COLUMNS: { state: EvolutionState; label: string }[] = [
  { state: "proposed", label: "Proposed" },
  { state: "genome-approved", label: "Genome approved" },
  { state: "actionable", label: "Actionable" },
  { state: "realizing", label: "Realizing" },
  { state: "evaluated", label: "Evaluated" },
  { state: "promoted", label: "Promoted" },
  { state: "rejected", label: "Rejected" },
];

export const shortSha = (s?: string | null) => (s ? s.slice(0, 7) : "unknown");

/** "5 min ago"; the literal "unknown" when there is no usable timestamp. */
export function relTime(iso: string | undefined | null, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "unknown";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Re-renders every `ms`, returning `Date.now()`. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "12 min 03 s"; "expired" once past; "unknown" without a usable timestamp. */
export function countdown(expiresAt: string | undefined | null, now: number): string {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(t)) return "unknown";
  const s = Math.floor((t - now) / 1000);
  if (s <= 0) return "expired";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min ${sec} s`;
}

/** Conflicts name colliding things as `nodes` + `paths` (current backend) or `subjects` (older shape). */
export const conflictSubjects = (c: ConflictReport): string[] => [...(c.nodes ?? []), ...(c.paths ?? []), ...(c.subjects ?? [])];

export const conflictKey = (c: ConflictReport) => `${c.kind}|${[...(c.candidates ?? [])].sort().join(",")}|${conflictSubjects(c).sort().join(",")}`;

/** De-duplicated union of conflict lists. */
export function mergeConflicts(...lists: (readonly ConflictReport[] | undefined)[]): ConflictReport[] {
  const seen = new Map<string, ConflictReport>();
  for (const l of lists) for (const c of l ?? []) seen.set(conflictKey(c), c);
  return [...seen.values()];
}

export const conflictsOf = (conflicts: readonly ConflictReport[], candidateId: string | undefined) =>
  candidateId ? conflicts.filter((c) => (c.candidates ?? []).includes(candidateId)) : [];

/** One badge for a set of verdicts: fail beats stale beats unknown beats not-run; pass only when every one passes. */
export function aggregate(verdicts: readonly UiVerdict[]): UiVerdict {
  if (!verdicts.length) return "not-run";
  if (verdicts.every((v) => v === "pass" || v === "waived") && verdicts.some((v) => v === "pass")) return "pass";
  for (const v of ["fail", "stale", "unknown", "not-run"] as const) if (verdicts.includes(v)) return v;
  return "waived";
}

/** Subject ids grouped by operation; without per-subject operations everything is "changed (operation unknown)". */
export function subjectGroups(c: Candidate): { added: string[]; changed: string[]; removed: string[]; unknownOp: boolean; unmapped: string[] } {
  const subjects = c.changedSubjects ?? [];
  const unmapped = subjects.filter((s) => s.startsWith("unmapped:"));
  const mapped = subjects.filter((s) => !s.startsWith("unmapped:"));
  const d = c.subjectDelta;
  if (d) return { added: d.added ?? [], changed: d.changed ?? [], removed: d.removed ?? [], unknownOp: false, unmapped };
  return { added: [], changed: mapped, removed: [], unknownOp: true, unmapped };
}

/** Reads/writes one search param, keeping the others. Empty/null removes it. */
export function useParam(key: string): [string | null, (v: string | null, also?: Record<string, string | null>) => void] {
  const [params, setParams] = useSearchParams();
  const set = useCallback(
    (v: string | null, also: Record<string, string | null> = {}) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, val] of Object.entries({ [key]: v, ...also })) {
          if (val === null || val === "") next.delete(k);
          else next.set(k, val);
        }
        return next;
      }),
    [key, setParams],
  );
  return [params.get(key), set];
}
