import { useMemo } from "react";
import type { Finding } from "@artyfact/model";
import { useReadiness } from "@/api/queries";
import { LAYERED_RIGHT, partition, type LayoutRequest } from "@/graph/elk";
import type { ModelIndex } from "@/model/index";
import type { AnyKind, Certainty, Criterion, JourneyStep, Relation } from "@/model/types";
import { useModel } from "@/model/useModel";
import type { Layer } from "@/model/useSelection";

/**
 * Semantic zoom. The Map shows one containment `scope` (a group node) with its children nested,
 * plus whatever those children (or their descendants, lifted to the child) link to: other System
 * nodes as `outside` and Externals as `external`. Containment is nesting, never an edge.
 */
export type MapRole = "scope" | "child" | "outside" | "external";

export interface MapNode {
  id: string;
  kind: AnyKind;
  name: string;
  role: MapRole;
  /** The scope id for `child` nodes (React Flow parent). */
  parentId?: string;
  /** Containment children of this node (a child with children can be opened). */
  childCount: number;
}

export type EdgeStroke = "solid" | "dashed" | "dotted";

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  type: Relation;
  /** Least certain certainty among the aggregated links. */
  certainty: Certainty;
  stroke: EdgeStroke;
  /** Model links folded into this edge (descendant links lifted to a visible child). */
  count: number;
  label?: string;
}

export interface MapFilterState {
  /** Node kinds hidden among children and outside nodes. */
  hiddenKinds: string[];
  /** Relations hidden. */
  hiddenLinks: string[];
  showExternals: boolean;
  /** Keep only nodes whose subtree is the subject of a readiness finding. */
  findingsOnly: boolean;
}

export const DEFAULT_FILTERS: MapFilterState = { hiddenKinds: [], hiddenLinks: [], showExternals: true, findingsOnly: false };

export interface MapGraph {
  scope: string;
  nodes: MapNode[];
  edges: MapEdge[];
  /** Every visible node id (the scope included). */
  ids: ReadonlySet<string>;
}

const STROKE: Record<Certainty, EdgeStroke> = {
  declared: "solid",
  observed: "solid",
  derived: "solid",
  assumed: "dashed",
  hypothesis: "dashed",
  proposed: "dotted",
};
const DOUBT: Record<Certainty, number> = { declared: 0, observed: 0, derived: 1, assumed: 2, hypothesis: 3, proposed: 4 };

/** declared/observed/derived solid, assumed/hypothesis dashed, proposed dotted. */
export const certaintyStroke = (c: Certainty): EdgeStroke => STROKE[c] ?? "solid";

/** The scope the Map shows for `id`: itself if it contains anything, else its container, else the System. */
export function mapScopeFor(index: ModelIndex, id: string | null | undefined): string {
  const root = index.model.system.id;
  const e = id ? index.byId(id) : undefined;
  if (!e) return root;
  switch (e.type) {
    case "system":
    case "thing":
    case "node":
      return index.children(e.id).length ? e.id : (index.parent(e.id)?.id ?? root);
    case "criterion":
      return mapScopeFor(index, (e.item as Criterion).subjectId);
    case "step": {
      const s = e.item as JourneyStep;
      return s.screen ? mapScopeFor(index, s.screen) : root;
    }
    default:
      return root;
  }
}

/** Node ids named by findings (criterion subjects resolve to the criterion's subject). */
export function findingSubjectIds(index: ModelIndex, findings: readonly Pick<Finding, "subject">[]): Set<string> {
  const out = new Set<string>();
  for (const f of findings) {
    if (!f.subject) continue;
    const e = index.byId(f.subject);
    if (e?.type === "criterion") out.add((e.item as Criterion).subjectId);
    else out.add(f.subject);
  }
  return out;
}

export function buildMapGraph(
  index: ModelIndex,
  scope: string,
  filters: MapFilterState = DEFAULT_FILTERS,
  findingSubjects: ReadonlySet<string> = new Set(),
): MapGraph {
  const scopeEntry = index.byId(scope) ?? index.byId(index.model.system.id)!;
  const scopeId = scopeEntry.id;
  const hiddenKinds = new Set(filters.hiddenKinds);
  const hiddenLinks = new Set(filters.hiddenLinks);

  // rep: descendant id -> the visible node that stands for it (a child, or the scope itself)
  const rep = new Map<string, string>([[scopeId, scopeId]]);
  const children = index.children(scopeId);
  for (const c of children) for (const d of index.descendants(c.id)) rep.set(d, c.id);

  const hasFinding = (id: string) => {
    if (!filters.findingsOnly) return true;
    return index.descendants(id).some((d) => findingSubjects.has(d)) || findingSubjects.has(id);
  };
  const keepKind = (kind: string) => !hiddenKinds.has(kind);

  const nodes = new Map<string, MapNode>();
  const node = (id: string, role: MapRole): MapNode | undefined => {
    const e = index.byId(id);
    if (!e) return undefined;
    return { id, kind: e.kind, name: e.name, role, childCount: index.children(id).length, ...(role === "child" && { parentId: scopeId }) };
  };
  nodes.set(scopeId, node(scopeId, "scope")!);
  for (const c of children) if (keepKind(c.kind) && hasFinding(c.id)) nodes.set(c.id, node(c.id, "child")!);

  interface Acc { source: string; target: string; type: Relation; certainty: Certainty; count: number; labels: Set<string> }
  const acc = new Map<string, Acc>();
  const add = (source: string, target: string, type: Relation, certainty: Certainty, label?: string) => {
    const id = `${source}>${type}>${target}`;
    const a = acc.get(id);
    if (!a) acc.set(id, { source, target, type, certainty, count: 1, labels: new Set(label ? [label] : []) });
    else {
      a.count++;
      if (DOUBT[certainty] > DOUBT[a.certainty]) a.certainty = certainty;
      if (label) a.labels.add(label);
    }
  };

  // Admit outside endpoints of links that touch the scope subtree.
  const admit = (id: string): boolean => {
    if (nodes.has(id)) return true;
    const e = index.byId(id);
    if (!e) return false;
    if (e.type === "external") {
      if (!filters.showExternals || !hasFinding(id)) return false;
      nodes.set(id, node(id, "external")!);
      return true;
    }
    if (!keepKind(e.kind) || !hasFinding(id)) return false;
    nodes.set(id, node(id, "outside")!);
    return true;
  };

  const allLinks = index.entries.flatMap((e) => (e.type === "node" || e.type === "external" ? index.crossLinks(e.id, "out") : []));
  const outsidePending: typeof allLinks = [];
  for (const l of allLinks) {
    if ((l.rel as string) === "contains" || hiddenLinks.has(l.rel)) continue;
    const a = rep.get(l.from);
    const b = rep.get(l.to);
    if (a === undefined && b === undefined) {
      outsidePending.push(l);
      continue;
    }
    if (a !== undefined && b !== undefined) {
      if (a !== b && nodes.has(a) && nodes.has(b)) add(a, b, l.rel, l.certainty, l.label);
      continue;
    }
    const inside = (a ?? b)!;
    const other = a === undefined ? l.from : l.to;
    if (!nodes.has(inside) || !admit(other)) continue;
    if (a === undefined) add(other, inside, l.rel, l.certainty, l.label);
    else add(inside, other, l.rel, l.certainty, l.label);
  }
  // Context: links among the outside/external nodes already on screen (never admits new nodes).
  for (const l of outsidePending) if (nodes.has(l.from) && nodes.has(l.to) && l.from !== l.to) add(l.from, l.to, l.rel, l.certainty, l.label);

  const edges: MapEdge[] = [...acc.entries()].map(([id, a]) => ({
    id,
    source: a.source,
    target: a.target,
    type: a.type,
    certainty: a.certainty,
    stroke: certaintyStroke(a.certainty),
    count: a.count,
    ...(a.labels.size === 1 && a.count === 1 && { label: [...a.labels][0] }),
  }));
  return { scope: scopeId, nodes: [...nodes.values()], edges, ids: new Set(nodes.keys()) };
}

/** Graph for the current model, readiness findings and filters; memoised per (scope, filters). */
export function useMapGraph(scope: string, filters: MapFilterState): MapGraph {
  const { index, bundle } = useModel();
  const { data: readiness } = useReadiness();
  const findings = (readiness ?? bundle.readiness)?.modelReadiness?.findings;
  const subjects = useMemo(() => findingSubjectIds(index, findings ?? []), [index, findings]);
  return useMemo(() => buildMapGraph(index, scope, filters, subjects), [index, scope, filters, subjects]);
}

export const NODE_WIDTH = 216;
/** Node heights per layer: overlays add a badge row. */
export const nodeHeight = (layer: Layer) => (layer === "genome" ? 52 : 80);
export const GROUP_PADDING = "[top=72,left=20,bottom=20,right=20]";

/** elk request: externals in partition 0 (left), the scope group and outside nodes in partition 1. */
export function mapLayoutRequest(graph: MapGraph, layer: Layer): LayoutRequest {
  const h = nodeHeight(layer);
  const nodes: LayoutRequest["nodes"] = [];
  const order: MapRole[] = ["external", "scope", "outside", "child"];
  for (const role of order) {
    for (const n of graph.nodes) {
      if (n.role !== role) continue;
      if (role === "scope") {
        nodes.push({ id: n.id, width: NODE_WIDTH, height: h, layoutOptions: { ...partition(1), "elk.padding": GROUP_PADDING } });
      } else if (role === "child") {
        nodes.push({ id: n.id, width: NODE_WIDTH, height: h, parentId: n.parentId! });
      } else {
        nodes.push({ id: n.id, width: NODE_WIDTH, height: role === "external" ? 52 : h, layoutOptions: partition(role === "external" ? 0 : 1) });
      }
    }
  }
  return {
    layoutOptions: { ...LAYERED_RIGHT, "elk.partitioning.activate": "true", "elk.layered.spacing.nodeNodeBetweenLayers": "112", "elk.spacing.edgeEdge": "20", "elk.layered.spacing.edgeEdgeBetweenLayers": "20", "elk.layered.spacing.edgeNodeBetweenLayers": "24", "elk.padding": "[top=24,left=24,bottom=24,right=24]" },
    nodes,
    // Externals sit left of the boundary: edges into them are laid out reversed so they flow left to right.
    edges: graph.edges.map((e) =>
      layoutReversed(graph, e) ? { id: e.id, source: e.target, target: e.source } : { id: e.id, source: e.source, target: e.target },
    ),
  };
}

/** True when `mapLayoutRequest` hands elk this edge reversed (its route must be flipped back). */
export function layoutReversed(graph: MapGraph, e: MapEdge): boolean {
  const role = (id: string) => graph.nodes.find((n) => n.id === id)?.role;
  return role(e.target) === "external" && role(e.source) !== "external";
}
