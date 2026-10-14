import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useLocation } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isTyping } from "@/app/Shell";
import { LayerSwitch } from "@/app/LayerSwitch";
import { useEvolutions } from "@/api/queries";
import { announceSelect, flowNodeElement } from "@/effects/ambientEvents";
import { useKindViews, type KindViews } from "@/model/kinds";
import type { ModelIndex } from "@/model/index";
import type { Rollup } from "@/model/status";
import { useModel } from "@/model/useModel";
import { useAtlasNavigation } from "@/model/useAtlasNavigation";
import { useSelection, useSystemRoute } from "@/model/useSelection";
import { CrossLinkEdge } from "./edges/CrossLinkEdge";
import { HierarchyTree } from "./HierarchyTree";
import { MapFilters } from "./MapFilters";
import { ExternalNode } from "./nodes/ExternalNode";
import { GroupNode } from "./nodes/GroupNode";
import { SubjectNode } from "./nodes/SubjectNode";
import type { CrossLinkFlowEdge, MapFlowNode, MapNodeData } from "./nodes/types";
import { candidateHalos, phenomeCounters, realizationCount } from "./overlays/overlayData";
import { useCandidateTouches } from "./overlays/useCandidateTouches";
import { DEFAULT_FILTERS, ENVIRONMENT_SCOPE, mapScopeFor, useFindingSubjects, useMapGraph, type MapFilterState } from "./useMapGraph";
import { layoutAtlas } from "./atlasLayout";
import { atlasFlowEdges, atlasFlowNodes } from "./atlasFlow";
import { AtlasCamera, saveAtlasCamera } from "./AtlasCamera";
import { AtlasSelection } from "./AtlasSelection";
import { useDepthGestures } from "./useDepthGestures";
import { useAtlasReveal } from "./useAtlasReveal";
import styles from "./MapView.module.css";

const NODE_TYPES = { subject: SubjectNode, external: ExternalNode, scope: GroupNode };
const EDGE_TYPES = { crossLink: CrossLinkEdge };
/** Locate belongs to a history entry; its consumption survives view remounts like the session camera. */
const consumedLocateEntries = new Set<string>();
export { fitViewport } from "./atlasViewport";
export function nodeStatus(r: Rollup): MapNodeData["status"] {
  if (r.fail > 0) return "fail";
  return r.pass > 0 && r.unknown + r.stale + r.notRun === 0 ? "pass" : undefined;
}
/** Every actual kind remains discoverable even if the template does not declare a drawing layer. */
export function modelKinds(index: ModelIndex, _views: KindViews) {
  const kinds = new Set<string>(), links = new Set<string>();
  for (const id of index.descendants(index.model.system.id)) {
    const kind = index.byId(id)?.kind;
    if (id !== index.model.system.id && kind) kinds.add(kind);
  }
  for (const e of index.entries) for (const link of index.crossLinks(e.id, "out")) if ((link.rel as string) !== "contains") links.add(link.rel);
  return { kinds: [...kinds].sort(), links: [...links].sort() };
}

export function MapView() {
  const { index, path, rollup } = useModel();
  const views = useKindViews();
  const navigation = useAtlasNavigation();
  const location = useLocation();
  const { focusId, layer, candidates } = useSelection();
  const { systemId, rev } = useSystemRoute();
  const [filters, setFilters] = useState<MapFilterState>(DEFAULT_FILTERS);
  const [panel, setPanel] = useState<"tree" | "filters" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const graph = useMapGraph(navigation.scope, filters);
  const layout = useMemo(() => layoutAtlas(graph), [graph]);
  const touches = useCandidateTouches(candidates);
  const halos = useMemo(() => candidateHalos(index, graph, touches), [index, graph, touches]);
  const { data: board } = useEvolutions();
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [navigationPanel, setNavigationPanel] = useState<HTMLElement | null>(null);
  useAtlasReveal(surface, graph.scope);
  useAtlasReveal(navigationPanel, panel, 140);
  const [focusFrame, setFocusFrame] = useState<string | null>(null);
  const [locate, setLocate] = useState<{ id: string; sequence: number } | null>(null);
  const [pendingLocate, setPendingLocate] = useState<{ id: string; scope: string; requestKey?: string } | null>(null);
  const cameraKey = `${systemId}/${rev}/${graph.scope}`;
  const openScope = useCallback((id: string, keyboard = false) => {
    if (!index.children(id).length || id === graph.scope || index.byId(id)?.type === "external") return;
    navigation.enter(id);
    if (keyboard) setFocusFrame(id);
  }, [index, graph.scope, navigation]);
  const goUp = useCallback(() => {
    if (graph.scope === ENVIRONMENT_SCOPE) return;
    navigation.up();
    setFocusFrame(index.parent(graph.scope)?.id ?? ENVIRONMENT_SCOPE);
  }, [navigation, graph.scope, index]);
  useDepthGestures(canvas, (id) => { const target = id ?? focusId; if (target) openScope(target); }, goUp);
  const locateNode = useCallback((id: string) => {
    if (graph.ids.has(id)) {
      navigation.select(id);
      setLocate((last) => ({ id, sequence: (last?.sequence ?? 0) + 1 }));
      return;
    }
    setFilters(DEFAULT_FILTERS);
    const next = index.byId(id)?.type === "external" ? ENVIRONMENT_SCOPE : (index.parent(id)?.id ?? mapScopeFor(index, id));
    setPendingLocate({ id, scope: next });
    navigation.enter(next);
  }, [graph, index, navigation]);
  useEffect(() => {
    const requested = (location.state as { atlasLocate?: string } | null)?.atlasLocate;
    const requestKey = `${systemId}/${rev}/${location.key}`;
    if (!requested || requested !== focusId || consumedLocateEntries.has(requestKey)) return;
    setFilters(DEFAULT_FILTERS);
    setPendingLocate({ id: requested, scope: graph.scope, requestKey });
  }, [location, focusId, graph.scope, systemId, rev]);
  useEffect(() => {
    if (!pendingLocate) return;
    if (graph.scope !== pendingLocate.scope || !graph.ids.has(pendingLocate.id)) return;
    if (pendingLocate.requestKey) consumedLocateEntries.add(pendingLocate.requestKey);
    if (focusId !== pendingLocate.id) navigation.select(pendingLocate.id);
    setLocate((last) => ({ id: pendingLocate.id, sequence: (last?.sequence ?? 0) + 1 }));
    setPendingLocate(null);
  }, [pendingLocate, graph, focusId, navigation]);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Backspace" || event.defaultPrevented || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[role=dialog][aria-modal=true]")) return;
      event.preventDefault(); goUp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goUp]);
  const describe = useCallback((id: string) => {
    const parts: string[] = [];
    if (layer === "phenome") parts.push(`evidence ${phenomeCounters(rollup(id)).map((counter) => `${counter.count} ${counter.label}`).join(", ")}`);
    if (layer === "proteome") { const count = realizationCount(board, id); parts.push(`${count} ${count === 1 ? "realization" : "realizations"}`); }
    const touched = halos.get(id);
    if (touched?.length) parts.push(`touched by ${touched.join(" and ")}${touched.length > 1 ? " (overlap)" : ""}`);
    return parts.join(", ");
  }, [layer, rollup, board, halos]);
  const status = useMemo(() => new Map(graph.nodes.map((node) => [node.id, nodeStatus(rollup(node.id))])), [graph, rollup]);
  const nodes = useMemo(() => atlasFlowNodes(graph, layout, { layer, focusId, halos, status, onOpen: openScope, describe }), [graph, layout, layer, focusId, halos, status, openScope, describe]);
  const edges = useMemo(() => atlasFlowEdges(graph, focusId, showAll, index), [graph, focusId, showAll, index]);
  useEffect(() => {
    if (!focusFrame || !canvas || focusFrame !== graph.scope) return;
    const id = graph.scope === ENVIRONMENT_SCOPE ? index.model.system.id : graph.scope;
    const raf = requestAnimationFrame(() => {
      canvas.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.focus();
      setFocusFrame(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [focusFrame, graph.scope, canvas, index]);
  const announced = useRef(focusId);
  useEffect(() => {
    if (focusId === announced.current) return;
    announced.current = focusId;
    if (focusId && canvas) requestAnimationFrame(() => announceSelect(flowNodeElement(focusId, canvas)));
  }, [focusId, canvas]);
  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("react-flow__node")) return;
    const id = event.target.dataset.id;
    if (!id) return;
    if (event.key === "Enter") { event.preventDefault(); openScope(id, true); }
    if (event.key === " ") { event.preventDefault(); navigation.select(id); }
    if (event.key.toLowerCase() === "d") { event.preventDefault(); navigation.showDetails(id); }
  };
  const { kinds, links } = useMemo(() => modelKinds(index, views), [index, views]);
  const findingCount = useFindingSubjects().size;
  const scopePath = graph.scope === ENVIRONMENT_SCOPE ? [] : path(graph.scope);
  return <div className={styles.view}>
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h1 className={styles.h1}>Map</h1>
        <nav aria-label="Map scope" className={styles.breadcrumbs}><ol>
          <li><button onClick={() => { if (graph.scope !== ENVIRONMENT_SCOPE) { navigation.enter(ENVIRONMENT_SCOPE); } }} aria-current={graph.scope === ENVIRONMENT_SCOPE ? "location" : undefined}>Environment</button></li>
          {scopePath.map((entry, i) => <li key={entry.id}><span aria-hidden="true">/</span><button aria-current={i === scopePath.length - 1 ? "location" : undefined} onClick={() => openScope(entry.id)}>{entry.name}</button></li>)}
        </ol></nav>
        <div className={styles.overlay}><LayerSwitch /></div>
      </div>
      <div className={styles.toolbar}>
        <button onClick={goUp} disabled={graph.scope === ENVIRONMENT_SCOPE}>Up</button>
        {graph.scope === ENVIRONMENT_SCOPE && index.children(index.model.system.id).length > 0 && <button onClick={() => openScope(index.model.system.id)}>Enter {index.model.system.name}</button>}
        <button onClick={() => setPanel((last) => last === "tree" ? null : "tree")} aria-expanded={panel === "tree"} aria-controls="atlas-navigation">Tree</button>
        <button onClick={() => setPanel((last) => last === "filters" ? null : "filters")} aria-expanded={panel === "filters"} aria-controls="atlas-navigation">Filters</button>
        <label className={styles.showAll}><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Show all connections</label>
        <span className={styles.hint}>Drag or scroll to pan. Enter to explore. D for Details.</span>
      </div>
    </header>
    <div className={styles.canvas} ref={setCanvas} onKeyDown={onCanvasKeyDown} data-layer={layer} data-scope={graph.scope} data-testid="atlas-canvas">
      {panel && <aside ref={setNavigationPanel} id="atlas-navigation" className={styles.navigation} aria-label="Map navigation">
        <div className={styles.panelHead}><strong>{panel === "tree" ? "Containment" : "Filters"}</strong><button onClick={() => setPanel(null)} aria-label="Close map navigation">×</button></div>
        {panel === "tree" ? <HierarchyTree scope={graph.scope === ENVIRONMENT_SCOPE ? index.model.system.id : graph.scope} focusId={focusId} onSelect={locateNode} /> : <MapFilters value={filters} onChange={setFilters} kinds={kinds} linkTypes={links} findingCount={findingCount} />}
      </aside>}
      <div className={styles.flowSurface} ref={setSurface} data-testid="atlas-surface">
      <ReactFlowProvider>
        <ReactFlow<MapFlowNode, CrossLinkFlowEdge>
          aria-label={`Map of ${graph.scope === ENVIRONMENT_SCOPE ? `${index.model.system.name} environment` : index.byId(graph.scope)?.name ?? graph.scope}`}
          nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
          minZoom={0.15} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} edgesFocusable={false}
          elevateNodesOnSelect={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
          zoomOnDoubleClick={false} zoomOnScroll={false} zoomOnPinch={false} zoomActivationKeyCode={null} panOnScroll
          onNodeClick={(_, node) => navigation.select(node.id)} onNodeDoubleClick={(_, node) => openScope(node.id)}
          onPaneClick={() => navigation.select(null)}
          onMoveStart={(event, viewport) => { if (event) saveAtlasCamera(cameraKey, viewport); canvas?.dispatchEvent(new Event("atlas-camera-move")); }}
          onMove={(event, viewport) => { if (event) saveAtlasCamera(cameraKey, viewport); canvas?.dispatchEvent(new Event("atlas-camera-move")); }}
          onMoveEnd={(event, viewport) => { if (event) saveAtlasCamera(cameraKey, viewport); canvas?.dispatchEvent(new Event("atlas-camera-move")); }}
          proOptions={{ hideAttribution: true }}
        >
          <AtlasCamera cameraKey={cameraKey} layout={layout} canvas={canvas} graph={graph} focusId={focusId} locate={locate} onLocate={locateNode} />
        </ReactFlow>
      </ReactFlowProvider>
      </div>
      <AtlasSelection id={focusId} graph={graph} onEnter={openScope} onDetails={() => navigation.showDetails()} onLocate={locateNode} onClear={() => navigation.select(null)} />
      <div className={styles.legend} aria-label="Connection certainty"><span>━ declared</span><span>┄ assumed</span><span>┈ proposed</span></div>
    </div>
  </div>;
}
