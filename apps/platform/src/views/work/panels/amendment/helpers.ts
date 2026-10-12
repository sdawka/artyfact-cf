import type { Commitment, SemanticChange } from "@artyfact/semantic";
import { band, verdict } from "@artyfact/semantic";

/** System One bands for display. Only `pass` (>= 0.9) may ever be shown as success. */
export type SignalBand = "pass" | "review" | "fail" | "unknown";
export function signalBand(p: number | null | undefined): SignalBand {
  if (typeof p !== "number" || Number.isNaN(p)) return "unknown";
  const v = verdict(p);
  if (v === "pass") return "pass";
  if (v === "fail") return "fail";
  return band(p) === "review" ? "review" : "unknown";
}

export const fmt = (p: number | null | undefined) => (typeof p === "number" ? p.toFixed(2) : "unknown");
export const shortSha = (sha: string | undefined) => (sha ? sha.slice(0, 7) : "unknown");

export const CHANGE_CLASSES = [
  { id: "deliberate-nonstandard-choice", label: "deliberate non-standard choice", benign: true },
  { id: "unresolved-interpretation", label: "unresolved interpretation", benign: false },
  { id: "hard-rule-violation", label: "hard rule violation", benign: false },
  { id: "clarification", label: "clarification", benign: true },
] as const;

export const SPECIFICITY_LEVELS = [
  "aspirational, no observable condition",
  "observable but no scope, role or state",
  "observable with scope, missing failure behaviour or limits",
  "fully testable: scope, condition, failure behaviour, limits",
];

export type ChangeKind = "added" | "changed" | "removed";
export function changeKind(c: SemanticChange): ChangeKind {
  const empty = (v: unknown) => v === null || v === undefined;
  if (empty(c.before)) return "added";
  if (empty(c.after)) return "removed";
  return "changed";
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function fieldValue(side: unknown, field: string): unknown {
  return asRecord(side)[field];
}

export function show(v: unknown): string {
  if (v === undefined || v === null) return "none";
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

/** The changed node's after-text: the first changed string field, else a descriptive field. */
export function afterText(c: SemanticChange | undefined): string {
  if (!c) return "";
  for (const f of c.fieldsChanged) {
    const v = fieldValue(c.after, f);
    if (typeof v === "string" && v.trim()) return v;
  }
  for (const f of ["statement", "claim", "description", "text", "name", "title"]) {
    const v = fieldValue(c.after, f);
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

/** Statement text for a commitment id: the DTO's commitments first, then the model object. */
export function commitmentStatement(
  id: string,
  dto: readonly Commitment[] | undefined,
  item: unknown,
): string {
  const fromDto = dto?.find((c) => c.id === id)?.statement;
  if (fromDto) return fromDto;
  const r = asRecord(item);
  for (const k of ["statement", "title", "claim", "name"]) {
    if (typeof r[k] === "string" && r[k]) return r[k] as string;
  }
  return id;
}
