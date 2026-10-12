import { derivationKey, type Result } from "./engine";
import type { Tuple } from "./types";

export interface DerivationTree {
  relation: string;
  tuple: Tuple;
  /** "<program>:<line>" of the rule used; absent for EDB facts. */
  rule?: string;
  /** True when no derivation is recorded: an input fact (or a tuple not in the result). */
  edb: boolean;
  children: DerivationTree[];
  /** Number of recorded derivations; the tree follows the first. */
  alternatives?: number;
  truncated?: boolean;
  cycle?: boolean;
}

export function explain(result: Result, relation: string, tuple: Tuple, depth = 6): DerivationTree {
  const walk = (rel: string, t: Tuple, left: number, path: Set<string>): DerivationTree => {
    const key = derivationKey(rel, t);
    const ds = result.derivations.get(key);
    if (!ds?.length) return { relation: rel, tuple: t, edb: true, children: [] };
    const d = ds[0];
    const node: DerivationTree = { relation: rel, tuple: t, rule: d.rule, edb: false, children: [], alternatives: ds.length };
    if (path.has(key)) return { ...node, cycle: true };
    if (left <= 0) return { ...node, truncated: true };
    path.add(key);
    node.children = d.body.map((b) => walk(b.relation, b.tuple, left - 1, path));
    path.delete(key);
    return node;
  };
  return walk(relation, tuple, depth, new Set());
}
