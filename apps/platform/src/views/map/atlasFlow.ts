import { MarkerType, Position } from "@xyflow/react";
import type { ModelIndex } from "@/model/index";
import { relationDirections } from "./atlasRelationStyle";
import { selectedBoundaryEdges } from "./atlasConnections";
import type { Layer } from "@/model/useSelection";
import type { AtlasLayout } from "./atlasLayout";
import { ENVIRONMENT_SCOPE, type MapGraph } from "./useMapGraph";
import type { CrossLinkFlowEdge, MapFlowNode, MapNodeData } from "./nodes/types";

export function atlasFlowNodes(graph: MapGraph, layout: AtlasLayout, extra: {
  layer: Layer; focusId: string | null; halos: Map<string, string[]>; status: Map<string, MapNodeData["status"]>;
  relationEdges?: readonly { source: string; target: string }[]; emphasizedIds?: ReadonlySet<string>;
  onOpen: MapNodeData["onOpen"]; describe: (id: string) => string;
}): MapFlowNode[] {
  const directions = relationDirections(layout, extra.relationEdges ?? []);
  return [...graph.nodes].sort((a, b) => Number(b.role === "scope") - Number(a.role === "scope")).flatMap((node) => {
    const box = layout.boxes[node.id];
    if (!box) return [];
    return [{
      id: node.id,
      type: node.role === "scope" ? "scope" : node.role === "external" ? "external" : "subject",
      position: { x: box.x, y: box.y },
      width: box.width, height: box.height,
      handles: [{ type: "target", position: Position.Left, x: 0, y: box.height / 2, width: 0, height: 0 }, { type: "source", position: Position.Right, x: box.width, y: box.height / 2, width: 0, height: 0 }],
      style: { width: box.width, height: box.height },
      data: { node, metrics: layout.metrics[node.id], relation: directions.get(node.id), emphasized: extra.emphasizedIds?.has(node.id), layer: extra.layer, candidates: extra.halos.get(node.id) ?? [], dim: false, status: extra.status.get(node.id), onOpen: extra.onOpen },
      selected: node.id === extra.focusId, draggable: false, connectable: false, zIndex: node.role === "scope" ? 0 : 1,
      ariaLabel: [node.name, node.kind, node.role === "outside" ? "outside this scope, inside System" : node.role === "external" ? "outside System" : node.role === "scope" ? "current scope" : "", node.description, node.childCount ? `${node.childCount} inside` : "", extra.describe(node.id)].filter(Boolean).join(", "),
    }] as MapFlowNode[];
  });
}

/** Geometry never depends on selection or connection visibility. */
export function atlasFlowEdges(graph: MapGraph, focusId: string | null, showAll: boolean, index?: ModelIndex, hoverId: string | null = null): CrossLinkFlowEdge[] {
  const selected = selectedBoundaryEdges(graph, focusId, index);
  const hovered = selectedBoundaryEdges(graph, hoverId, index);
  const active = new Set([...selected, ...hovered].map((edge) => edge.id));
  // Environment scope draws its Environment-to-System edges by default. Links between two outside nodes are context, never drawn.
  const roles = new Map(graph.nodes.map((node) => [node.id, node.role]));
  const faraway = (role?: string) => role === "outside" || role === "external";
  const contextual = (edge: { source: string; target: string }) => (roles.get(edge.source) === "outside" || roles.get(edge.source) === "external") && (roles.get(edge.target) === "outside" || roles.get(edge.target) === "external");
  const shown = showAll || graph.scope === ENVIRONMENT_SCOPE ? graph.edges : [...new Map([...selected, ...hovered].map(edge => [edge.id, edge])).values()];
  return shown.filter((edge) => !contextual(edge)).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, type: "crossLink",
    data: { edge, outsideEnd: faraway(roles.get(edge.source)) ? "source" : faraway(roles.get(edge.target)) ? "target" : undefined, dim: false, active: active.has(edge.id), flow: active.has(edge.id), showLabel: true },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--color-border-strong)" },
    selectable: false, focusable: false,
  }));
}
