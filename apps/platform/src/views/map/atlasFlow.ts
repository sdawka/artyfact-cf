import { MarkerType, Position } from "@xyflow/react";
import type { ModelIndex } from "@/model/index";
import { selectedBoundaryEdges } from "./atlasConnections";
import type { Layer } from "@/model/useSelection";
import type { AtlasLayout } from "./atlasLayout";
import type { MapGraph } from "./useMapGraph";
import type { CrossLinkFlowEdge, MapFlowNode, MapNodeData } from "./nodes/types";

export function atlasFlowNodes(graph: MapGraph, layout: AtlasLayout, extra: {
  layer: Layer; focusId: string | null; halos: Map<string, string[]>; status: Map<string, MapNodeData["status"]>;
  onOpen: MapNodeData["onOpen"]; describe: (id: string) => string;
}): MapFlowNode[] {
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
      data: { node, layer: extra.layer, candidates: extra.halos.get(node.id) ?? [], dim: false, status: extra.status.get(node.id), onOpen: extra.onOpen },
      selected: node.id === extra.focusId, draggable: false, connectable: false, zIndex: node.role === "scope" ? 0 : 1,
      ariaLabel: [node.name, node.kind, node.role === "outside" ? "outside this scope, inside System" : node.role === "external" ? "outside System" : node.role === "scope" ? "current scope" : "", node.description, node.childCount ? `${node.childCount} inside` : "", extra.describe(node.id)].filter(Boolean).join(", "),
    }] as MapFlowNode[];
  });
}

/** Geometry never depends on selection or connection visibility. */
export function atlasFlowEdges(graph: MapGraph, focusId: string | null, showAll: boolean, index?: ModelIndex): CrossLinkFlowEdge[] {
  const selected = selectedBoundaryEdges(graph, focusId, index);
  const active = new Set(selected.map((edge) => edge.id));
  return (showAll ? graph.edges : selected).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, type: "crossLink",
    data: { edge, dim: false, active: active.has(edge.id), flow: active.has(edge.id), showLabel: true },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--color-border-strong)" },
    selectable: false, focusable: false,
  }));
}
