import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type EdgeTypes, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useViewportWidth } from "@/app/useCompactLayout";
import { Button, Select } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Kbd } from "@/components/Kbd/Kbd";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Row, RowList } from "@/components/RowList/RowList";
import { StatusText } from "@/components/StatusText/StatusText";
import { announceSelect, flowNodeElement } from "@/effects/ambientEvents";
import { Tabs } from "@/components/Tabs/Tabs";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSelection } from "@/model/useSelection";
import styles from "./JourneysView.module.css";
import { FlowStepEdge } from "./FlowStepEdge";
import { JourneyCatalog, orderedJourneys } from "./JourneyCatalog";
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
const edgeTypes: EdgeTypes = { smoothstep: FlowStepEdge };
const LANE_LABELS = { actor: "Actor", system: "System", external: "External" } as const;
const ALL = "__all";

const FLOW = "var(--color-border-strong)";
const DANGER = "var(--color-danger)";

const PAD = 0.05;
/** Step text is 13px: below this zoom it falls under 12px on screen. The graph pans instead of shrinking past it. */
export const READABLE_ZOOM = 0.92;
const NARROW = 900;

/**
 * Viewport for a `w`×`h` graph in a `cw`×`ch` canvas, computed from elk's size (React Flow's
 * `useNodesInitialized` never fires for these nodes, same as the Map). `minZoom` keeps a long journey
 * legible (text stays at least 12px): below it the graph is anchored top-left and pans instead of shrinking.
 */
export function fitViewport(w: number, h: number, cw: number, ch: number, minZoom = READABLE_ZOOM) {
  const pad = 1 + 2 * PAD;
  const fit = Math.min(1, cw / (w * pad), ch / (h * pad));
  const zoom = Math.max(minZoom, fit);
  return {
    zoom,
    x: w * zoom * pad > cw ? cw * PAD : (cw - w * zoom) / 2,
    // Anchored to the top: a short graph never floats in the middle of a tall canvas.
    y: ch * PAD,
  };
}

export interface ViewportApi { fit(): void; actual(): void }

/** Hands the header's Fit and 100% buttons the flow's viewport (the built-in fit needs measured nodes). Fit shows everything. */
function ViewportControls({ width, height, container, api }: { width: number; height: number; container: HTMLElement | null; api: { current: ViewportApi | null } }) {
  const rf = useReactFlow();
  useEffect(() => {
    api.current = {
      fit: () => container && void rf.setViewport(fitViewport(width, height, container.clientWidth, container.clientHeight, 0.15)),
      actual: () => container && void rf.setViewport(fitViewport(width, height, container.clientWidth, container.clientHeight, 1)),
    };
    return () => { api.current = null; };
  }, [rf, width, height, container, api]);
  return null;
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
  const { index } = useModel();
  const { model } = useModel().bundle;
  const journeys = model.journeys;
  const [params, setParams] = useSearchParams();
  const { focusId, setFocus } = useSelection();

  const requested = params.get("journey");
  const journey = journeys.find((j) => j.id === requested) ?? journeys.find((j) => !j.deferred) ?? journeys[0];
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const viewportApi = useRef<ViewportApi | null>(null);
  const narrow = useViewportWidth() < NARROW;
  const href = useKeepParams();
  const systemName = useModel().index.model.system.name;
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
      data: { label: LANE_LABELS[b.lane], lane: b.lane, width: graph.width + LANE_LABEL_W, height: b.height, empty: b.empty },
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
        data: { ...e.data!, flow: !!activeStep && (e.source === activeStep || e.target === activeStep) },
        focusable: false,
        // Failure is not colour alone: the label says so.
        ...(e.data?.failure && { label: `✕ failure${e.data.when ? `: ${e.data.when}` : ""}` }),
        markerEnd: { type: MarkerType.ArrowClosed, color: e.data?.failure ? DANGER : FLOW },
        labelBgPadding: [4, 2] as [number, number],
      })),
    [graph.edges, activeStep],
  );

  const ctx = useMemo(() => ({ activeStep, pick }), [activeStep, pick]);

  // A newly selected step ripples the Shell's ambient field from the node.
  const announced = useRef(activeStep);
  useEffect(() => {
    if (activeStep === announced.current) return;
    announced.current = activeStep;
    if (!activeStep || !canvas) return;
    requestAnimationFrame(() => announceSelect(flowNodeElement(activeStep, canvas)));
  }, [activeStep, canvas]);

  if (!journey) {
    return (
      <section aria-labelledby="view-title">
        <PageHeader title="Journeys" purpose={`How people and services move through ${systemName}.`} />
        <EmptyState title="No journeys yet." action={<Link to={href("work", { panel: "intent" })}>Describe a change</Link>}>
          Journeys come from the Genome; describe one in a change.
        </EmptyState>
      </section>
    );
  }

  const uses = journey.features.map((f) => index.byId(f)?.name ?? f);
  const ordered = orderedJourneys(journeys);
  return (
    <section className={styles.view} aria-labelledby="view-title">
      <PageHeader title="Journeys" purpose={`How people and services move through ${systemName}.`} />
      <div className={styles.body}>
        {narrow ? (
          <div className={styles.picker}>
            <Select
              aria-label="Journey" value={journey.id} onChange={select}
              options={ordered.map((j) => ({ value: j.id, label: j.deferred ? `${j.name} (deferred)` : j.name }))}
            />
          </div>
        ) : (
          <JourneyCatalog journeys={journeys} activeId={journey.id} onSelect={select} />
        )}
        <div className={styles.stage}>
          <div className={styles.stageHead}>
            <div className={styles.stageTitle}>
              <h2 className={styles.journeyName}>{journey.name}{journey.deferred && <> <StatusText status="deferred" label="deferred" /></>}</h2>
              <p className={styles.goal}>{journey.actorGoal}</p>
              {uses.length > 0 && <p className={styles.uses}>Uses {uses.join(", ")}</p>}
            </div>
            <div className={styles.zoom}>
              <Button size="compact" onClick={() => viewportApi.current?.fit()}>Fit</Button>
              <Button size="compact" onClick={() => viewportApi.current?.actual()}>100%</Button>
            </div>
          </div>
          {segments.length > 0 && (
            <Tabs
              label="Segment"
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
                  edgeTypes={edgeTypes}
                  defaultViewport={{ x: 0, y: 0, zoom: READABLE_ZOOM }}
                  minZoom={0.15}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  nodesFocusable={false}
                  edgesFocusable={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={24} />
                  <Controls showInteractive={false} showFitView={false} position="bottom-right" />
                  <ViewportControls width={graph.width} height={graph.height} container={canvas} api={viewportApi} />
                  <ViewportEffects fitKey={`${journey.id}:${segment}:${graph.layoutReady}`} width={graph.width} height={graph.height} container={canvas} />
                </ReactFlow>
              </ReactFlowProvider>
            </StepContext.Provider>
          </div>
          <p className={styles.hint}><Kbd keys={["+"]} /> <Kbd keys={["-"]} /> zoom <Kbd keys={["0"]} /> fit</p>
          <Legend />
          <details className={styles.steps} key={narrow ? "narrow" : "wide"}>
            <summary>Steps ({graph.nodes.length}){activeStep ? <>, current <code>{activeStep}</code></> : null}</summary>
            <RowList label="Steps">
              {graph.nodes.map((n) => (
                <Row
                  key={n.id} current={activeStep === n.id} onSelect={() => pick(n.id)}
                  title={<><code>{n.data.step.id}</code> {n.data.step.action}</>}
                  meta={`${LANE_LABELS[n.data.lane]}, ${n.data.step.kind}`}
                  status={n.data.failure ? <StatusText status="failure" tone="fail" /> : n.data.unresolved ? <StatusText status="provisional" /> : undefined}
                  tone={n.data.failure ? "fail" : "neutral"}
                />
              ))}
            </RowList>
          </details>
        </div>
      </div>
    </section>
  );
}
