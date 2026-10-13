import type { Candidate, ConflictReport, Evolution, Realization, SystemCommit } from "../../../shared/api";
import { conflictsOf, mergeConflicts } from "../work/lib";
import { headOf } from "../work/gates";

/**
 * The decisions that wait on a person, one row each. The kind word says which decision:
 * - `candidate`: a submitted or evaluated candidate to review (accept into a composition or leave);
 * - `stale`: the same, but built on a System head that has since moved (promotion would be a 409);
 * - `amendment`: a Genome amendment awaiting an admin's accept or reject;
 * - `promotion`: an Evolution with an evaluated candidate on the current head, ready for the promotion desk.
 */
export type QueueKind = "candidate" | "stale" | "amendment" | "promotion";

export interface QueueRow {
  key: string;
  kind: QueueKind;
  evolution: string;
  realization?: Realization;
  candidate?: Candidate;
  /** Candidate id: the loaded candidate's, else the one the board names on the realization. */
  candidateId?: string;
  conflicts: ConflictReport[];
  /** Commits the head is ahead of the base: 0 is "base = head", null is "behind head" by an unknown count, undefined is no base known. */
  behind?: number | null;
}

export interface QueueGroup {
  evolution: string;
  title: string;
  rows: QueueRow[];
}

export interface QueueInput {
  evolutions: readonly Evolution[];
  realizations: readonly Realization[];
  commits?: readonly SystemCommit[] | undefined;
  /** Loaded candidates (any Evolution); rows exist without them, they only add detail. */
  candidates?: readonly Candidate[];
  conflicts?: readonly ConflictReport[] | undefined;
}

/** Realization statuses that mean "a candidate is open" (the DO's `pending` set). */
const OPEN = new Set(["submitted", "evaluated", "selected"]);
/** Open and far enough along to promote. */
const PROMOTABLE = new Set(["evaluated", "selected"]);

/** Commits from `base` to `head` along parents: 0 when equal, null when `base` is not an ancestor of `head`, undefined when no base or no history is known. */
export function behindBy(base: string | null | undefined, head: string | null, commits: readonly SystemCommit[] | undefined): number | null | undefined {
  // Without a base, or before the history has loaded, nothing is known (not "behind").
  if (base === undefined || commits === undefined) return undefined;
  if ((base || null) === head) return 0;
  const byId = new Map((commits ?? []).map((c) => [c.id, c] as const));
  let n = 0;
  for (let at = head; at; at = byId.get(at)?.parent ?? null) {
    if (at === base) return n;
    n += 1;
    if (n > byId.size) break;
  }
  return null;
}

/** Group the pending decisions by Evolution, in board order; within a group amendments, then candidates, then the promotion row. */
export function reviewQueue({ evolutions, realizations, commits, candidates = [], conflicts }: QueueInput): QueueGroup[] {
  const head = headOf(commits);
  const allConflicts = mergeConflicts(conflicts);
  const candidateFor = (r: Realization) => candidates.find((c) => c.realization === r.id || (r.candidate !== undefined && c.id === r.candidate));
  const order = new Map(evolutions.map((e, i) => [e.id, i] as const));
  const groups = new Map<string, QueueRow[]>();
  const add = (row: QueueRow) => groups.set(row.evolution, [...(groups.get(row.evolution) ?? []), row]);

  for (const r of realizations) {
    // Independent Task attempts are reviewed through their Realization plan in Work.
    if (!r.evolution) continue;
    const amendment = r.status === "awaiting-admin";
    if (!amendment && !OPEN.has(r.status)) continue;
    const candidate = candidateFor(r);
    if (candidate && (candidate.state === "promoted" || candidate.state === "rejected")) continue;
    const candidateId = candidate?.id ?? r.candidate;
    const base = candidate?.baseRevision ?? r.baseRevision;
    const behind = behindBy(base, head, commits);
    const kind: QueueKind = amendment ? "amendment" : behind === 0 || behind === undefined ? "candidate" : "stale";
    add({
      key: `${kind}:${r.id}`,
      kind,
      evolution: r.evolution,
      realization: r,
      ...(candidate && { candidate }),
      ...(candidateId && { candidateId }),
      conflicts: conflictsOf(allConflicts, candidateId),
      ...(behind !== undefined && { behind }),
    });
  }

  for (const [evolution, rows] of groups) {
    const ready = rows.filter((x) => x.kind === "candidate" && PROMOTABLE.has(x.realization!.status) && x.realization!.target !== "genome");
    if (ready.length) {
      rows.push({ key: `promotion:${evolution}`, kind: "promotion", evolution, conflicts: mergeConflicts(...ready.map((x) => x.conflicts)) });
    }
    const rank: Record<QueueKind, number> = { amendment: 0, stale: 1, candidate: 1, promotion: 2 };
    rows.sort((a, b) => rank[a.kind] - rank[b.kind]);
  }

  const titleOf = (id: string) => evolutions.find((e) => e.id === id)?.title ?? id;
  return [...groups.entries()]
    .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b))
    .map(([evolution, rows]) => ({ evolution, title: titleOf(evolution), rows }));
}

/** Rows awaiting a person's review in one Evolution (candidates, stale candidates, amendments; the promotion row is not a review). */
export const awaitingReview = (group: QueueGroup | undefined) => (group?.rows ?? []).filter((r) => r.kind !== "promotion").length;
