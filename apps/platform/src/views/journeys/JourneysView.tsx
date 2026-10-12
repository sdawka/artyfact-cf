import { Background, ControlButton, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Tabs } from "@/components/Tabs/Tabs";
import { useModel } from "@/model/useModel";
import { useSelection } from "@/model/useSelection";
import styles from "./JourneysView.module.css";
import { JourneyCatalog } from "./JourneyCatalog";
import { Legend } from "./Legend";
import { ActionNode } from "./nodes/ActionNode";
import { DecisionNode } from "./nodes/DecisionNode";
import { ExternalNode } from "./nodes/ExternalNode";
import { LaneNode, type LaneBandNode } from "./nodes/LaneNode";
import { StepContext } from "./nodes/StepContext";
import { SystemNode } from "./nodes/SystemNode";
import { TerminalNode } from "./nodes/TerminalNode";
import { WaitNode } from "./nodes/WaitNode";
import { LANE_LABEL_W } from "./layout";
import { useJourneyGraph, type StepEdge, type StepNode } from "./useJourneyGraph";

const nodeTypes: NodeTypes = {
  action: ActionNode,
  system: SystemNode,
  external: ExternalNode,
  wait: WaitNode,
  decision: DecisionNode,
  terminal: TerminalNode,
  lane: LaneNode,
};
const LANE_LABELS = { actor: "Actor", system: "System", external: "External" } as const;
const ALL = "__all";

const FLOW = "var(--color-border-strong)";
const DANGER = "var(--color-danger)";

const PAD = 0.05;

/**
 * Viewport for a `w`×`h` graph in a `cw`×`ch` canvas, computed from elk's size (React Flow's
 * `useNodesInitialized` never fires for these nodes, same as the Map). `minZoom` keeps a long journey
 * legible: below it the graph is anchored top-left and scrolls instead of shrinking.
 */
export function fitViewport(w: number, h: number, cw: number, ch: number, minZoom = 0.5) {
  const pad = 1 + 2 * PAD;
  const fit = Math.min(1, cw / (w * pad), ch / (h * pad));
  const zoom = Math.max(minZoom, fit);
  return {
    zoom,
    x: w * zoom * pad > cw ? cw * PAD : (cw - w * zoom) / 2,
    y: h * zoom * pad > ch ? ch * PAD : (ch - h * zoom) / 2,
  };
}

/** Fit-everything button for the zoom controls (the built-in one needs measured nodes). */
function FitControl({ width, height, container }: { width: number; height: number; container: HTMLElement | null }) {
  const rf = useReactFlow();
  return (
    <ControlButton
      title="Fit view"
      aria-label="Fit view"
      onClick={() => container && void rf.setViewport(fitViewport(width, height, container.clientWidth, container.clientHeight, 0.15))}
    >
      <span aria-hidden="true">⤢</span>
    </ControlButton>
  );
}

/** Fits on journey, segment or layout change, and adds `+` / `-` / `0` (fit everything) keyboard zoom. */
function ViewportEffects({ fitKey, width, height, container }: { fitKey: string; width: number; height: number; container: HTMLElement | null }) {
  const rf = useReactFlow();
  const dom = useStore((s) => s.domNode);
  useEffect(() => {
    if (!container || !width || !height) return;
    const { clientWidth: cw, clientHeight: ch } = container;
    if (cw && ch) void rf.setViewport(fitViewport(width, height, cw, ch));
  }, [fitKey, width, height, container, rf]);
  useEffect(() => {
    if (!dom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") void rf.zoomIn();
      else if (e.key === "-") void rf.zoomOut();
      else if (e.key === "0") void rf.setViewport(fitViewport(width, height, dom.clientWidth, dom.clientHeight, 0.15));
      else return;
      e.preventDefault();
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [dom, rf, width, height]);
  return null;
}

export default function JourneysView() {
  const { model } = useModel().bundle;
  const journeys = model.journeys;
  const [params, setParams] = useSearchParams();
  const { focusId, setFocus } = useSelection();

  const requested = params.get("journey");
  const journey = journeys.find((j) => j.id === requested) ?? journeys.find((j) => !j.deferred) ?? journeys[0];
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const [picked, setSegment] = useState(ALL);
  const segments = journey?.segments ?? [];
  // A segment name from another journey (back/forward, deep link) falls back to all steps.
  const segment = segments.some((s) => s.name === picked) ? picked : ALL;
  const segmentSteps = useMemo(
    () => segments.find((s) => s.name === segment)?.steps,
    [segments, segment],
  );

  const graph = useJourneyGraph(journey, segmentSteps);

  const prefix = journey ? `${journey.id}/` : "";
  const activeStep = focusId?.startsWith(prefix) ? focusId.slice(prefix.length) : null;

  const select = useCallback(
    (id: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("journey", id);
        next.delete("step");
        return next;
      });
    },
    [setParams],
  );

  const pick = useCallback(
    (stepId: string) => {
      if (!journey) return;
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("step", stepId);
        next.set("focus", `${journey.id}/${stepId}`);
        return next;
      });
    },
    [journey, setParams],
  );

  // A deep link with ?step= opens the Inspector once; later Esc must not reopen it.
  const stepParam = params.get("step");
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!journey || !stepParam) return;
    const key = `${journey.id}/${stepParam}`;
    if (synced.current === key) return;
    synced.current = key;
    if (focusId !== key && journey.steps.some((s) => s.id === stepParam)) setFocus(key);
  }, [journey, stepParam, focusId, setFocus]);

  const nodes = useMemo(() => {
    const bands: LaneBandNode[] = graph.bands.map((b) => ({
      id: `lane:${b.lane}`,
      type: "lane",
      position: { x: 0, y: b.y },
      data: { label: LANE_LABELS[b.lane], lane: b.lane, width: graph.width + LANE_LABEL_W, height: b.height },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));
    const steps: StepNode[] = graph.nodes.map((n) => ({
      ...n,
      draggable: false,
      selectable: false,
      focusable: false,
      ariaRole: "group" as const,
    }));
    return [...bands, ...steps];
  }, [graph.bands, graph.nodes, graph.width]);

  const edges = useMemo<StepEdge[]>(
    () =>
      graph.edges.map((e) => ({
        ...e,
        focusable: false,
        markerEnd: { type: MarkerType.ArrowClosed, color: e.data?.failure ? DANGER : FLOW },
        labelBgPadding: [4, 2] as [number, number],
      })),
    [graph.edges],
  );

  const ctx = useMemo(() => ({ activeStep, pick }), [activeStep, pick]);

  if (!journey) {
    return (
      <section aria-labelledby="view-title">
        <h1 id="view-title">Journeys</h1>
        <EmptyState title="This system has no journeys." />
      </section>
    );
  }

  return (
    <section className={styles.view} aria-labelledby="view-title">
      <header className={styles.head}>
        <h1 id="view-title">Journeys</h1>
        <p className={styles.sub}>
          {journey.name}
          {journey.deferred ? " (deferred)" : ""}: {journey.actorGoal}
        </p>
      </header>
      <div className={styles.body}>
        <JourneyCatalog journeys={journeys} activeId={journey.id} onSelect={select} />
        <div className={styles.stage}>
          {segments.length > 0 && (
            <Tabs
              label="Journey segments"
              value={segment}
              onChange={setSegment}
              tabs={[{ id: ALL, label: "All steps" }, ...segments.map((s) => ({ id: s.name, label: s.name }))]}
            />
          )}
          <div ref={setCanvas} className={styles.canvas} data-testid="journey-canvas" aria-label={`${journey.name} flow, ${graph.nodes.length} steps`} role="group">
            <StepContext.Provider value={ctx}>
              <ReactFlowProvider>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
                  minZoom={0.3}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  nodesFocusable={false}
                  edgesFocusable={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={24} />
                  <Controls showInteractive={false} showFitView={false} position="bottom-right">
                    <FitControl width={graph.width} height={graph.height} container={canvas} />
                  </Controls>
                  <ViewportEffects fitKey={`${journey.id}:${segment}:${graph.layoutReady}`} width={graph.width} height={graph.height} container={canvas} />
                </ReactFlow>
              </ReactFlowProvider>
            </StepContext.Provider>
          </div>
          <Legend />
        </div>
      </div>
    </section>
  );
}
