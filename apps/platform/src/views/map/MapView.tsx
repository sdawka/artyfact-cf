import {
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { absoluteBoxes, type LayoutRequest, type LayoutResult } from "@/graph/elk";
import { useElkLayout } from "@/graph/useElkLayout";
import { kindInfo } from "@/model/kinds";
import type { ModelIndex } from "@/model/index";
import { useModel } from "@/model/useModel";
import { useSelection, type Layer } from "@/model/useSelection";
import { CrossLinkEdge } from "./edges/CrossLinkEdge";
import { HierarchyTree } from "./HierarchyTree";
import { MapFilters } from "./MapFilters";
import { BoundaryNode } from "./nodes/BoundaryNode";
import { ExternalNode } from "./nodes/ExternalNode";
import { GroupNode } from "./nodes/GroupNode";
import { SubjectNode } from "./nodes/SubjectNode";
import type { CrossLinkFlowEdge, MapFlowNode, MapNodeData } from "./nodes/types";
import { candidateHalos } from "./overlays/overlayData";
import { useCandidateTouches } from "./overlays/useCandidateTouches";
import { DEFAULT_FILTERS, findingSubjectIds, mapLayoutRequest, mapScopeFor, useMapGraph, type MapFilterState, type MapGraph } from "./useMapGraph";
import styles from "./MapView.module.css";

const NODE_TYPES = { subject: SubjectNode, external: ExternalNode, scope: GroupNode, boundary: BoundaryNode };
const EDGE_TYPES = { crossLink: CrossLinkEdge };
const BOUNDARY_ID = "__boundary";
const FIT = { padding: 0.12, maxZoom: 1.1 };

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function flowNodes(
  graph: MapGraph,
  layout: LayoutResult,
  request: LayoutRequest,
  extra: { layer: Layer; focusId: string | null; halos: Map<string, string[]>; lit: Set<string> | null; onOpen: (id: string) => void },
): MapFlowNode[] {
  const out: MapFlowNode[] = [];
  const abs = absoluteBoxes(layout, request);
  const externals = graph.nodes.filter((n) => n.role === "external");
  const internals = graph.nodes.filter((n) => n.role === "scope" || n.role === "outside");
  if (externals.length && internals.length) {
    const right = Math.max(...externals.map((n) => abs[n.id]!.x + abs[n.id]!.width));
    const left = Math.min(...internals.map((n) => abs[n.id]!.x));
    out.push({
      id: BOUNDARY_ID,
      type: "boundary",
      position: { x: (right + left) / 2, y: 0 },
      data: { height: layout.height },
      style: { width: 1, height: layout.height },
      selectable: false,
      focusable: false,
      draggable: false,
      zIndex: -1,
    });
  }
  const order = ["external", "scope", "outside", "child"] as const;
  for (const role of order) {
    for (const n of graph.nodes) {
      if (n.role !== role) continue;
      const box = layout.nodes[n.id];
      if (!box) continue;
      const data: MapNodeData = {
        node: n,
        layer: extra.layer,
        candidates: extra.halos.get(n.id) ?? [],
        dim: !!extra.lit && !extra.lit.has(n.id),
        onOpen: extra.onOpen,
      };
      const info = kindInfo(n.kind);
      const base = {
        id: n.id,
        position: { x: box.x, y: box.y },
        style: { width: box.width, height: box.height },
        width: box.width,
        height: box.height,
        data,
        selected: n.id === extra.focusId,
        draggable: false,
        connectable: false,
        ariaLabel: `${info.label} ${n.name}${n.role === "scope" ? ", current scope" : n.role === "outside" ? ", outside this scope" : ""}`,
      };
      if (role === "scope") out.push({ ...base, type: "scope", zIndex: 0 });
      else if (role === "external") out.push({ ...base, type: "external" });
      else out.push({ ...base, type: "subject", ...(n.parentId && { parentId: n.parentId, extent: "parent" as const }) });
    }
  }
  return out;
}

function neighbourhood(graph: MapGraph, id: string | null): Set<string> | null {
  if (!id || !graph.ids.has(id)) return null;
  const lit = new Set([id]);
  for (const e of graph.edges) {
    if (e.source === id) lit.add(e.target);
    if (e.target === id) lit.add(e.source);
  }
  return lit;
}

/** Re-fits the viewport when the laid-out graph changes (not on focus or hover). */
function FitOnChange({ token }: { token: string }) {
  const rf = useReactFlow();
  const ready = useNodesInitialized();
  useEffect(() => {
    if (ready) void rf.fitView({ ...FIT, duration: reducedMotion() ? 0 : 240 });
  }, [token, ready, rf]);
  return null;
}

function modelKinds(index: ModelIndex) {
  const kinds = new Set<string>();
  const links = new Set<string>();
  for (const e of index.entries) {
    if (e.type === "thing" || e.type === "node") kinds.add(e.kind);
    if (e.type === "node" || e.type === "external") for (const l of index.crossLinks(e.id, "out")) if ((l.rel as string) !== "contains") links.add(l.rel);
  }
  return { kinds: [...kinds].sort(), links: [...links].sort() };
}

function CertaintyLegend() {
  const items = [
    ["declared", undefined],
    ["assumed", "6 4"],
    ["proposed", "1.5 4"],
  ] as const;
  return (
    <ul className={styles.legend} aria-label="Edge certainty">
      {items.map(([label, dash]) => (
        <li key={label}>
          <svg width="28" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="28" y2="4" className={styles.legendLine} strokeDasharray={dash} />
          </svg>
          {label}
        </li>
      ))}
    </ul>
  );
}

export function MapView() {
  const { index, bundle, path, parent } = useModel();
  const { focusId, setFocus, layer, candidates } = useSelection();
  const root = index.model.system.id;
  const [scope, setScope] = useState(() => mapScopeFor(index, focusId));
  const [filters, setFilters] = useState<MapFilterState>(DEFAULT_FILTERS);
  const graph = useMapGraph(scope, filters);

  // Focus inside the current view keeps the layout; focus elsewhere (palette, tree, breadcrumbs) re-scopes.
  const [seenFocus, setSeenFocus] = useState(focusId);
  if (focusId !== seenFocus) {
    setSeenFocus(focusId);
    if (focusId && !graph.ids.has(focusId)) setScope(mapScopeFor(index, focusId));
  }

  const request = useMemo(() => mapLayoutRequest(graph, layer), [graph, layer]);
  const layoutKey = `${bundle.systemId}@${bundle.revision}:${bundle.genomeCommit}|${graph.scope}|${JSON.stringify(filters)}|${layer}`;
  const { layout, pending, error } = useElkLayout(request, layoutKey);

  const touches = useCandidateTouches(candidates);
  const halos = useMemo(() => candidateHalos(index, graph, touches), [index, graph, touches]);
  const [hovered, setHovered] = useState<string | null>(null);
  const lit = useMemo(() => neighbourhood(graph, hovered), [graph, hovered]);

  const openScope = useCallback(
    (id: string) => {
      const e = index.byId(id);
      if (!e || e.type === "external") return;
      setScope(id);
      setFocus(id);
    },
    [index, setFocus],
  );

  const goUp = useCallback(() => {
    if (graph.scope === root) return;
    const up = parent(graph.scope)?.id ?? root;
    setScope(up);
    setFocus(up);
  }, [graph.scope, root, parent, setFocus]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Backspace" || e.defaultPrevented || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[role=dialog][aria-modal=true]")) return;
      e.preventDefault();
      goUp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goUp]);

  const nodes = useMemo(
    () => (layout ? flowNodes(graph, layout, request, { layer, focusId, halos, lit, onOpen: openScope }) : []),
    [graph, layout, request, layer, focusId, halos, lit, openScope],
  );
  const edges = useMemo<CrossLinkFlowEdge[]>(
    () =>
      layout
        ? graph.edges.map((e) => {
            const active = !!hovered && (e.source === hovered || e.target === hovered);
            const points = layout.edges[e.id];
            return {
              id: e.id,
              source: e.source,
              target: e.target,
              type: "crossLink" as const,
              data: { edge: e, dim: !!lit && !active, active, ...(points?.length && { points }) },
              markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--color-border-strong)" },
              selectable: false,
              focusable: false,
            };
          })
        : [],
    [graph, layout, hovered, lit],
  );

  const { kinds, links } = useMemo(() => modelKinds(index), [index]);
  const findingCount = useMemo(
    () => findingSubjectIds(index, bundle.readiness?.modelReadiness?.findings ?? []).size,
    [index, bundle],
  );

  const onNodeClick: NodeMouseHandler<MapFlowNode> = (_, n) => {
    if (n.type !== "boundary" && n.id !== focusId) setFocus(n.id);
  };
  const onNodeDoubleClick: NodeMouseHandler<MapFlowNode> = (_, n) => {
    if (n.type !== "boundary") openScope(n.id);
  };
  const nodeIdOf = (t: EventTarget) => (t instanceof HTMLElement && t.classList.contains("react-flow__node") ? (t.dataset.id ?? null) : null);
  // Keyboard: Enter on a focused node focuses it (Inspector); the node's own "inside ›" button opens it.
  const onCanvasKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const id = nodeIdOf(e.target);
    if (e.key === "Enter" && id && id !== BOUNDARY_ID) {
      e.preventDefault();
      setFocus(id);
    }
  };
  const onCanvasFocus = (e: FocusEvent<HTMLDivElement>) => {
    const id = nodeIdOf(e.target);
    if (id) setHovered(id);
  };

  const scopeEntry = index.byId(graph.scope);

  return (
    <div className={styles.view}>
      <aside className={styles.rail} aria-label="Map navigation">
        <HierarchyTree scope={graph.scope} focusId={focusId} onSelect={(id) => setFocus(id)} />
        <MapFilters value={filters} onChange={setFilters} kinds={kinds} linkTypes={links} findingCount={findingCount} />
      </aside>
      <section className={styles.stage} aria-labelledby="map-title">
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <h1 id="map-title" className={styles.h1}>Map</h1>
            <Breadcrumbs ids={path(graph.scope).map((e) => e.id)} label="Map scope" />
          </div>
          <div className={styles.hints}>
            <CertaintyLegend />
            <span className={styles.hint}>Double-click or “inside ›” to open · Backspace to go up</span>
          </div>
        </header>
        <div
          className={styles.canvas}
          onKeyDown={onCanvasKeyDown}
          onFocus={onCanvasFocus}
          onBlur={() => setHovered(null)}
          data-layer={layer}
        >
          {error ? (
            <EmptyState title="Layout failed" live>
              {error.message}
            </EmptyState>
          ) : (
            <ReactFlowProvider>
              <ReactFlow<MapFlowNode, CrossLinkFlowEdge>
                aria-label={`Map of ${scopeEntry?.name ?? graph.scope}`}
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                fitView
                fitViewOptions={FIT}
                minZoom={0.15}
                maxZoom={2}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                edgesFocusable={false}
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                zoomOnDoubleClick={false}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodeMouseEnter={(_, n) => n.type !== "boundary" && setHovered(n.id)}
                onNodeMouseLeave={() => setHovered(null)}
                proOptions={{ hideAttribution: true }}
              >
                <Controls showInteractive={false} position="bottom-right" />
                <FitOnChange token={layoutKey} />
              </ReactFlow>
            </ReactFlowProvider>
          )}
          {pending && (
            <p className={styles.pending} role="status">
              Laying out…
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
