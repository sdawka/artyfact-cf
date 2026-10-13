/**
 * Intent proposals of one System (table `proposals` in schema.ts), held by the SystemAuthority DO. A row is the wire
 * `Proposal` plus the conversation that produced it (the message, then each question asked and the user's answer),
 * which a reply re-routes and re-translates. Spec: docs/design/ontology.md §5.
 *
 * The row's `status` is the wire status plus `accepting`, held while an accept pushes (the wire proposal stays `open`
 * then). Only one accept can hold it; a failed accept releases it with its error recorded.
 */
import type { Proposal } from "../../shared/api";
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;

/** One reply: the question it answered (absent for a free follow-up) and the answer. */
export interface ProposalTurn { question?: string; answer: string }

export interface StoredProposal { proposal: Proposal; turns: ProposalTurn[]; accepting: boolean; acceptError?: string }

/** What an accept produced, recorded on the proposal. */
export interface AcceptedIds { evolution: string; realization: string; candidate: string; commit: string }

/** `claim`: the proposal, now `accepting`; else why not. */
export type ClaimResult =
  | { claimed: Proposal }
  | { refused: "not-found" }
  | { refused: "invalid-state"; status: string }
  | { refused: "stale-base"; currentHead: string };

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

  /** Replaces an `open` proposal's content and conversation; null when it is gone or no longer open. */
  revise(proposal: Proposal, turns: ProposalTurn[]): Proposal | null {
    const r = this.row(proposal.id);
    if (!r || String(r.status) !== "open") return null;
    this.sql.exec("UPDATE proposals SET status = ?, json = ?, turns_json = ?, updated_at = ? WHERE id = ?",
      proposal.status, JSON.stringify(proposal), JSON.stringify(turns), nowIso(), proposal.id);
    return proposal;
  }

  /**
   * Moves an `open` proposal to `accepting` when `headGenome` is still the commit it was computed on. Synchronous, so
   * within the DO no other accept, reply or head change interleaves.
   */
  claim(id: string, headGenome: string): ClaimResult {
    const r = this.row(id);
    if (!r) return { refused: "not-found" };
    if (String(r.status) !== "open") return { refused: "invalid-state", status: String(r.status) };
    const proposal = JSON.parse(String(r.json)) as Proposal;
    if (proposal.provenance.genomeCommit !== headGenome) return { refused: "stale-base", currentHead: headGenome };
    this.sql.exec("UPDATE proposals SET status = 'accepting', accept_error = NULL, updated_at = ? WHERE id = ?", nowIso(), id);
    return { claimed: proposal };
  }

  /** A failed accept: back to `open`, with `error` kept for the admin. */
  release(id: string, error: string): void {
    this.sql.exec("UPDATE proposals SET status = 'open', accept_error = ?, updated_at = ? WHERE id = ? AND status = 'accepting'", error, nowIso(), id);
  }

  /** A successful accept: `accepted`, with what it produced. Null unless the proposal was `accepting`. */
  finish(id: string, ids: AcceptedIds): Proposal | null {
    const stored = this.get(id);
    if (!stored?.accepting) return null;
    const proposal: Proposal = { ...stored.proposal, status: "accepted" };
    this.sql.exec("UPDATE proposals SET status = 'accepted', json = ?, accepted_json = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(proposal), JSON.stringify(ids), nowIso(), id);
    return proposal;
  }
}
