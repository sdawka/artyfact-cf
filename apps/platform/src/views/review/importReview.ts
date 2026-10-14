import type { SystemImportReview, ProposalPlanNode } from "../../../shared/api";
import { cascade, rollupPlan, walk, type Decision } from "../work/intent/agreement";

/** Where an import review's decisions stand: what accept sends and why it cannot yet. */
export interface ImportDecisions {
  /** Every node whose effective decision is reject (own or inherited): `rejectedNodes` of the accept. */
  rejected: string[];
  agreed: number;
  /** Nodes with no decision of their own or from an ancestor. */
  undecided: string[];
  /** Agreed nodes under a rejected ancestor: removing the ancestor would remove them too. */
  orphaned: { node: string; under: string }[];
  total: number;
}

/** The import tree's nodes each with its effective decision; see {@link ImportDecisions}. */
export function importDecisions(plan: readonly ProposalPlanNode[]): ImportDecisions {
  const rollups = rollupPlan(plan);
  const out: ImportDecisions = { rejected: [], agreed: 0, undecided: [], orphaned: [], total: 0 };
  const visit = (n: ProposalPlanNode, rejectedAncestor: string | undefined) => {
    const d = rollups.get(n.id)?.effective;
    out.total++;
    if (d === "reject") out.rejected.push(n.id);
    else if (d === "agree") {
      out.agreed++;
      if (rejectedAncestor) out.orphaned.push({ node: n.id, under: rejectedAncestor });
    } else out.undecided.push(n.id);
    for (const c of n.children) visit(c, d === "reject" && !rejectedAncestor ? n.id : rejectedAncestor);
  };
  for (const n of plan) visit(n, undefined);
  return out;
}

/** Why "Accept import" is disabled, or null when it can be sent. */
export function acceptImportBlocker(d: ImportDecisions, titleOf: (id: string) => string): string | null {
  if (d.undecided.length) {
    return `${d.undecided.length} node${d.undecided.length === 1 ? " is" : "s are"} undecided. Agree or reject every node (deciding a Thing decides everything under it).`;
  }
  const o = d.orphaned[0];
  if (o) return `${titleOf(o.node)} is agreed but sits under rejected ${titleOf(o.under)}, whose removal would remove it too. Reject it as well, or agree ${titleOf(o.under)}.`;
  return null;
}

/** "14 nodes: 13 agreed · 1 rejected" (and "· 2 undecided" while any are). */
export function importSummary(d: ImportDecisions): string {
  const parts = [`${d.agreed} agreed`, `${d.rejected.length} rejected`, ...(d.undecided.length ? [`${d.undecided.length} undecided`] : [])];
  return `${d.total} node${d.total === 1 ? "" : "s"}: ${parts.join(" · ")}`;
}

/** An accepted review's tree with its recorded outcome: the roots agreed, the rejected nodes rejected. */
export function decidedTree(review: Pick<SystemImportReview, "tree" | "rejectedNodes">): ProposalPlanNode[] {
  let plan = review.tree;
  for (const n of review.tree) plan = cascade(plan, n.id, "agree" satisfies Decision);
  const rejected = new Set(review.rejectedNodes ?? []);
  // Tree order puts ancestors first, so a rejected descendant keeps its own decision after its ancestor's.
  for (const n of walk(review.tree)) if (rejected.has(n.id)) plan = cascade(plan, n.id, "reject");
  return plan;
}
