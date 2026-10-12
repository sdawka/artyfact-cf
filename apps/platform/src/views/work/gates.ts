import type { ConflictReport, Evaluation, Evolution, SystemCommit } from "../../../shared/api";
import { verdictOf, type UiVerdict } from "@/model/status";
import type { Criterion } from "@/model/types";
import { conflictSubjects } from "./lib";

export interface GateRow {
  criterion: Criterion;
  hook: string;
  verdict: UiVerdict;
  execution: string;
  /** Only `hard` criteria block. `soft` and `advisory` ones are advisories. */
  blocking: boolean;
}

const time = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";

/**
 * Promotion-gated criteria that apply to `evolution`, as the server selects them: its acceptance
 * criteria plus every criterion targeting what the realization changes (`artifact` for an app
 * realization, `model` for a genome one), minus deferred. Verdict and execution come from the
 * latest evaluation by the selected candidates only; none means `not-run`. Only `pass` (which
 * needs `completed`) satisfies a gate; `waived` does not.
 */
export function gateCoverage(
  criteria: readonly Criterion[],
  evolution: Evolution,
  evaluations: readonly Evaluation[],
  candidateIds: readonly string[],
  targets: readonly ("app" | "genome")[] = ["app"],
): GateRow[] {
  const kinds = new Set<string>(targets.map((t) => (t === "app" ? "artifact" : "model")));
  const scope = { source: "selected" as const, candidates: candidateIds };
  return criteria
    .filter((c) => !c.deferred && c.gates.includes("promotion") && (evolution.acceptanceCriteria.includes(c.id) || kinds.has(c.targetKind)))
    .map((c) => {
      const verdict = verdictOf(c.id, evaluations, scope);
      let latest: Evaluation | undefined;
      for (const e of evaluations) {
        if (e.criterion === c.id && candidateIds.includes(e.candidate) && (!latest || time(e) >= time(latest))) latest = e;
      }
      return {
        criterion: c,
        hook: latest?.hook ?? c.hooks[0] ?? "unknown",
        verdict,
        execution: latest?.execution ?? "not-run",
        blocking: c.severity === "hard" && verdict !== "pass",
      };
    });
}

export interface ConflictSplit {
  blocking: ConflictReport[];
  advisories: ConflictReport[];
}

/**
 * Conflicts among the selected candidates. A file, hard-semantic or evidence conflict whose
 * candidates are all selected blocks. Soft-semantic overlap, or a conflict with a candidate
 * that is not selected, is an advisory.
 */
export function splitConflicts(conflicts: readonly ConflictReport[], selected: readonly string[]): ConflictSplit {
  const out: ConflictSplit = { blocking: [], advisories: [] };
  for (const c of conflicts) {
    const cands = c.candidates ?? [];
    if (!cands.some((id) => selected.includes(id))) continue;
    const allSelected = cands.every((id) => selected.includes(id));
    (c.kind !== "soft-semantic" && allSelected ? out.blocking : out.advisories).push(c);
  }
  return out;
}

export const describeConflict = (c: ConflictReport) =>
  `${c.kind} conflict between ${(c.candidates ?? []).join(" and ") || "candidates"}${conflictSubjects(c).length ? ` on ${conflictSubjects(c).join(", ")}` : ""}${c.message ? `: ${c.message}` : ""}`;

/** The head is the commit nobody names as a parent; `null` before the first promotion. */
export function headOf(commits: readonly SystemCommit[] | undefined): string | null {
  if (!commits?.length) return null;
  const parents = new Set(commits.map((c) => c.parent));
  return (commits.find((c) => !parents.has(c.id)) ?? commits[0]!).id;
}

/** One line for a server-reported issue (string, or an object with message/criterion/rule). */
export function describeIssue(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    const id = [o.criterion, o.rule, o.id].find((v) => typeof v === "string") as string | undefined;
    const msg = typeof o.message === "string" ? o.message : typeof o.reason === "string" ? o.reason : undefined;
    if (id && msg) return `${id}: ${msg}`;
    if (msg ?? id) return (msg ?? id)!;
  }
  return JSON.stringify(x);
}
