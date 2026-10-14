import { useMemo } from "react";
import type { Finding } from "@artyfact/model";
import { useReadiness } from "@/api/queries";
import { LAYERED_RIGHT, partition, type LayoutRequest } from "@/graph/elk";
import type { ModelIndex } from "@/model/index";
import { kindViews, type KindViews } from "@/model/kinds";
import type { Certainty, Criterion, JourneyStep, Relation } from "@/model/types";
import { useModel } from "@/model/useModel";
import type { Layer } from "@/model/useSelection";

/** Environment shows the System boundary and every external. Entered scopes preserve real
 * immediate containment; descendant links are lifted without discarding their original members. */
export const ENVIRONMENT_SCOPE = "environment";

export type MapRole = "scope" | "child" | "outside" | "external";

export interface MapNode {
  id: string;
  kind: string;
  name: string;
  role: MapRole;
  description: string;
  /** Bounded preview of immediate real containment children. */
  preview: Array<{ id: string; name: string; kind: string }>;
  /** The band (template layer id, or `depth-<n>`) a `child` is drawn in. */
  band?: string;
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
  /** Original links with direction normalized, before endpoints are lifted. */
  members: Array<{ from: string; to: string; rel: Relation; certainty: Certainty; label?: string }>;
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
  /** Template layers (bands) hidden. */
  hiddenLayers: string[];
}

export const DEFAULT_FILTERS: MapFilterState = { hiddenKinds: [], hiddenLinks: [], showExternals: true, findingsOnly: false, hiddenLayers: [] };

export interface MapBand {
  id: string;
  label: string;
}

export interface MapGraph {
  scope: string;
  nodes: MapNode[];
  edges: MapEdge[];
  /** Every visible node id (the scope included). */
  ids: ReadonlySet<string>;
  /** Bands of the children, in drawing order; only bands that hold a child. */
  bands: MapBand[];
  /** True when the bands are template layers (drawn as labelled frames); false for depth bands. */
  layered: boolean;
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
    case "purpose":
    case "claim":
    case "feature":
    case "commitment":
    case "journey":
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

/**
 * Where `id` sits on the Map: itself for the System, things, nodes, Externals and the Genome tree's
 * intent and journey nodes; a criterion's subject; a step's screen. `null` for objects with no
 * place on the Map (requirements, hooks, evolutions, ...), whose focus must not move the Map.
 */
export function mapLocationFor(index: ModelIndex, id: string | null | undefined): string | null {
  const e = id ? index.byId(id) : undefined;
  if (!e) return null;
  switch (e.type) {
    case "system":
    case "thing":
    case "node":
    case "external":
    case "purpose":
    case "claim":
    case "feature":
    case "commitment":
    case "journey":
      return e.id;
    case "criterion":
      return mapLocationFor(index, (e.item as Criterion).subjectId);
    case "step":
      return mapLocationFor(index, (e.item as JourneyStep).screen);
    default:
      return null;
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
  views: KindViews = kindViews(index.model),
): MapGraph {
  const environment = scope === ENVIRONMENT_SCOPE;
  const scopeEntry = index.byId(scope) ?? index.byId(index.model.system.id)!;
  const scopeId = scopeEntry.id;
  const hiddenKinds = new Set(filters.hiddenKinds);
  const hiddenLinks = new Set(filters.hiddenLinks);
  const layered = views.layers.length > 0;
  const layerIds = new Set(views.layers.map((l) => l.id));
  const bandOf = (id: string, kind: string) => (layered && layerIds.has(views.of(kind).layer ?? "") ? views.of(kind).layer! : `depth-${index.path(id).length}`);

  // Layers decorate containment; they never choose or skip actual containers.
  const children = environment ? [] : index.children(scopeId);

  // rep: descendant id -> the visible node that stands for it (a child, or the scope itself)
  const rep = new Map<string, string>(index.descendants(scopeId).map((d) => [d, scopeId]));
  for (const c of children) for (const d of index.descendants(c.id)) rep.set(d, c.id);

  const hasFinding = (id: string) => {
    if (!filters.findingsOnly) return true;
    return index.descendants(id).some((d) => findingSubjects.has(d)) || findingSubjects.has(id);
  };
  const keepKind = (kind: string) => !hiddenKinds.has(kind);
  const hiddenLayers = new Set(filters.hiddenLayers);

  const nodes = new Map<string, MapNode>();
  const node = (id: string, role: MapRole): MapNode | undefined => {
    const e = index.byId(id);
    if (!e) return undefined;
    const item = e.item as { description?: unknown; purpose?: unknown; statement?: unknown; summary?: unknown; modeled?: unknown };
    const authored = [item.description, item.purpose, item.statement, item.summary, item.modeled].find((value) => typeof value === "string" && value.trim());
    const description = typeof authored === "string" ? authored : e.type === "system" ? (index.model.description?.narrative ?? "") : "";
    const direct = index.children(id);
    return {
      id, kind: e.kind, name: e.name, role, childCount: direct.length, description,
      preview: direct.slice(0, 3).map(({ id, name, kind }) => ({ id, name, kind })),
      ...(role === "child" && !environment && { parentId: scopeId, band: bandOf(id, e.kind) }),
    };
  };
  nodes.set(scopeId, node(scopeId, environment ? "child" : "scope")!);
  if (environment) for (const e of index.model.externals ?? []) nodes.set(e.id, node(e.id, "external")!);
  for (const c of children) {
    if (!keepKind(c.kind) || !hasFinding(c.id)) continue;
    const n = node(c.id, "child")!;
    if (!hiddenLayers.has(n.band!)) nodes.set(c.id, n);
  }

  interface Acc { source: string; target: string; type: Relation; certainty: Certainty; count: number; labels: Set<string>; members: MapEdge["members"] }
  const acc = new Map<string, Acc>();
  const add = (source: string, target: string, member: MapEdge["members"][number]) => {
    const { rel: type, certainty, label } = member;
    const id = `${source}>${type}>${target}`;
    const a = acc.get(id);
    if (!a) acc.set(id, { source, target, type, certainty, count: 1, labels: new Set(label ? [label] : []), members: [{ ...member }] });
    else {
      a.count++;
      a.members.push({ ...member });
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
    if (!keepKind(e.kind) || !hasFinding(id) || (layered && hiddenLayers.has(views.of(e.kind).layer!))) return false;
    nodes.set(id, node(id, "outside")!);
    return true;
  };

  // Every link once: `crossLinks(id, "out")` is keyed by the normalised source, which may be any entry
  // (a `direction: "in"` link can point from a thing or the System).
  const allLinks = index.entries.flatMap((e) => index.crossLinks(e.id, "out"));
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
      if (a !== b && nodes.has(a) && nodes.has(b)) add(a, b, l);
      continue;
    }
    const inside = (a ?? b)!;
    const other = a === undefined ? l.from : l.to;
    if (!nodes.has(inside) || !admit(other)) continue;
    if (a === undefined) add(other, inside, l);
    else add(inside, other, l);
  }
  // Context: links among the outside/external nodes already on screen (never admits new nodes).
  for (const l of outsidePending) if (nodes.has(l.from) && nodes.has(l.to) && l.from !== l.to) add(l.from, l.to, l);

  const edges: MapEdge[] = [...acc.entries()].map(([id, a]) => ({
    id,
    source: a.source,
    target: a.target,
    type: a.type,
    certainty: a.certainty,
    stroke: certaintyStroke(a.certainty),
    count: a.count,
    members: a.members,
    ...(a.labels.size === 1 && a.count === 1 && { label: [...a.labels][0] }),
  }));
  const held = new Set([...nodes.values()].map((n) => n.band).filter(Boolean));
  const bands: MapBand[] = layered
    ? [...views.layers.filter((l) => held.has(l.id)).map(({ id, label }) => ({ id, label })), ...[...held].filter((id) => !layerIds.has(id!)).map((id) => ({ id: id!, label: `Depth ${id!.slice("depth-".length)}` }))]
    : [...held].map((id) => ({ id: id!, label: `Depth ${id!.slice("depth-".length)}` })).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { scope: environment ? ENVIRONMENT_SCOPE : scopeId, nodes: [...nodes.values()], edges, ids: new Set(nodes.keys()), bands, layered };
}

/** Subjects of the current readiness findings (API readiness, else the bundle's); one source for filter and count. */
export function useFindingSubjects(): Set<string> {
  const { index, bundle } = useModel();
  const { data: readiness } = useReadiness();
  const findings = (readiness ?? bundle.readiness)?.modelReadiness?.findings;
  return useMemo(() => findingSubjectIds(index, findings ?? []), [index, findings]);
}

/** Graph for the current model, readiness findings and filters; memoised per (scope, filters, findings). */
export function useMapGraph(scope: string, filters: MapFilterState): MapGraph {
  const { index } = useModel();
  const subjects = useFindingSubjects();
  return useMemo(() => buildMapGraph(index, scope, filters, subjects, kindViews(index.model)), [index, scope, filters, subjects]);
}

export const NODE_WIDTH = 216;
/** Node heights per layer: overlays add a badge row. */
export const nodeHeight = (layer: Layer) => (layer === "genome" ? 52 : 80);
export const GROUP_PADDING = "[top=72,left=20,bottom=20,right=20]";
export const BAND_PADDING = "[top=36,left=12,bottom=12,right=12]";

/** Layout id of the frame that holds a band's children. */
export const bandFrameId = (band: string) => `__band:${band}`;

/**
 * elk request: externals in partition 0 (left), the scope group and outside nodes in partition 1. Template bands are
 * frames inside the scope, chained in template order so elk keeps them in sequence along the flow (left to right).
 */
export function mapLayoutRequest(graph: MapGraph, layer: Layer): LayoutRequest {
  const h = nodeHeight(layer);
  const nodes: LayoutRequest["nodes"] = [];
  const frames = graph.layered ? graph.bands.map((b) => bandFrameId(b.id)) : [];
  const order: MapRole[] = ["external", "scope", "outside", "child"];
  for (const role of order) {
    for (const n of graph.nodes) {
      if (n.role !== role) continue;
      if (role === "scope") {
        nodes.push({ id: n.id, width: NODE_WIDTH, height: h, layoutOptions: { ...partition(1), "elk.padding": GROUP_PADDING } });
        for (const f of frames) nodes.push({ id: f, width: NODE_WIDTH, height: h, parentId: n.id, layoutOptions: { "elk.padding": BAND_PADDING } });
      } else if (role === "child") {
        nodes.push({ id: n.id, width: NODE_WIDTH, height: h, parentId: graph.layered ? bandFrameId(n.band!) : n.parentId! });
      } else {
        nodes.push({ id: n.id, width: NODE_WIDTH, height: role === "external" ? 52 : h, layoutOptions: partition(role === "external" ? 0 : 1) });
      }
    }
  }
  return {
    layoutOptions: { ...LAYERED_RIGHT, "elk.partitioning.activate": "true", "elk.layered.spacing.nodeNodeBetweenLayers": "112", "elk.spacing.edgeEdge": "20", "elk.layered.spacing.edgeEdgeBetweenLayers": "20", "elk.layered.spacing.edgeNodeBetweenLayers": "24", "elk.padding": "[top=24,left=24,bottom=24,right=24]" },
    nodes,
    // Externals sit left of the boundary: edges into them are laid out reversed so they flow left to right.
    edges: [
      ...graph.edges.map((e) =>
        layoutReversed(graph, e) ? { id: e.id, source: e.target, target: e.source } : { id: e.id, source: e.source, target: e.target },
      ),
      // Band order: unrendered edges between consecutive frames, weighted so cross-links cannot reorder them.
      ...frames.slice(1).map((f, i) => ({ id: `${frames[i]}>${f}`, source: frames[i]!, target: f, layoutOptions: { "elk.layered.priority.direction": "100" } })),
    ],
  };
}

/** True when `mapLayoutRequest` hands elk this edge reversed (its route must be flipped back). */
export function layoutReversed(graph: MapGraph, e: MapEdge): boolean {
  const role = (id: string) => graph.nodes.find((n) => n.id === id)?.role;
  return role(e.target) === "external" && role(e.source) !== "external";
}
