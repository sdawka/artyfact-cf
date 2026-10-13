/**
 * Intent proposals of one System (table `proposals` in schema.ts), held by the SystemAuthority DO. A row is the wire
 * `Proposal` plus the conversation that produced it (the message, then each question asked and the user's answer),
 * which a reply re-routes and re-translates. Spec: docs/design/ontology.md §5.
 */
import type { Proposal, ProposalStatus } from "../../shared/api";
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;

/** One reply: the question it answered (absent for a free follow-up) and the answer. */
export interface ProposalTurn { question?: string; answer: string }

export interface StoredProposal { proposal: Proposal; turns: ProposalTurn[] }

export class ProposalsStore {
  constructor(private readonly sql: SqlStorage) {}

  private row(id: string): Row | undefined {
    return (this.sql.exec("SELECT * FROM proposals WHERE id = ?", id).toArray() as Row[])[0];
  }

  get(id: string): StoredProposal | null {
    const r = this.row(id);
    return r ? { proposal: JSON.parse(String(r.json)) as Proposal, turns: JSON.parse(String(r.turns_json)) as ProposalTurn[] } : null;
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

  /** Moves an `open` proposal to `status`; null when it is gone or no longer open (a concurrent accept won). */
  close(id: string, status: Exclude<ProposalStatus, "open">): Proposal | null {
    const stored = this.get(id);
    if (!stored || stored.proposal.status !== "open") return null;
    const proposal = { ...stored.proposal, status };
    this.sql.exec("UPDATE proposals SET status = ?, json = ?, updated_at = ? WHERE id = ?", status, JSON.stringify(proposal), nowIso(), id);
    return proposal;
  }
}
