import type { SemanticDelta } from "@artyfact/semantic";
import type { ProposalPlanNode, ProposedOp, ProposedOpKind } from "../../../../../shared/api";
import type { ModelIndex } from "@/model/index";
import { withDependencies } from "../lib";

/** An admin's call on a plan node. */
export type Decision = NonNullable<ProposalPlanNode["decision"]>;
/** What a node's subtree adds up to: one decision for all its ops, `mixed`, or `undecided`. */
export type Rollup = Decision | "mixed" | "undecided";
export const ROLLUP_WORD: Record<Rollup, string> = { agree: "agreed", reject: "rejected", defer: "deferred", mixed: "mixed", undecided: "undecided" };
export type ChangeCounts = Partial<Record<ProposedOpKind, number>>;

export interface NodeRollup {
  /** The node's own decision, else its nearest decided ancestor's. */
  effective?: Decision;
  /** True when `effective` comes from an ancestor. */
  inherited: boolean;
  rollup: Rollup;
  /** Ops in the subtree per effective decision. */
  tally: Record<Decision | "undecided", number>;
  /** Ops in the subtree per verb ("3 add · 2 update"). */
  changes: ChangeCounts;
  ops: number;
}

const VERBS: ProposedOpKind[] = ["add", "update", "remove", "link", "unlink"];

/** "3 add · 2 update · 1 remove"; empty for no changes. */
export const countsText = (c: ChangeCounts) => VERBS.filter((v) => c[v]).map((v) => `${c[v]} ${v}`).join(" · ");

/** Every node, depth-first. */
export function walk(plan: readonly ProposalPlanNode[]): ProposalPlanNode[] {
  return plan.flatMap((n) => [n, ...walk(n.children)]);
}

/**
 * Per node: its effective decision (own, else inherited), the subtree's op tally and verb counts, and the rollup word.
 * Ops missing from `ops` (an import review tree has none) count as `add`.
 */
export function rollupPlan(plan: readonly ProposalPlanNode[], ops: readonly ProposedOp[] = []): Map<string, NodeRollup> {
  const verb = new Map(ops.map((o) => [o.id, o.op]));
  const out = new Map<string, NodeRollup>();
  const visit = (n: ProposalPlanNode, inherited: Decision | undefined): NodeRollup => {
    const effective = n.decision ?? inherited;
    const r: NodeRollup = { effective, inherited: !n.decision && !!inherited, rollup: "undecided", tally: { agree: 0, reject: 0, defer: 0, undecided: 0 }, changes: {}, ops: 0 };
    for (const id of n.opIds) {
      r.tally[effective ?? "undecided"]++;
      const v = verb.get(id) ?? "add";
      r.changes[v] = (r.changes[v] ?? 0) + 1;
      r.ops++;
    }
    for (const c of n.children) {
      const cr = visit(c, effective);
      for (const k of Object.keys(r.tally) as (keyof NodeRollup["tally"])[]) r.tally[k] += cr.tally[k];
      for (const v of VERBS) if (cr.changes[v]) r.changes[v] = (r.changes[v] ?? 0) + cr.changes[v]!;
      r.ops += cr.ops;
    }
    const buckets = (Object.keys(r.tally) as (keyof NodeRollup["tally"])[]).filter((k) => r.tally[k] > 0);
    r.rollup = r.ops === 0 ? (effective ?? "undecided") : buckets.length === 1 ? buckets[0]! : "mixed";
    out.set(n.id, r);
    return r;
  };
  for (const n of plan) visit(n, undefined);
  return out;
}

/**
 * The plan after deciding `nodeId`: a decision clears every descendant's explicit decision (they inherit it; one
 * decided afterwards overrides it and the parent rolls up as mixed); `null` clears the node's own only.
 */
export function cascade(plan: readonly ProposalPlanNode[], nodeId: string, decision: Decision | null): ProposalPlanNode[] {
  const strip = (n: ProposalPlanNode): ProposalPlanNode => {
    const { decision: _drop, ...rest } = n;
    return { ...rest, children: n.children.map(strip) };
  };
  const apply = (n: ProposalPlanNode): ProposalPlanNode => {
    if (n.id !== nodeId) return { ...n, children: n.children.map(apply) };
    if (decision === null) {
      const { decision: _drop, ...rest } = n;
      return rest;
    }
    return { ...n, decision, children: n.children.map(strip) };
  };
  return plan.map(apply);
}

/** Each op's effective decision (`undefined` when undecided) and the node that owns it. */
export function opDecisions(plan: readonly ProposalPlanNode[]): Map<string, { node: string; decision?: Decision }> {
  const out = new Map<string, { node: string; decision?: Decision }>();
  const visit = (n: ProposalPlanNode, inherited: Decision | undefined) => {
    const d = n.decision ?? inherited;
    for (const id of n.opIds) out.set(id, { node: n.id, ...(d && { decision: d }) });
    for (const c of n.children) visit(c, d);
  };
  for (const n of plan) visit(n, undefined);
  return out;
}

export interface AcceptSet {
  /** Ops to send to accept, in proposal order: agreed and not blocked. */
  opIds: string[];
  /** Agreed ops left out because something they (transitively) need is not agreed, with what they need. */
  blocked: Map<string, string[]>;
  /** Ops whose node (and every ancestor) is undecided. */
  undecided: string[];
  agreed: string[];
  rejected: string[];
  deferred: string[];
}

/**
 * Agreed nodes' ops minus those blocked by a dependency outside the agreed set (rejected, deferred or undecided); the
 * result is closed under `withDependencies`, so every op it holds has what it needs. Ops in no node are ignored.
 */
export function acceptSet(plan: readonly ProposalPlanNode[], ops: readonly ProposedOp[]): AcceptSet {
  const dec = opDecisions(plan);
  const known = new Set(ops.map((o) => o.id));
  const of = (d: Decision | undefined) => ops.filter((o) => dec.has(o.id) && dec.get(o.id)!.decision === d).map((o) => o.id);
  const agreed = of("agree");
  const ok = new Set(agreed);
  const blocked = new Map<string, string[]>();
  for (const id of agreed) {
    const missing = [...withDependencies(ops, [id])].filter((d) => d !== id && known.has(d) && !ok.has(d));
    if (missing.length) blocked.set(id, missing);
  }
  return {
    opIds: agreed.filter((id) => !blocked.has(id)),
    blocked,
    undecided: of(undefined),
    agreed,
    rejected: of("reject"),
    deferred: of("defer"),
  };
}

/** Per node: the nodes owning a rejected or deferred op that one of the node's agreed ops needs ("needs X"). */
export function blockedBy(plan: readonly ProposalPlanNode[], ops: readonly ProposedOp[]): Map<string, string[]> {
  const dec = opDecisions(plan);
  const out = new Map<string, string[]>();
  for (const [opId, needs] of acceptSet(plan, ops).blocked) {
    const owner = dec.get(opId)!.node;
    const by = needs.map((n) => dec.get(n)).filter((d) => d?.decision === "reject" || d?.decision === "defer").map((d) => d!.node);
    const all = new Set([...(out.get(owner) ?? []), ...by.filter((b) => b !== owner)]);
    if (all.size) out.set(owner, [...all]);
  }
  return out;
}

/** Ops no plan node owns. */
export function uncoveredOps(plan: readonly ProposalPlanNode[], ops: readonly ProposedOp[]): ProposedOp[] {
  const covered = new Set(walk(plan).flatMap((n) => n.opIds));
  return ops.filter((o) => !covered.has(o.id));
}

/** Open everything when the plan has at most `limit` nodes owning ops; otherwise only the roots. */
export function initialExpanded(plan: readonly ProposalPlanNode[], limit = 5): Set<string> {
  const all = walk(plan);
  if (all.filter((n) => n.opIds.length).length <= limit) return new Set(all.filter(expandable).map((n) => n.id));
  return new Set(plan.map((n) => n.id));
}

/** A node opens when it has child nodes or ops of its own. */
export const expandable = (n: ProposalPlanNode) => n.children.length > 0 || n.opIds.length > 0;

export interface PlanRow {
  node: ProposalPlanNode;
  level: number;
  parent?: string;
  setSize: number;
  posInSet: number;
}

/** The visible nodes in tree order (children only under expanded nodes): the keyboard's navigation order. */
export function flatten(plan: readonly ProposalPlanNode[], expanded: ReadonlySet<string>): PlanRow[] {
  const rows: PlanRow[] = [];
  const visit = (list: readonly ProposalPlanNode[], level: number, parent: string | undefined) =>
    list.forEach((node, i) => {
      rows.push({ node, level, ...(parent && { parent }), setSize: list.length, posInSet: i + 1 });
      if (expanded.has(node.id)) visit(node.children, level + 1, node.id);
    });
  visit(plan, 1, undefined);
  return rows;
}

export const OTHER_NODE = { id: "other", kind: "other", title: "Other changes" } as const;

/**
 * The agreement tree for `ops` from the model index, the same tree the platform stores on a proposal (`planOf` in
 * worker/intents.ts; test/fixtures/plan-tree.ts holds the cases both must agree on): rooted at Things, or at the System
 * root for a node outside every Thing; each op in the node it touches (`add` under its parent, else the System root,
 * with the proposed title and kind; `link`/`unlink` on their `from` node), ancestors as op-less nodes, `path` the
 * containment chain from the System root to the node inclusive, `summary` the subtree's verb counts. Ops on nodes the
 * index cannot place go under a trailing "Other changes" node.
 */
export function planFromOps(ops: readonly ProposedOp[], index: ModelIndex): ProposalPlanNode[] {
  const root = index.model.system.id;
  const minted = new Map(ops.filter((o) => o.op === "add").map((o) => [o.node, o]));
  const chain = (id: string, seen: Set<string>): string[] | null => {
    if (id === root) return [root];
    if (index.byId(id)) {
      const p = index.path(id).map((e) => e.id);
      return p[0] === root ? p : null;
    }
    const add = minted.get(id);
    if (!add || seen.has(id)) return null;
    const up = chain(add.parent ?? root, seen.add(id));
    return up && [...up, id];
  };
  const kindOf = (id: string) => index.byId(id)?.kind ?? minted.get(id)?.kind ?? "node";
  const nodes = new Map<string, ProposalPlanNode>();
  const roots: ProposalPlanNode[] = [];
  const other: ProposalPlanNode = { ...OTHER_NODE, path: [], summary: "", opIds: [], children: [] };
  const make = (id: string, path: string[]): ProposalPlanNode => {
    const e = index.byId(id);
    const add = minted.get(id);
    const named = add?.fields?.title ?? add?.fields?.name;
    const title = typeof named === "string" && named.trim() ? named.trim() : e?.name || id;
    return { id, kind: kindOf(id), title, path, summary: "", opIds: [], children: [] };
  };
  for (const op of ops) {
    const full = chain(op.node, new Set());
    if (!full) {
      other.opIds.push(op.id);
      continue;
    }
    const thing = full.findIndex((id) => kindOf(id) === "thing");
    const start = thing === -1 ? 0 : thing;
    let parent: ProposalPlanNode | undefined;
    for (let i = start; i < full.length; i++) {
      const id = full[i]!;
      let n = nodes.get(id);
      if (!n) {
        n = make(id, full.slice(0, i + 1));
        nodes.set(id, n);
        (parent ? parent.children : roots).push(n);
      }
      parent = n;
    }
    parent!.opIds.push(op.id);
  }
  if (other.opIds.length) roots.push(other);
  const rollups = rollupPlan(roots, ops);
  for (const n of walk(roots)) n.summary = countsText(rollups.get(n.id)!.changes);
  return roots;
}

/**
 * The agreement tree for a Genome amendment's semantic delta (amendment review): one op per change (`add` when it
 * had no before, `remove` when it has no after, else `update`), placed by `planFromOps`. Returns the ops too, so the
 * tree's counts and op views have them.
 */
export function planFromDelta(delta: SemanticDelta, index: ModelIndex): { plan: ProposalPlanNode[]; ops: ProposedOp[] } {
  const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);
  const ops = delta.changes.map((c, i): ProposedOp => {
    const before = rec(c.before);
    const after = rec(c.after);
    const op: ProposedOpKind = !before ? "add" : !after ? "remove" : "update";
    const parent = typeof after?.parent === "string" ? after.parent : undefined;
    const name = after?.title ?? after?.name ?? rec(after?.fields)?.title;
    return {
      id: `change.${i + 1}`,
      op,
      node: c.id,
      kind: c.kind,
      ...(parent && { parent }),
      ...(op === "add" && typeof name === "string" && { fields: { title: name } }),
    };
  });
  return { plan: planFromOps(ops, index), ops };
}
