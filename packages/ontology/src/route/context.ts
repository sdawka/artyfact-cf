import { linkKey, type Graph, type GraphLink } from "../graph/graph.ts";
import { buildSlice, type SliceNode } from "../judge/slice.ts";
import type { RouteVocabularySource } from "./route.ts";
import type { Route, RouteSlice, RouteVocabulary } from "./types.ts";

export interface RouteSliceOptions { hops?: number; textCap?: number; maxNodes?: number }

/**
 * What the translator sees: the route's target nodes (else its related nodes), their parent chains and the nodes
 * within `hops` links either way, `source.*` fields dropped, at most `maxNodes` nodes with targets and parents first.
 * Never the whole graph.
 */
export function routeSlice(g: Graph, r: Route, o: RouteSliceOptions = {}): RouteSlice {
  const seeds = r.target.nodes.length ? r.target.nodes : r.target.related;
  const hops = o.hops ?? 1, textCap = o.textCap ?? 300, maxNodes = o.maxNodes ?? 40;
  const first: SliceNode[] = [], rest: SliceNode[] = [];
  const links = new Map<string, GraphLink>();
  const trim = (n: SliceNode): SliceNode => ({ ...n, fields: Object.fromEntries(Object.entries(n.fields).filter(([k]) => !k.startsWith("source."))) });
  for (const seed of seeds) {
    const s = buildSlice(g, seed, { parents: true, hops, direction: "both", children: false, textCap }, { rule: "route", text: r.message });
    if (!("missing" in s.subject)) first.push(trim(s.subject));
    first.push(...s.parents.map(trim));
    rest.push(...s.nodes.map(trim));
    for (const l of s.links) links.set(linkKey(l), l);
  }
  const nodes = new Map<string, SliceNode>();
  for (const n of [...first, ...rest]) if (!nodes.has(n.id) && nodes.size < maxNodes) nodes.set(n.id, n);
  return {
    targets: seeds.filter((id) => nodes.has(id)),
    nodes: [...nodes.values()],
    links: [...links.values()].filter((l) => nodes.has(l.from) && nodes.has(l.to)),
  };
}

/** Kinds in the slice and the route's kind, and the template relations touching any of them (`ws.*` bookkeeping left out). */
export function routeVocabulary(template: RouteVocabularySource, r: Route, slice: RouteSlice): RouteVocabulary {
  const kinds = [...new Set([...(r.target.kind ? [r.target.kind] : []), ...slice.nodes.map((n) => n.kind)])].filter((k) => !k.startsWith("ws."));
  const relations = Object.fromEntries(Object.entries(template.relations)
    .filter(([rel, e]) => !rel.startsWith("ws.") && (e.from.some((k) => kinds.includes(k)) || e.to.some((k) => kinds.includes(k))))
    .map(([rel, e]) => [rel, { from: [...e.from], to: [...e.to] }]));
  return { kinds, relations };
}
