import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type NodeTypes } from "@xyflow/react";
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

/** Re-fits when the journey, segment or layout changes, and adds `+` / `-` / `0` keyboard zoom. */
function ViewportEffects({ fitKey }: { fitKey: string }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const dom = useStore((s) => s.domNode);
  useEffect(() => {
    const frame = requestAnimationFrame(() => void fitView({ padding: 0.1, minZoom: 0.5, maxZoom: 1, duration: 0 }));
    return () => cancelAnimationFrame(frame);
  }, [fitKey, fitView]);
  useEffect(() => {
    if (!dom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") void zoomIn();
      else if (e.key === "-") void zoomOut();
      else if (e.key === "0") void fitView({ padding: 0.1, minZoom: 0.3, maxZoom: 1 });
      else return;
      e.preventDefault();
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [dom, zoomIn, zoomOut, fitView]);
  return null;
}

export default function JourneysView() {
  const { model } = useModel().bundle;
  const journeys = model.journeys;
  const [params, setParams] = useSearchParams();
  const { focusId, setFocus } = useSelection();

  const requested = params.get("journey");
  const journey = journeys.find((j) => j.id === requested) ?? journeys.find((j) => !j.deferred) ?? journeys[0];
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
          <div className={styles.canvas} data-testid="journey-canvas" aria-label={`${journey.name} flow, ${graph.nodes.length} steps`} role="group">
            <StepContext.Provider value={ctx}>
              <ReactFlowProvider>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.1, minZoom: 0.5, maxZoom: 1 }}
                  minZoom={0.3}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  nodesFocusable={false}
                  edgesFocusable={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={24} />
                  <Controls showInteractive={false} position="bottom-right" />
                  <ViewportEffects fitKey={`${journey.id}:${segment}:${graph.layoutReady}`} />
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
