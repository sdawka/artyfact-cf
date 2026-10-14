import { Button, IconButton } from "@/components/ui";
import { Kbd } from "@/components/Kbd/Kbd";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Cross2Icon } from "@radix-ui/react-icons";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useLocation } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { isTyping } from "@/app/Shell";
import { useCompactLayout } from "@/app/useCompactLayout";
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
import { selectedBoundaryEdges } from "./atlasConnections";
import type { AtlasTravel } from "./atlasCameraMotion";
import { AtlasCamera, saveAtlasCamera } from "./AtlasCamera";
import { OutsideMenu } from "./OutsideMenu";
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

/**
 * The history entry's identity for travel bookkeeping. A replace that only adds the `scope` param (URL normalisation on
 * first load) is the same entry: it must not cancel a travel the user already started.
 */
function useEntryKey(location: { key: string; pathname: string; search: string }) {
  const aliases = useRef(new Map<string, string>());
  const previous = useRef(location);
  const canon = (key: string) => aliases.current.get(key) ?? key;
  if (previous.current.key !== location.key) {
    const strip = (search: string) => { const p = new URLSearchParams(search); p.delete("scope"); return p.toString(); };
    const before = previous.current;
    if (before.pathname === location.pathname && !new URLSearchParams(before.search).has("scope") && strip(before.search) === strip(location.search)) {
      aliases.current.set(location.key, canon(before.key));
    }
    previous.current = location;
  }
  return canon(location.key);
}

export function MapView() {
  const { index, path, rollup } = useModel();
  const views = useKindViews();
  const navigation = useAtlasNavigation();
  const location = useLocation();
  const locKey = useEntryKey(location);
  const currentLocationKey = useRef(locKey);
  currentLocationKey.current = locKey;
  const { focusId, layer, candidates } = useSelection();
  const { systemId, rev } = useSystemRoute();
  const [filters, setFilters] = useState<MapFilterState>(DEFAULT_FILTERS);
  const [panel, setPanel] = useState<"tree" | "filters" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [outside, setOutside] = useState<string[]>([]);
  const reportOutside = useCallback((next: string[]) => setOutside((last) => last.length === next.length && last.every((id, i) => id === next[i]) ? last : next), []);
  const inspecting = !!focusId && new URLSearchParams(location.search).get("inspect") === "1";
  const compactLayout = useCompactLayout();
  const inspectorInset = useInspectorInset(inspecting && !compactLayout);
  const graph = useMapGraph(navigation.scope, filters);
  const committedScope = useRef(graph.scope);
  useEffect(() => { committedScope.current = graph.scope; }, [graph.scope]);
  const layout = useMemo(() => layoutAtlas(graph), [graph]);
  const touches = useCandidateTouches(candidates);
  const halos = useMemo(() => candidateHalos(index, graph, touches), [index, graph, touches]);
  const { data: board } = useEvolutions();
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [navigationPanel, setNavigationPanel] = useState<HTMLElement | null>(null);
  useAtlasReveal(surface, graph.scope);
  useAtlasReveal(navigationPanel, panel, 140);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [travel, setTravel] = useState<AtlasTravel | null>(null);
  const travelSequence = useRef(0);
  const [focusFrame, setFocusFrame] = useState<string | null>(null);
  const [locate, setLocate] = useState<{ id: string; sequence: number } | null>(null);
  const [pendingLocate, setPendingLocate] = useState<{ id: string; scope: string; requestKey?: string; sourceKey?: string } | null>(null);
  const cameraKey = `${systemId}/${rev}/${graph.scope}`;
  const openScope = useCallback((id: string, keyboard = false, afterClickSelection = false) => {
    if (!index.children(id).length || id === committedScope.current || index.byId(id)?.type === "external") return;
    setPendingLocate(null);
    const selectedSearch = new URLSearchParams(location.search);
    selectedSearch.set("scope", graph.scope); selectedSearch.set("focus", id); selectedSearch.delete("inspect");
    const pendingSelection = afterClickSelection ? { historyKey: locKey, search: `?${selectedSearch}` } : undefined;
    setTravel({ pendingSelection, historyKey: pendingSelection ? undefined : committedScope.current === graph.scope ? locKey : undefined, source: committedScope.current, id, target: id, kind: "enter", sequence: ++travelSequence.current });
    if (keyboard) setFocusFrame(id);
  }, [index, graph.scope, navigation, locKey, location.search]);
  const goUp = useCallback(() => {
    const source = committedScope.current;
    if (source === ENVIRONMENT_SCOPE) return;
    const target = source === index.model.system.id ? ENVIRONMENT_SCOPE : index.parent(source)?.id ?? ENVIRONMENT_SCOPE;
    setPendingLocate(null);
    setTravel({ historyKey: source === graph.scope ? locKey : undefined, source, id: source, target, kind: "up", sequence: ++travelSequence.current });
    setFocusFrame(target);
  }, [navigation, graph.scope, index, locKey]);
  useDepthGestures(canvas, (id) => { const target = id ?? focusId; if (target) openScope(target); }, goUp);
  const locateNode = useCallback((id: string) => {
    if (graph.ids.has(id)) {
      setPendingLocate(null);
      ++travelSequence.current; setTravel(null);
      navigation.select(id);
      setLocate((last) => ({ id, sequence: (last?.sequence ?? 0) + 1 }));
      return;
    }
    setFilters(DEFAULT_FILTERS);
    const next = index.byId(id)?.type === "external" ? ENVIRONMENT_SCOPE : (index.parent(id)?.id ?? mapScopeFor(index, id));
    const ownerSequence = ++travelSequence.current;
    setPendingLocate(null);
    if (next === graph.scope) { setPendingLocate({ id, scope: next, sourceKey: locKey }); setTravel(null); return; }
    const projected = [...index.path(id)].reverse().find(entry => graph.ids.has(entry.id))?.id ?? graph.scope;
    setTravel({ historyKey: committedScope.current === graph.scope ? locKey : undefined, source: committedScope.current, id: projected, target: next, focus: id, kind: "locate", sequence: ownerSequence });
  }, [graph, index, navigation, locKey]);
  useEffect(() => {
    // Rapid depth actions may arrive before their just-committed source scope renders.
    if (!travel || travel.historyKey || travel.source !== graph.scope) return;
    // A double-click includes a selecting click. Wait for that exact URL replacement;
    // other focus/layer/Details changes still cancel this gesture before it can enter.
    if (travel.pendingSelection && location.search !== travel.pendingSelection.search) {
      if (locKey !== travel.pendingSelection.historyKey) { ++travelSequence.current; setTravel(null); setPendingLocate(null); }
      return;
    }
    setTravel({ ...travel, historyKey: locKey, pendingSelection: undefined });
  }, [travel, graph.scope, locKey, location.search]);
  useEffect(() => {
    if (!travel?.historyKey || travel.historyKey === locKey) return;
    ++travelSequence.current; setTravel(null); setPendingLocate(null);
  }, [locKey, travel]);
  useEffect(() => {
    if (!pendingLocate?.sourceKey || locKey === pendingLocate.sourceKey) return;
    ++travelSequence.current; setTravel(null); setPendingLocate(null);
  }, [locKey, pendingLocate]);
  useEffect(() => {
    const requested = (location.state as { atlasLocate?: string } | null)?.atlasLocate;
    const requestKey = `${systemId}/${rev}/${locKey}`;
    if (!requested || requested !== focusId || consumedLocateEntries.has(requestKey)) return;
    setFilters(DEFAULT_FILTERS);
    setPendingLocate({ id: requested, scope: graph.scope, requestKey, sourceKey: locKey });
  }, [location, focusId, graph.scope, systemId, rev]);
  useEffect(() => {
    if (!pendingLocate) return;
    // Effects share one render closure: reject an unauthorized arrival before any selection/camera write.
    if (pendingLocate.sourceKey && locKey !== pendingLocate.sourceKey) return;
    if (graph.scope !== pendingLocate.scope || !graph.ids.has(pendingLocate.id)) return;
    if (pendingLocate.requestKey) consumedLocateEntries.add(pendingLocate.requestKey);
    if (focusId !== pendingLocate.id) navigation.select(pendingLocate.id);
    setLocate((last) => ({ id: pendingLocate.id, sequence: (last?.sequence ?? 0) + 1 }));
    setPendingLocate(null);
  }, [pendingLocate, graph, focusId, navigation, locKey]);
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
  const relationEdges = useMemo(() => [...new Map([
    ...selectedBoundaryEdges(graph, focusId, index), ...selectedBoundaryEdges(graph, hoverId, index),
  ].map(edge => [edge.id, edge])).values()], [graph, focusId, hoverId, index]);
  const emphasizedIds = useMemo(() => new Set([focusId, hoverId].filter((id): id is string => !!id)), [focusId, hoverId]);
  const nodes = useMemo(() => atlasFlowNodes(graph, layout, { layer, focusId, halos, status, relationEdges, emphasizedIds, onOpen: openScope, describe }), [graph, layout, layer, focusId, halos, status, relationEdges, emphasizedIds, openScope, describe]);
  const edges = useMemo(() => atlasFlowEdges(graph, focusId, showAll, index, hoverId), [graph, focusId, showAll, index, hoverId]);
  useEffect(() => { setHoverId(null); }, [graph.scope]);
  const finishTravel = useCallback((request: AtlasTravel) => {
    if (request.sequence !== travelSequence.current || (request.historyKey && request.historyKey !== currentLocationKey.current)) return false;
    committedScope.current = request.target;
    if (request.kind === "locate" && request.focus) navigation.locate(request.focus);
    else navigation.enter(request.target);
    setTravel(null);
    return true;
  }, [navigation]);
  const cancelTravel = useCallback(() => { ++travelSequence.current; setTravel(null); setPendingLocate(null); }, []);
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
  const environment = graph.scope === ENVIRONMENT_SCOPE;
  const systemName = index.model.system.name;
  const scopeName = environment ? systemName : index.byId(graph.scope)?.name ?? graph.scope;
  const enterSystem = environment && index.children(index.model.system.id).length > 0;
  const outsideItems = [...new Set(outside)].map((id) => ({ id, name: graph.nodes.find((n) => n.id === id)?.name ?? id, kind: graph.nodes.find((n) => n.id === id)?.kind ?? "other", onSelect: () => locateNode(id) }));
  const breadcrumbs = <nav aria-label="Map scope" className={styles.breadcrumbs}><ol>
    <li><button onClick={() => { if (!environment) { navigation.enter(ENVIRONMENT_SCOPE); } }} aria-current={environment ? "location" : undefined}>Environment</button></li>
    {scopePath.map((entry, i) => <li key={entry.id}><span aria-hidden="true">/</span><button aria-current={i === scopePath.length - 1 ? "location" : undefined} onClick={() => openScope(entry.id)}>{entry.name}</button></li>)}
  </ol></nav>;
  return <div className={styles.view} data-inspecting={inspectorInset ? "" : undefined} style={inspectorInset ? { "--inspector-inset": `${inspectorInset}px` } as CSSProperties : undefined}>
    <PageHeader
      variant="compact" className={styles.header} title="Map" context={breadcrumbs}
      purpose={`Where each part of ${scopeName} sits and what it touches.`}
      primary={enterSystem ? <Button variant="primary" size="compact" onClick={() => openScope(index.model.system.id)}>Enter {systemName}</Button> : undefined}
    >
      <div className={styles.toolbar}>
        <Button size="compact" onClick={goUp} disabled={environment}>Up</Button>
        <Button size="compact" onClick={() => setPanel((last) => last === "tree" ? null : "tree")} aria-expanded={panel === "tree"} aria-controls="atlas-navigation">Tree</Button>
        <Button size="compact" onClick={() => setPanel((last) => last === "filters" ? null : "filters")} aria-expanded={panel === "filters"} aria-controls="atlas-navigation">Filters</Button>
        {outsideItems.length > 0 && <OutsideMenu label={`Outside ${scopeName}`} items={outsideItems} trigger={<Button size="compact">Outside ({outsideItems.length})</Button>} />}
        <div className={styles.overlay}><LayerSwitch /></div>
        <span className={styles.hint}>
          <span>Drag pan</span><span><Kbd keys={["Enter"]} /> open</span><span><Kbd keys={["D"]} /> details</span><span><Kbd keys={["Backspace"]} /> up</span>
        </span>
      </div>
    </PageHeader>
    <div className={styles.canvas} ref={setCanvas} onKeyDown={onCanvasKeyDown} data-layer={layer} data-scope={graph.scope} data-testid="atlas-canvas">
      {panel && <aside ref={setNavigationPanel} id="atlas-navigation" className={styles.navigation} aria-label="Map navigation">
        <div className={styles.panelHead}><h2>{panel === "tree" ? "Containment" : "Filters"}</h2><IconButton size="compact" label="Close map navigation" onClick={() => setPanel(null)}><Cross2Icon /></IconButton></div>
        {panel === "tree" ? <HierarchyTree scope={environment ? index.model.system.id : graph.scope} focusId={focusId} onSelect={locateNode} /> : <MapFilters value={filters} onChange={setFilters} kinds={kinds} linkTypes={links} findingCount={findingCount} showAll={showAll} onShowAll={setShowAll} />}
      </aside>}
      <div className={styles.flowSurface} ref={setSurface} data-testid="atlas-surface">
      <ReactFlowProvider>
        <ReactFlow<MapFlowNode, CrossLinkFlowEdge>
          aria-label={`Map of ${graph.scope === ENVIRONMENT_SCOPE ? `${index.model.system.name} environment` : index.byId(graph.scope)?.name ?? graph.scope}`}
          nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
          minZoom={0.15} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} edgesFocusable={false}
          elevateNodesOnSelect={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
          zoomOnDoubleClick={false} zoomOnScroll={false} zoomOnPinch={false} zoomActivationKeyCode={null} panOnScroll
          onNodeMouseEnter={(_, node) => setHoverId(node.id)} onNodeMouseLeave={() => setHoverId(null)}
          onNodeClick={(event, node) => {
            if (event.detail > 1) return; // The second click belongs to the double-click Enter gesture.
            cancelTravel();
            if (focusId !== node.id || new URLSearchParams(location.search).has("inspect")) navigation.select(node.id);
          }} onNodeDoubleClick={(event, node) => openScope(node.id, false, event.detail > 1)}
          onPaneClick={() => { cancelTravel(); navigation.select(null); }}
          onMoveStart={(event, viewport) => { if (event) saveAtlasCamera(cameraKey, viewport); canvas?.dispatchEvent(new Event("atlas-camera-move")); }}
          onMove={(event, viewport) => { if (event) saveAtlasCamera(cameraKey, viewport); canvas?.dispatchEvent(new Event("atlas-camera-move")); }}
          onMoveEnd={(event, viewport) => { if (event) saveAtlasCamera(cameraKey, viewport); canvas?.dispatchEvent(new Event("atlas-camera-move")); }}
          proOptions={{ hideAttribution: true }}
        >
          <AtlasCamera cameraKey={cameraKey} layout={layout} canvas={canvas} graph={graph} focusId={focusId} travel={travel} onTravel={finishTravel} onCancelTravel={cancelTravel} locate={locate} onOutside={reportOutside} />
        </ReactFlow>
      </ReactFlowProvider>
      </div>
      <div className={styles.dock}>
        <AtlasSelection id={focusId} graph={graph} onEnter={openScope} onDetails={() => navigation.showDetails()} onLocate={locateNode} onClear={() => navigation.select(null)} />
        <MapKey />
      </div>
    </div>
  </div>;
}

/** Width of the open Details drawer on wide screens, so the Map's pan area shrinks beside it instead of sitting under it. */
function useInspectorInset(active: boolean) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!active) { setWidth(0); return; }
    let ro: ResizeObserver | undefined, raf = 0, tries = 0;
    const attach = () => {
      const aside = document.querySelector<HTMLElement>('aside[aria-label="Inspector"]');
      if (!aside) { if (++tries < 20) raf = requestAnimationFrame(attach); return; }
      const read = () => setWidth(Math.round(aside.getBoundingClientRect().width));
      read();
      if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(read); ro.observe(aside); }
    };
    attach();
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [active]);
  return active ? width : 0;
}

/** Key on `--surface-overlay`: line samples use the edge dash arrays, plus outside-System and candidate samples. */
function MapKey() {
  const line = (dash?: string) => <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden="true" focusable="false"><line x1="0" y1="4" x2="28" y2="4" stroke="currentColor" strokeWidth="1.5" {...(dash && { strokeDasharray: dash })} /></svg>;
  return <div className={styles.legend} role="group" aria-label="Map key">
    <span>{line()}declared</span>
    <span>{line("6 4")}assumed</span>
    <span>{line("1.5 4")}proposed</span>
    <span><svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true" focusable="false"><rect x=".75" y=".75" width="16.5" height="10.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="3 2" /></svg>outside System</span>
    <span><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" focusable="false"><path d="M1 4V1h3M10 1h3v3M13 8v3h-3M4 11H1V8" fill="none" stroke="var(--color-brand-primary)" strokeWidth="1.5" /></svg>candidate touches</span>
  </div>;
}
