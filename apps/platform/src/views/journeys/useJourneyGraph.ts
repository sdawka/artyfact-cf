import type { Edge, Node } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { Journey, JourneyStep } from "@/model/types";
import {
  DECISION_H,
  DECISION_W,
  NODE_H,
  NODE_W,
  depthColumns,
  elkColumns,
  placeInLanes,
  type Lane,
  type LaneBand,
  type LayoutNode,
} from "./layout";

export type StepNodeType = "action" | "system" | "external" | "wait" | "decision" | "terminal";

export interface StepNodeData extends Record<string, unknown> {
  journeyId: string;
  step: JourneyStep;
  lane: Lane;
  /** The step is a `failure` kind. */
  failure: boolean;
  /** Provisional: shown dotted with a "?". */
  unresolved: boolean;
}
export type StepNode = Node<StepNodeData, StepNodeType>;
export interface StepEdgeData extends Record<string, unknown> {
  /** The edge leads into a `failure` step. */
  failure: boolean;
  when?: string;
  /** Touches the selected step: drawn with an animated flow. */
  flow?: boolean;
}
export type StepEdge = Edge<StepEdgeData>;

/** Which swim lane a step sits in. */
export function laneOf(step: JourneyStep): Lane {
  if (step.actor === "system") return "system";
  if (step.actor === "external") return "external";
  // A person handing off to an external service (no screen of ours) acts in the external lane.
  if (step.external && !step.screen && !step.operation) return "external";
  return "actor";
}

export function nodeTypeOf(step: JourneyStep): StepNodeType {
  switch (step.kind) {
    case "wait":
      return "wait";
    case "branch":
      return "decision";
    case "end":
      return "terminal";
    default:
      if (step.external && step.actor === "external") return "external";
      if (step.actor === "system") return "system";
      if (step.actor === "external") return "external";
      return "action";
  }
}

const sizeOf = (t: StepNodeType) => (t === "decision" ? { w: DECISION_W, h: DECISION_H } : { w: NODE_W, h: NODE_H });

export interface JourneyGraphStructure {
  nodes: StepNode[];
  edges: StepEdge[];
  layoutNodes: LayoutNode[];
}

/** Pure: steps → typed nodes and edges, without positions. `visible` limits to a segment's step ids. */
export function buildJourneyGraph(journey: Journey | undefined, visible?: readonly string[]): JourneyGraphStructure {
  if (!journey) return { nodes: [], edges: [], layoutNodes: [] };
  const keep = visible ? new Set(visible) : null;
  const steps = journey.steps.filter((s) => !keep || keep.has(s.id));
  const byId = new Map(steps.map((s) => [s.id, s]));
  const layoutNodes: LayoutNode[] = [];
  const nodes: StepNode[] = steps.map((step) => {
    const type = nodeTypeOf(step);
    const lane = laneOf(step);
    layoutNodes.push({ id: step.id, lane, ...sizeOf(type) });
    return {
      id: step.id,
      type,
      position: { x: 0, y: 0 },
      data: { journeyId: journey.id, step, lane, failure: step.kind === "failure", unresolved: step.unresolved },
      width: sizeOf(type).w,
      height: sizeOf(type).h,
      style: { width: sizeOf(type).w, height: sizeOf(type).h },
    };
  });
  const edges: StepEdge[] = [];
  for (const step of steps) {
    step.next.forEach((n, i) => {
      const target = byId.get(n.to);
      if (!target) return;
      const failure = target.kind === "failure";
      edges.push({
        id: `${step.id}->${n.to}#${i}`,
        source: step.id,
        target: n.to,
        type: "smoothstep",
        label: n.when,
        data: { failure, when: n.when },
        className: failure ? "journey-edge--failure" : undefined,
      });
    });
  }
  return { nodes, edges, layoutNodes };
}

export interface JourneyGraph extends JourneyGraphStructure {
  bands: LaneBand[];
  width: number;
  height: number;
  /** elk has answered; before that, columns come from a simple depth layering. */
  layoutReady: boolean;
}

/** Nodes, edges and lane bands for one journey (or one segment of it), positioned by elk. */
export function useJourneyGraph(journey: Journey | undefined, visible?: readonly string[]): JourneyGraph {
  const structure = useMemo(() => buildJourneyGraph(journey, visible), [journey, visible]);
  const [solved, setSolved] = useState<{ key: object; columns: Map<string, number> } | null>(null);

  useEffect(() => {
    let live = true;
    const key = structure;
    const edges = structure.edges.map((e) => ({ source: e.source, target: e.target }));
    elkColumns(structure.layoutNodes, edges)
      .then((columns) => live && setSolved({ key, columns }))
      .catch((error) => console.warn("artyfact: journey layout failed, using depth columns", error));
    return () => {
      live = false;
    };
  }, [structure]);

  return useMemo(() => {
    const ready = solved?.key === structure;
    const columns =
      ready && solved
        ? solved.columns
        : depthColumns(structure.layoutNodes, structure.edges.map((e) => ({ source: e.source, target: e.target })));
    const placed = placeInLanes(structure.layoutNodes, columns);
    const nodes = structure.nodes.map((n) => ({ ...n, position: placed.positions.get(n.id) ?? n.position }));
    return { ...structure, nodes, bands: placed.bands, width: placed.width, height: placed.height, layoutReady: ready };
  }, [structure, solved]);
}
