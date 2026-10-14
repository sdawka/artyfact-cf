/**
 * The agreement-tree columns of `proposals` (`plan_json`, `decisions_json`, `deferred_from`) and the deferred-proposal
 * rebase. Storage only; planning, decisions and deferral logic live in worker/intents.ts. Rows stored before these
 * columns read as an empty plan with no decisions. Contract: docs/design/lifecycle.md, "Contract addendum".
 */
import type { Proposal, ProposalDecisions, ProposalPlanNode } from "../../shared/api";
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;

/** What the plan columns hold. */
export interface StoredProposalPlan { plan: ProposalPlanNode[]; decisions: ProposalDecisions; deferredFrom?: string }

export class ProposalPlanStore {
  constructor(private readonly sql: SqlStorage) {}

  private row(id: string): Row | undefined {
    return (this.sql.exec("SELECT json, plan_json, decisions_json, deferred_from FROM proposals WHERE id = ?", id).toArray() as Row[])[0];
  }

  private static read(r: Row): StoredProposalPlan {
    const legacy = (JSON.parse(String(r.json)) as Partial<Proposal>);
    const plan = r.plan_json != null ? (JSON.parse(String(r.plan_json)) as ProposalPlanNode[]) : Array.isArray(legacy.plan) ? legacy.plan : [];
    const deferredFrom = r.deferred_from != null ? String(r.deferred_from) : legacy.deferredFrom;
    return {
      plan,
      decisions: r.decisions_json != null ? (JSON.parse(String(r.decisions_json)) as ProposalDecisions) : {},
      ...(deferredFrom && { deferredFrom }),
    };
  }

  /** Tree, explicit decisions and deferral source; null for an unknown proposal. */
  get(id: string): StoredProposalPlan | null {
    const r = this.row(id);
    return r ? ProposalPlanStore.read(r) : null;
  }

  /**
   * The wire proposal with `plan` and `deferredFrom` from the columns (the json's own copies are only a fallback for
   * rows written before the columns). Nodes are returned as stored; decorating them with decisions is the Worker's.
   */
  decorate(p: Proposal): Proposal {
    const r = this.row(p.id);
    if (!r) return { ...p, plan: Array.isArray(p.plan) ? p.plan : [] };
    const { plan, deferredFrom } = ProposalPlanStore.read(r);
    return { ...p, plan, ...(deferredFrom && { deferredFrom }) };
  }

  /**
   * Writes tree and decisions (and `deferredFrom` when given; undefined keeps the stored one) in one conditional
   * UPDATE, only while the proposal is `open`, and, when `expected` is given, only while the stored decisions are
   * still exactly `expected` (a compare-and-set; a row without decisions counts as `{}`). False when it is not open
   * (including `accepting`), unknown, or its decisions changed.
   */
  set(id: string, plan: ProposalPlanNode[], decisions: ProposalDecisions, deferredFrom?: string, expected?: ProposalDecisions): boolean {
    const want = expected === undefined ? null : JSON.stringify(expected);
    return this.sql.exec(
      `UPDATE proposals SET plan_json = ?, decisions_json = ?, deferred_from = COALESCE(?, deferred_from), updated_at = ?
       WHERE id = ? AND status = 'open' AND (? IS NULL OR COALESCE(decisions_json, '{}') = ?) RETURNING id`,
      JSON.stringify(plan), JSON.stringify(decisions), deferredFrom ?? null, nowIso(), id, want, want,
    ).toArray().length > 0;
  }

  /** Writes only the tree, keeping decisions, while `open` (a reply's rebuilt tree). */
  setTree(id: string, plan: ProposalPlanNode[]): boolean {
    return this.sql.exec("UPDATE proposals SET plan_json = ?, updated_at = ? WHERE id = ? AND status = 'open' RETURNING id", JSON.stringify(plan), nowIso(), id)
      .toArray().length > 0;
  }

  /** Initial columns of a just-created proposal (no status check: called in the create transaction). */
  init(id: string, plan: ProposalPlanNode[], deferredFrom?: string): void {
    this.sql.exec("UPDATE proposals SET plan_json = ?, decisions_json = '{}', deferred_from = ? WHERE id = ?", JSON.stringify(plan), deferredFrom ?? null, id);
  }

  /**
   * Moves a deferred proposal's base Genome from `oldBase` to `newBase` (`provenance.genomeCommit`) in one conditional
   * UPDATE. Requires: status `open`, `deferred_from` set, base still `oldBase`, and no staged approval (a staged
   * candidate pins the old base). False otherwise; nothing is written.
   */
  rebase(id: string, oldBase: string, newBase: string): boolean {
    return this.sql.exec(
      `UPDATE proposals SET json = json_set(json, '$.provenance.genomeCommit', ?), updated_at = ?
       WHERE id = ? AND status = 'open' AND deferred_from IS NOT NULL
         AND json_extract(json, '$.provenance.genomeCommit') = ? AND json_extract(json, '$.stagedApproval') IS NULL RETURNING id`,
      newBase, nowIso(), id, oldBase,
    ).toArray().length > 0;
  }
}
