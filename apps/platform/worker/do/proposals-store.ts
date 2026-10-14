/**
 * Intent proposals of one System (table `proposals` in schema.ts), held by the SystemAuthority DO. A row is the wire
 * `Proposal` plus the conversation that produced it (the message, then each question asked and the user's answer),
 * which a reply re-routes and re-translates. Spec: docs/design/ontology.md §5.
 *
 * The row's `status` is the wire status plus `accepting`, held while an accept pushes (the wire proposal stays `open`
 * then). Only one accept can hold it; a failed accept releases it with its error recorded. A claim older than
 * CLAIM_LEASE_MS (its isolate died mid-accept) can be taken over by a new accept.
 */
import type { Proposal, ProposalAttempt } from "../../shared/api";
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;

/** How long an `accepting` claim holds before another accept may take it over. */
export const CLAIM_LEASE_MS = 5 * 60_000;
/** Replies a proposal takes; beyond this the conversation is too long to route and translate again. */
export const MAX_TURNS = 10;

/** One reply: the question it answered (absent for a free follow-up) and the answer. */
export interface ProposalTurn { question?: string; answer: string }

export interface StoredProposal { proposal: Proposal; turns: ProposalTurn[]; accepting: boolean; acceptError?: string }

/** What an accept produced, recorded on the proposal. */
export interface AcceptedIds { evolution: string; realization: string; candidate: string; commit: string }

export type ProposalRecoveryDisposition = "revised" | "abandoned";
export interface ProposalRecoveryRevision { proposal: Proposal; turns: ProposalTurn[] }

/** A recovery holds the same row lock as accept, but fences on the exact staged candidate instead of the Genome head. */
export type RecoveryClaimResult =
  | { claimed: Proposal; turns: ProposalTurn[]; claimedAt: string }
  | { refused: "not-found" }
  | { refused: "invalid-state"; status: string }
  | { refused: "stale-candidate" };

/**
 * `claim`: the proposal, now `accepting`, and the claim's token (its `claimed_at`), which `release` and `finish` must
 * present, so an accept whose claim was taken over can neither reopen nor finish the row; else why not.
 */
export type ClaimResult =
  | { claimed: Proposal; claimedAt: string }
  | { refused: "not-found" }
  | { refused: "invalid-state"; status: string }
  | { refused: "stale-base"; currentHead: string };

/** `revise`: the stored revision; else why not (the row is checked and written in one statement). */
export type ReviseResult =
  | { revised: Proposal }
  | { refused: "invalid-state" }
  | { refused: "too-many-turns" }
  | { refused: "changed" }
  | { refused: "staged" };

export class ProposalsStore {
  constructor(private readonly sql: SqlStorage) {}

  private row(id: string): Row | undefined {
    return (this.sql.exec("SELECT * FROM proposals WHERE id = ?", id).toArray() as Row[])[0];
  }

  get(id: string): StoredProposal | null {
    const r = this.row(id);
    if (!r) return null;
    return {
      proposal: JSON.parse(String(r.json)) as Proposal, turns: JSON.parse(String(r.turns_json)) as ProposalTurn[],
      accepting: String(r.status) === "accepting", ...(r.accept_error != null && { acceptError: String(r.accept_error) }),
    };
  }

  /** Stores a new proposal under the next free `proposal.N` id. */
  create(proposal: Omit<Proposal, "id">): Proposal {
    let n = 0;
    for (const r of this.sql.exec("SELECT id FROM proposals").toArray() as Row[]) {
      const m = /^proposal\.(\d+)$/.exec(String(r.id));
      if (m) n = Math.max(n, Number(m[1]));
    }
    const stored = { id: `proposal.${n + 1}`, ...proposal } as Proposal;
    const at = nowIso();
    this.sql.exec("INSERT INTO proposals (id, status, json, turns_json, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?)",
      stored.id, stored.status, JSON.stringify(stored), at, at);
    return stored;
  }

  /**
   * Replaces an `open` proposal's content and conversation with `turns`, which appends one turn to the stored ones. One
   * conditional UPDATE: it writes only while the row is open, still holds `turns.length - 1` turns (no other reply
   * landed meanwhile) and holds fewer than MAX_TURNS, so concurrent replies can neither both append nor pass the cap.
   * It never writes over a staged approval (an accept staged a candidate after the reply read the row): the json is
   * replaced wholesale, which would erase the record of the pushed candidate.
   */
  revise(proposal: Proposal, turns: ProposalTurn[]): ReviseResult {
    const before = turns.length - 1;
    const written = this.sql.exec(
      `UPDATE proposals SET status = ?, json = ?, turns_json = ?, updated_at = ?
       WHERE id = ? AND status = 'open' AND json_array_length(turns_json) = ? AND json_array_length(turns_json) < ?
         AND json_extract(json, '$.stagedApproval') IS NULL RETURNING id`,
      proposal.status, JSON.stringify(proposal), JSON.stringify(turns), nowIso(), proposal.id, before, MAX_TURNS,
    ).toArray();
    if (written.length) return { revised: proposal };
    const r = this.row(proposal.id);
    if (!r || String(r.status) !== "open") return { refused: "invalid-state" };
    if ((JSON.parse(String(r.turns_json)) as unknown[]).length >= MAX_TURNS) return { refused: "too-many-turns" };
    if ((JSON.parse(String(r.json)) as Proposal).stagedApproval) return { refused: "staged" };
    return { refused: "changed" };
  }

  /**
   * Moves an `open` proposal to `accepting` when `headGenome` is still the commit it was computed on, and returns the
   * revision it claimed (the accept works on that one). An `accepting` row claimed more than CLAIM_LEASE_MS before `now`
   * is taken over. Synchronous, so within the DO no other accept, reply or head change interleaves.
   */
  claim(id: string, headGenome: string, now: number = Date.now()): ClaimResult {
    const lapsedBefore = new Date(now - CLAIM_LEASE_MS).toISOString();
    // One conditional UPDATE decides the claim and returns the revision it claimed; no read precedes it.
    // The token is unique per claim: a takeover in the same millisecond as the claim it replaces still differs.
    const claimedAt = `${new Date(now).toISOString()}#${crypto.randomUUID()}`;
    const [won] = this.sql.exec(
      `UPDATE proposals SET status = 'accepting', accept_error = NULL, claimed_at = ?, updated_at = ?
       WHERE id = ? AND (status = 'open' OR (status = 'accepting' AND (claimed_at IS NULL OR claimed_at < ?)))
         AND json_extract(json, '$.provenance.genomeCommit') = ? RETURNING json`,
      claimedAt, nowIso(), id, lapsedBefore, headGenome,
    ).toArray() as Row[];
    if (won) return { claimed: JSON.parse(String(won.json)) as Proposal, claimedAt };
    // Refused: say why.
    const r = this.row(id);
    if (!r) return { refused: "not-found" };
    const status = String(r.status);
    const lapsed = status === "accepting" && (r.claimed_at == null || String(r.claimed_at) < lapsedBefore);
    if (status !== "open" && !lapsed) return { refused: "invalid-state", status };
    if (lapsed) this.release(id, (r.claimed_at ?? null) as string | null, "the accept holding this proposal stopped before it finished");
    return { refused: "stale-base", currentHead: headGenome };
  }

  /** An accept that pushed nothing: back to `open`, with `error` (when given) kept for the admin. Only while `claimedAt` still holds the row. */
  release(id: string, claimedAt: string | null, error: string | null): boolean {
    return this.sql.exec(
      "UPDATE proposals SET status = 'open', accept_error = ?, claimed_at = NULL, updated_at = ? WHERE id = ? AND status = 'accepting' AND claimed_at IS ? RETURNING id",
      error, nowIso(), id, claimedAt,
    ).toArray().length > 0;
  }

  stage(id:string,claimedAt:string,approval:NonNullable<Proposal['stagedApproval']>):boolean {
    return this.sql.exec("UPDATE proposals SET json=json_set(json,'$.stagedApproval',json(?)),updated_at=? WHERE id=? AND status='accepting' AND claimed_at=?",JSON.stringify(approval),nowIso(),id,claimedAt).rowsWritten>0;
  }

  /**
   * Claims recovery of one exact staged candidate. The proposal remains unchanged while the Worker prepares a revision
   * or rejects the candidate, and an accept cannot interleave because both operations use `status = accepting`.
   */
  claimRecovery(id: string, candidateId: string, commit: string, now: number = Date.now()): RecoveryClaimResult {
    const lapsedBefore = new Date(now - CLAIM_LEASE_MS).toISOString();
    const claimedAt = `${new Date(now).toISOString()}#recovery:${crypto.randomUUID()}`;
    const [won] = this.sql.exec(
      `UPDATE proposals SET status = 'accepting', claimed_at = ?, updated_at = ?
       WHERE id = ? AND (status = 'open' OR (status = 'accepting' AND (claimed_at IS NULL OR claimed_at < ?)))
         AND json_extract(json, '$.stagedApproval.candidateId') = ?
         AND json_extract(json, '$.stagedApproval.commit') = ? RETURNING json`,
      claimedAt, nowIso(), id, lapsedBefore, candidateId, commit,
    ).toArray() as Row[];
    if (won) {
      const r = this.row(id)!;
      return { claimed: JSON.parse(String(won.json)) as Proposal, turns: JSON.parse(String(r.turns_json)) as ProposalTurn[], claimedAt };
    }
    const r = this.row(id);
    if (!r) return { refused: "not-found" };
    const status = String(r.status);
    const lapsed = status === "accepting" && (r.claimed_at == null || String(r.claimed_at) < lapsedBefore);
    if (status !== "open" && !lapsed) return { refused: "invalid-state", status };
    return { refused: "stale-candidate" };
  }

  /**
   * Completes a held recovery. The exact staged approval (including integrity evidence references) is appended to
   * immutable attempt history before it is cleared. A revision replaces the proposal/turns under the same claim;
   * abandonment keeps the last proposal content and closes it.
   */
  recover(
    id: string,
    claimedAt: string,
    disposition: ProposalRecoveryDisposition,
    reason: string,
    revision?: ProposalRecoveryRevision,
  ): Proposal | null {
    const r = this.row(id);
    if (!r || String(r.status) !== "accepting" || String(r.claimed_at) !== claimedAt) return null;
    const current = JSON.parse(String(r.json)) as Proposal;
    if (!current.stagedApproval || (disposition === "revised" && !revision)) return null;
    const attempt: ProposalAttempt = {
      stagedApproval: current.stagedApproval,
      disposition,
      reason,
      endedAt: nowIso(),
      ...(r.accept_error != null && { acceptError: String(r.accept_error) }),
    };
    const source = revision?.proposal ?? current;
    const { stagedApproval: _staged, attempts: revisedAttempts, ...rest } = source;
    const proposal = {
      ...rest,
      status: disposition === "abandoned" ? "abandoned" : "open",
      attempts: [...(current.attempts ?? revisedAttempts ?? []), attempt],
    } as Proposal;
    const turns = revision?.turns ?? (JSON.parse(String(r.turns_json)) as ProposalTurn[]);
    const [written] = this.sql.exec(
      `UPDATE proposals SET status = ?, json = ?, turns_json = ?, accept_error = NULL, claimed_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'accepting' AND claimed_at = ? RETURNING id`,
      proposal.status, JSON.stringify(proposal), JSON.stringify(turns), nowIso(), id, claimedAt,
    ).toArray();
    return written ? proposal : null;
  }

  /** An open (or held) proposal whose accept failed for good: `abandoned`, so nothing can accept it later. */
  abandon(id: string): boolean {
    return this.sql.exec(
      `UPDATE proposals SET status = 'abandoned', json = json_set(json, '$.status', 'abandoned'), claimed_at = NULL, updated_at = ?
       WHERE id = ? AND status IN ('open', 'accepting') RETURNING id`,
      nowIso(), id,
    ).toArray().length > 0;
  }

  /**
   * A pushed accept: `accepted`, with what it produced, and `error` when something after the push failed (the commit
   * stands, so the proposal must not reopen). Null unless `claimedAt` still holds the row.
   */
  finish(id: string, claimedAt: string, ids: AcceptedIds, error?: string): Proposal | null {
    const [r] = this.sql.exec(
      `UPDATE proposals SET status = 'accepted', json = json_set(json, '$.status', 'accepted'), accepted_json = ?, accept_error = ?, claimed_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'accepting' AND claimed_at = ? RETURNING json`,
      JSON.stringify(ids), error ?? null, nowIso(), id, claimedAt,
    ).toArray() as Row[];
    return r ? (JSON.parse(String(r.json)) as Proposal) : null;
  }
}
