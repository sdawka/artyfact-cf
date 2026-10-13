import type { ConflictReport, Evaluation, GateCriterion, SystemCommit } from "../../../shared/api";
import { rowVerdict } from "../../../shared/verdict";
import { verdictOf, type UiVerdict } from "@/model/status";
import type { Criterion } from "@/model/types";
import { conflictSubjects } from "./lib";

export interface GateRow {
  criterion: Criterion;
  /** The hook whose row decides the verdict (the worst one), else the criterion's first hook. */
  hook: string;
  verdict: UiVerdict;
  execution: string;
  /** In the server's blocking set for at least one selected candidate; the others are advisories. */
  required: boolean;
  /** Required and not pass. */
  blocking: boolean;
}

export interface GateCoverage {
  rows: GateRow[];
  /** Selected candidates the server reported no gate set for: promotion cannot be judged for them. */
  missing: string[];
}

const RANK: UiVerdict[] = ["fail", "stale", "unknown", "not-run", "waived", "pass"];
const worst = (vs: UiVerdict[]): UiVerdict => RANK[Math.min(...vs.map((v) => RANK.indexOf(v)))] ?? "not-run";
const time = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";

/** Stand-in for a gate criterion the Genome on screen does not define (an acceptance id the server keeps as blocking). */
const unknownCriterion = (g: GateCriterion): Criterion =>
  ({ id: g.id, title: g.id, claim: "", severity: g.severity, gates: ["promotion"], hooks: [], deferred: false, targetKind: "model" }) as unknown as Criterion;

/**
 * Coverage of the server's promotion gate (`gates`, from the candidates response) for the selected candidates. Each
 * candidate's rows for a criterion are folded like the DO folds them (any fail is fail, pass needs every hook's row
 * pass+completed, off-trigger not-run rows ignored); across candidates the worst verdict shows. Deferred criteria are
 * left out. Only `pass` satisfies a gate; `waived` does not.
 */
export function gateCoverage(
  criteria: readonly Criterion[],
  gates: Readonly<Record<string, readonly GateCriterion[]>> | undefined,
  evaluations: readonly Evaluation[],
  candidateIds: readonly string[],
): GateCoverage {
  const byId = new Map(criteria.map((c) => [c.id, c] as const));
  const merged = new Map<string, { g: GateCriterion; required: boolean; verdicts: UiVerdict[]; rows: Evaluation[] }>();
  const missing: string[] = [];
  for (const cid of candidateIds) {
    const set = gates?.[cid];
    if (!set) {
      missing.push(cid);
      continue;
    }
    for (const g of set) {
      if (g.deferred) continue;
      const off = new Set(g.offTriggerHooks ?? []);
      const verdict = verdictOf(g.id, evaluations, { source: "selected", candidates: [cid] }, off);
      const rows = evaluations.filter((e) => e.criterion === g.id && e.candidate === cid && !(e.execution === "not-run" && off.has(e.hook)));
      const m = merged.get(g.id) ?? { g, required: false, verdicts: [], rows: [] };
      m.required ||= g.blocking;
      m.verdicts.push(verdict);
      m.rows.push(...rows);
      merged.set(g.id, m);
    }
  }
  const rows = [...merged.values()].map(({ g, required, verdicts, rows: evs }) => {
    const verdict = worst(verdicts);
    const decisive = evs.filter((e) => rowVerdict(e) === verdict).sort((a, b) => time(b).localeCompare(time(a)))[0];
    const criterion = byId.get(g.id) ?? unknownCriterion(g);
    return {
      criterion,
      hook: decisive?.hook ?? criterion.hooks[0] ?? "unknown",
      verdict,
      execution: decisive?.execution ?? (evs.length ? evs[0]!.execution : "not-run"),
      required,
      blocking: required && verdict !== "pass",
    };
  });
  return { rows, missing };
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

const SUMMARY_ORDER: UiVerdict[] = ["pass", "fail", "stale", "unknown", "not-run", "waived"];

/** "4 pass · 1 unknown" over gate rows; `allPass` (the only case the success tone may show) needs at least one row. */
export function gatesSummary(rows: readonly GateRow[]): { text: string; allPass: boolean } {
  if (!rows.length) return { text: "no gates", allPass: false };
  const counts = SUMMARY_ORDER.map((v) => [v, rows.filter((r) => r.verdict === v).length] as const).filter(([, n]) => n > 0);
  return { text: counts.map(([v, n]) => `${n} ${v}`).join(" · "), allPass: rows.every((r) => r.verdict === "pass") };
}
