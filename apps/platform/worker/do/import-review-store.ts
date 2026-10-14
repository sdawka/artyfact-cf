/**
 * The System import review (table `import_review`, one row): the imported Genome as an agreement tree, held by the
 * SystemAuthority DO. Storage only; building, accepting and guarding live in worker/import-review.ts. Contract:
 * docs/design/lifecycle.md, "Contract addendum".
 */
import type { ProposalPlanNode, SystemImportReview, SystemImportReviewStatus, SystemSummary } from "../../shared/api";
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;

export class ImportReviewStore {
  constructor(private readonly sql: SqlStorage) {}

  private row(): Row | undefined {
    return (this.sql.exec("SELECT * FROM import_review WHERE id = 1").toArray() as Row[])[0];
  }

  /** The stored review; null when the System has none. */
  get(): SystemImportReview | null {
    const r = this.row();
    return r ? (JSON.parse(String(r.json)) as SystemImportReview) : null;
  }

  /** Replaces the review (null deletes it). Returns whether a row was written or deleted. */
  set(review: SystemImportReview | null): boolean {
    if (!review) return this.sql.exec("DELETE FROM import_review WHERE id = 1 RETURNING id").toArray().length > 0;
    this.sql.exec(
      `INSERT INTO import_review (id, status, genome_commit, json, updated_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, genome_commit = excluded.genome_commit, json = excluded.json, updated_at = excluded.updated_at`,
      review.status, review.genomeCommit, JSON.stringify(review), nowIso(),
    );
    return true;
  }

  /**
   * Compare-and-set in one conditional UPDATE: writes `next` only while the stored review has `expectedStatus` and
   * `expectedGenomeCommit`. False when there is no review or either differs (nothing is written).
   */
  cas(expectedStatus: SystemImportReviewStatus, expectedGenomeCommit: string, next: SystemImportReview): boolean {
    return this.sql.exec(
      `UPDATE import_review SET status = ?, genome_commit = ?, json = ?, updated_at = ?
       WHERE id = 1 AND status = ? AND genome_commit = ? RETURNING id`,
      next.status, next.genomeCommit, JSON.stringify(next), nowIso(), expectedStatus, expectedGenomeCommit,
    ).toArray().length > 0;
  }

  /** The summary's `importReview`: status, commit and the number of tree nodes. */
  summary(): NonNullable<SystemSummary["importReview"]> | null {
    const review = this.get();
    if (!review) return null;
    const count = (ns: ProposalPlanNode[]): number => ns.reduce((n, x) => n + 1 + count(x.children ?? []), 0);
    return { status: review.status, genomeCommit: review.genomeCommit, nodes: count(review.tree ?? []) };
  }
}
