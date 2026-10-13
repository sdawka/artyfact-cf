import { canon } from "../canon.ts";
import { linkKey, parseGraph, type Graph, type GraphLink, type GraphNode } from "../graph/graph.ts";
import type { Readiness } from "./evaluate.ts";
import type { Finding } from "./findings.ts";

export interface GraphDelta {
  nodes: { added: string[]; removed: string[]; changed: { id: string; fields: string[] }[] };
  links: { added: GraphLink[]; removed: GraphLink[]; changed: { from: string; rel: string; to: string; certainty: [string | null, string | null] }[] };
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

const facets = (n: GraphNode): Record<string, unknown> => ({
  kind: n.kind, parent: n.parent, provisional: n.provisional ?? false,
  ...Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [`fields.${k}`, v])),
});

/** Structural delta between two graphs: nodes by id, links by (from, rel, to). */
export function diff(rawA: Graph | unknown, rawB: Graph | unknown): GraphDelta {
  const a = parseGraph(rawA), b = parseGraph(rawB);
  const A = new Map(a.nodes.map((n) => [n.id, n])), B = new Map(b.nodes.map((n) => [n.id, n]));
  const changed: GraphDelta["nodes"]["changed"] = [];
  for (const id of sorted([...A.keys()].filter((id) => B.has(id)))) {
    const x = facets(A.get(id)!), y = facets(B.get(id)!);
    const fields = sorted([...Object.keys(x), ...Object.keys(y)]).filter((k) => canon(x[k]) !== canon(y[k]));
    if (fields.length) changed.push({ id, fields });
  }
  const LA = new Map(a.links.map((l) => [linkKey(l), l])), LB = new Map(b.links.map((l) => [linkKey(l), l]));
  const only = (X: Map<string, GraphLink>, Y: Map<string, GraphLink>) => sorted([...X.keys()].filter((k) => !Y.has(k))).map((k) => X.get(k)!);
  const linkChanges = sorted([...LA.keys()].filter((k) => LB.has(k)))
    .map((k) => [LA.get(k)!, LB.get(k)!] as const)
    .filter(([x, y]) => x.certainty !== y.certainty)
    .map(([x, y]) => ({ from: x.from, rel: x.rel, to: x.to, certainty: [x.certainty ?? null, y.certainty ?? null] as [string | null, string | null] }));
  return {
    nodes: { added: sorted([...B.keys()].filter((id) => !A.has(id))), removed: sorted([...A.keys()].filter((id) => !B.has(id))), changed },
    links: { added: only(LB, LA), removed: only(LA, LB), changed: linkChanges },
  };
}

const findingKey = (f: Finding) => JSON.stringify([f.level, f.rule, f.subject ?? "", f.pack ?? ""]);

/** Findings present in `b` but not `a` (appeared) and in `a` but not `b` (resolved). */
export function diffFindings(a: Readiness, b: Readiness): { appeared: Finding[]; resolved: Finding[] } {
  const ka = new Set(a.findings.map(findingKey)), kb = new Set(b.findings.map(findingKey));
  return { appeared: b.findings.filter((f) => !ka.has(findingKey(f))), resolved: a.findings.filter((f) => !kb.has(findingKey(f))) };
}
