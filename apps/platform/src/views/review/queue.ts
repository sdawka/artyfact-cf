import type { Candidate, ConflictReport, Evolution, Realization, SystemCommit, SystemSummary } from "../../../shared/api";
import { conflictsOf, mergeConflicts } from "../work/lib";
import { headOf } from "../work/gates";

/**
 * The decisions that wait on a person, one row each. The kind word says which decision:
 * - `candidate`: a submitted or evaluated candidate to review (accept into a composition or leave);
 * - `stale`: the same, but built on a System head that has since moved (promotion would be a 409);
 * - `amendment`: a Genome amendment awaiting an admin's accept or reject;
 * - `promotion`: an Evolution with an evaluated candidate on the current head, ready for the promotion desk;
 * - `import`: the System's import review is pending (the imported Genome awaits an admin's agreement; work is refused until then).
 */
export type QueueKind = "candidate" | "stale" | "amendment" | "promotion" | "import";

/** The import row's group: not an Evolution, so its `evolution` is empty (the Work board's signals skip it). */
export const IMPORT_GROUP = "";

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
  /** `import` rows: the reviewed Genome commit and its node count. */
  importReview?: { genomeCommit: string; nodes: number };
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
  /** The System's import review (`SystemSummary.importReview`); a pending one is a row of its own, first. */
  importReview?: SystemSummary["importReview"];
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

/** Rank within a group: what blocks others first (amendments, an import), then candidates, then the promotion row. */
const RANK: Record<QueueKind, number> = { import: 0, amendment: 0, stale: 1, candidate: 1, promotion: 2 };

/** "Import · 12 nodes": the import row's label. */
export const importLabel = (nodes: number) => `Import · ${nodes} node${nodes === 1 ? "" : "s"}`;

/**
 * Group the pending decisions by Evolution, in board order; within a group amendments, then candidates, then the
 * promotion row. A pending import review is its own group ("Import") before every Evolution: until it is accepted the
 * platform refuses new work.
 */
export function reviewQueue({ evolutions, realizations, commits, candidates = [], conflicts, importReview }: QueueInput): QueueGroup[] {
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
    rows.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  }

  const titleOf = (id: string) => evolutions.find((e) => e.id === id)?.title ?? id;
  const out = [...groups.entries()]
    .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b))
    .map(([evolution, rows]) => ({ evolution, title: titleOf(evolution), rows }));
  if (importReview?.status !== "pending") return out;
  const { genomeCommit, nodes } = importReview;
  const row: QueueRow = { key: `import:${genomeCommit}`, kind: "import", evolution: IMPORT_GROUP, conflicts: [], importReview: { genomeCommit, nodes } };
  return [{ evolution: IMPORT_GROUP, title: "Import", rows: [row] }, ...out];
}

/**
 * "Waiting for you", defined once: one decision per open realization, an app candidate submitted, evaluated or selected
 * (stale or not) or a Genome amendment awaiting an admin, plus a pending import review. A promotable candidate is one
 * item: its Evolution's promotion row is where it is decided, not a second thing waiting. The worker counts the same
 * realizations as `awaitingReview`; the import review is read from `SystemSummary.importReview`.
 */
export const isWaiting = (row: QueueRow) => row.kind !== "promotion";

/** Rows waiting for a person in one Evolution (the import row belongs to no Evolution). */
export const awaitingReview = (group: QueueGroup | undefined) => (group?.rows ?? []).filter((r) => isWaiting(r) && r.kind !== "import").length;

/** Rows waiting for a person across the queue, the import row included: the rail count, the Overview line and the queue heading. */
export const waitingCount = (groups: readonly QueueGroup[]) => groups.reduce((n, g) => n + g.rows.filter(isWaiting).length, 0);
