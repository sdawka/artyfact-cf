import {
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { absoluteBoxes, requestKey, type LayoutRequest, type LayoutResult } from "@/graph/elk";
import { useElkLayout } from "@/graph/useElkLayout";
import { isTyping } from "@/app/Shell";
import { useEvolutions } from "@/api/queries";
import { announceSelect, flowNodeElement } from "@/effects/ambientEvents";
import { kindInfo } from "@/model/kinds";
import type { ModelIndex } from "@/model/index";
import type { Rollup } from "@/model/status";
import { useModel } from "@/model/useModel";
import { useSelection, type Layer } from "@/model/useSelection";
import { CrossLinkEdge, labelAnchor } from "./edges/CrossLinkEdge";
import { HierarchyTree } from "./HierarchyTree";
import { MapFilters } from "./MapFilters";
import { BoundaryNode } from "./nodes/BoundaryNode";
import { ExternalNode } from "./nodes/ExternalNode";
import { GroupNode } from "./nodes/GroupNode";
import { SubjectNode } from "./nodes/SubjectNode";
import type { CrossLinkFlowEdge, MapFlowNode, MapNodeData } from "./nodes/types";
import { candidateHalos, phenomeCounters, realizationCount } from "./overlays/overlayData";
import { useCandidateTouches } from "./overlays/useCandidateTouches";
import {
  DEFAULT_FILTERS,
  layoutReversed,
  mapLayoutRequest,
  mapLocationFor,
  mapScopeFor,
  useFindingSubjects,
  useMapGraph,
  type MapFilterState,
  type MapGraph,
} from "./useMapGraph";
import styles from "./MapView.module.css";

const NODE_TYPES = { subject: SubjectNode, external: ExternalNode, scope: GroupNode, boundary: BoundaryNode };
const EDGE_TYPES = { crossLink: CrossLinkEdge };
const BOUNDARY_ID = "__boundary";
const FIT = { padding: 0.12, maxZoom: 1.1 };


function flowNodes(
  graph: MapGraph,
  layout: LayoutResult,
  request: LayoutRequest,
  extra: {
    layer: Layer;
    focusId: string | null;
    halos: Map<string, string[]>;
    lit: Set<string> | null;
    status: Map<string, MapNodeData["status"]>;
    onOpen: MapNodeData["onOpen"];
    /** Overlay state for the node's accessible name (counters, realizations, candidates). */
    describe: (id: string) => string;
  },
): MapFlowNode[] {
  const out: MapFlowNode[] = [];
  const abs = absoluteBoxes(layout, request);
  // Only nodes the layout placed (a stale layout must never crash the view).
  const placed = (role: (r: string) => boolean) => graph.nodes.filter((n) => role(n.role) && abs[n.id]).map((n) => abs[n.id]!);
  const externals = placed((r) => r === "external");
  const internals = placed((r) => r === "scope" || r === "outside");
  if (externals.length && internals.length) {
    const right = Math.max(...externals.map((b) => b.x + b.width));
    const left = Math.min(...internals.map((b) => b.x));
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
        status: extra.status.get(n.id),
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
        ariaLabel: [
          `${info.label} ${n.name}`,
          n.role === "scope" ? "current scope" : n.role === "outside" ? "outside this scope" : "",
          n.childCount ? `${n.childCount} inside` : "",
          extra.describe(n.id),
        ]
          .filter(Boolean)
          .join(", "),
      };
      if (role === "scope") out.push({ ...base, type: "scope", zIndex: 0 });
      else if (role === "external") out.push({ ...base, type: "external" });
      else out.push({ ...base, type: "subject", ...(n.parentId && { parentId: n.parentId, extent: "parent" as const }) });
    }
  }
  return out;
}

/** Emphasis glow for a node's subtree verdicts: any fail, or every counted criterion passing (only pass glows green). */
export function nodeStatus(r: Rollup): MapNodeData["status"] {
  if (r.fail > 0) return "fail";
  return r.pass > 0 && r.unknown + r.stale + r.notRun === 0 ? "pass" : undefined;
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

/** Viewport that centres a `w`×`h` graph in a `cw`×`ch` canvas with {@link FIT} padding and zoom cap. */
export function fitViewport(w: number, h: number, cw: number, ch: number) {
  const pad = 1 + 2 * FIT.padding;
  const zoom = Math.max(0.15, Math.min(FIT.maxZoom, cw / (w * pad), ch / (h * pad)));
  return { x: (cw - w * zoom) / 2, y: (ch - h * zoom) / 2, zoom };
}

/**
 * Fits each new graph (the flow is remounted per layout key) from the elk size and the canvas size,
 * without waiting for React Flow to measure. Canvas resizes in the next 1.5 s (the Inspector opening
 * with the new focus) fit again; later resizes keep the user's view.
 */
function FitNewGraph({ width, height, container }: { width: number; height: number; container: HTMLElement | null }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!container || !width || !height) return;
    const start = Date.now();
    const fit = () => {
      const { clientWidth: cw, clientHeight: ch } = container;
      if (cw && ch) void rf.setViewport(fitViewport(width, height, cw, ch));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (Date.now() - start < 1500) fit();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [container, width, height, rf]);
  return null;
}

function modelKinds(index: ModelIndex) {
  const kinds = new Set<string>();
  const links = new Set<string>();
  for (const e of index.entries) {
    if (e.type === "thing" || e.type === "node") kinds.add(e.kind);
    for (const l of index.crossLinks(e.id, "out")) if ((l.rel as string) !== "contains") links.add(l.rel);
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
  const { index, path, parent, rollup } = useModel();
  const { focusId, setFocus, layer, candidates } = useSelection();
  const root = index.model.system.id;
  const [scope, setScope] = useState(() => mapScopeFor(index, focusId));
  const [filters, setFilters] = useState<MapFilterState>(DEFAULT_FILTERS);
  const graph = useMapGraph(scope, filters);

  // Focus on something already on screen keeps the layout. Focus on a Map location elsewhere (palette,
  // tree, breadcrumbs) re-scopes to it. Objects with no Map location (requirements, journeys, ...) keep the view.
  const [seenFocus, setSeenFocus] = useState(focusId);
  if (focusId !== seenFocus) {
    setSeenFocus(focusId);
    const at = mapLocationFor(index, focusId);
    if (at && !graph.ids.has(at)) setScope(mapScopeFor(index, at));
  }

  const request = useMemo(() => mapLayoutRequest(graph, layer), [graph, layer]);
  // Derived from the request itself, so any change to the graph's shape gets a fresh layout.
  const layoutKey = useMemo(() => requestKey(request), [request]);
  const { layout, pending, error } = useElkLayout(request, layoutKey);

  const touches = useCandidateTouches(candidates);
  const halos = useMemo(() => candidateHalos(index, graph, touches), [index, graph, touches]);
  const [hovered, setHovered] = useState<string | null>(null);
  // A new scope starts with no hover (the hovered node may now be the frame).
  const [hoverScope, setHoverScope] = useState(graph.scope);
  if (hoverScope !== graph.scope) {
    setHoverScope(graph.scope);
    setHovered(null);
  }
  const lit = useMemo(() => neighbourhood(graph, hovered), [graph, hovered]);

  // After a keyboard scope change the old control is gone: put keyboard focus on the new scope frame.
  const [focusFrame, setFocusFrame] = useState<string | null>(null);

  // Containers open as the scope; a leaf or outside node opens its container (never an empty frame).
  const openScope = useCallback(
    (id: string, viaKeyboard = false) => {
      const e = index.byId(id);
      if (!e || e.type === "external") return;
      const next = index.children(id).length ? id : mapScopeFor(index, id);
      setScope(next);
      setFocus(id);
      if (viaKeyboard) setFocusFrame(next);
    },
    [index, setFocus],
  );

  const goUp = useCallback(() => {
    if (graph.scope === root) return;
    const up = parent(graph.scope)?.id ?? root;
    setScope(up);
    setFocus(up);
    setFocusFrame(up);
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

  const { data: board } = useEvolutions();
  const describe = useCallback(
    (id: string) => {
      const parts: string[] = [];
      if (layer === "phenome") parts.push(`evidence ${phenomeCounters(rollup(id)).map((c) => `${c.count} ${c.label}`).join(", ")}`);
      if (layer === "proteome") {
        const n = realizationCount(board, id);
        parts.push(`${n} ${n === 1 ? "realization" : "realizations"}`);
      }
      const touched = halos.get(id);
      if (touched?.length) parts.push(`touched by ${touched.join(" and ")}${touched.length > 1 ? " (overlap)" : ""}`);
      return parts.join(", ");
    },
    [layer, rollup, board, halos],
  );

  const status = useMemo(() => new Map(graph.nodes.map((n) => [n.id, nodeStatus(rollup(n.id))])), [graph, rollup]);
  const nodes = useMemo(
    () => (layout ? flowNodes(graph, layout, request, { layer, focusId, halos, lit, status, onOpen: openScope, describe }) : []),
    [graph, layout, request, layer, focusId, halos, lit, status, openScope, describe],
  );

  useEffect(() => {
    if (!focusFrame || !nodes.some((n) => n.id === focusFrame)) return;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(focusFrame)}"]`);
      if (el) {
        el.focus();
        setFocusFrame(null);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [focusFrame, nodes]);
  // Label chips that would overlap an earlier one are hidden; the hovered node's edges get first pick.
  const labelled = useMemo(() => {
    const shown = new Set<string>();
    if (!layout) return shown;
    const placed: [number, number][] = [];
    const touchesHover = (e: MapGraph["edges"][number]) => (hovered && (e.source === hovered || e.target === hovered) ? 1 : 0);
    for (const e of [...graph.edges].sort((a, b) => touchesHover(b) - touchesHover(a) || b.count - a.count)) {
      const route = layout.edges[e.id];
      if (!route || route.length < 2) {
        shown.add(e.id);
        continue;
      }
      const [x, y] = labelAnchor(route);
      if (placed.some(([px, py]) => Math.abs(px - x) < 72 && Math.abs(py - y) < 20)) continue;
      placed.push([x, y]);
      shown.add(e.id);
    }
    return shown;
  }, [graph, layout, hovered]);

  const edges = useMemo<CrossLinkFlowEdge[]>(
    () =>
      layout
        ? graph.edges.map((e) => {
            const active = !!hovered && (e.source === hovered || e.target === hovered);
            const flow = !!focusId && (e.source === focusId || e.target === focusId);
            const route = layout.edges[e.id];
            const points = route && layoutReversed(graph, e) ? [...route].reverse() : route;
            return {
              id: e.id,
              source: e.source,
              target: e.target,
              type: "crossLink" as const,
              data: { edge: e, dim: !!lit && !active && !flow, active, flow, showLabel: labelled.has(e.id), ...(points?.length && { points }) },
              markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--color-border-strong)" },
              selectable: false,
              focusable: false,
            };
          })
        : [],
    [graph, layout, hovered, lit, labelled, focusId],
  );

  const { kinds, links } = useMemo(() => modelKinds(index), [index]);
  const findingCount = useFindingSubjects().size;

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
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);

  // A new selection ripples the Shell's ambient field from the node, when it is on screen.
  const announced = useRef(focusId);
  useEffect(() => {
    if (focusId === announced.current) return;
    announced.current = focusId;
    if (!focusId || !canvas) return;
    requestAnimationFrame(() => announceSelect(flowNodeElement(focusId, canvas)));
  }, [focusId, canvas]);

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
          ref={setCanvas}
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
            <ReactFlowProvider key={layoutKey}>
              <ReactFlow<MapFlowNode, CrossLinkFlowEdge>
                aria-label={`Map of ${scopeEntry?.name ?? graph.scope}`}
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
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
                <FitNewGraph width={layout?.width ?? 0} height={layout?.height ?? 0} container={canvas} />
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
