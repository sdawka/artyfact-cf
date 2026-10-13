import type { Edge, Node } from "@xyflow/react";
import type { ElkPoint } from "@/graph/elk";
import type { Layer } from "@/model/useSelection";
import type { MapBand, MapEdge, MapNode } from "../useMapGraph";

export interface MapNodeData extends Record<string, unknown> {
  node: MapNode;
  layer: Layer;
  /** Selected candidates touching this node (or its subtree). */
  candidates: string[];
  /** Dimmed while another node is hovered. */
  dim: boolean;
  /** Subtree verdict emphasis: a faint error glow for any fail, success only when every counted criterion passes. */
  status?: "pass" | "fail" | undefined;
  /** Open this node on the Map (double-click / "inside ›"); `viaKeyboard` moves focus to the new frame. */
  onOpen: (id: string, viaKeyboard?: boolean) => void;
}

export interface BoundaryData extends Record<string, unknown> {
  height: number;
}

export interface BandData extends Record<string, unknown> {
  band: MapBand;
}

export interface CrossLinkData extends Record<string, unknown> {
  edge: MapEdge;
  dim: boolean;
  /** Touches the hovered node. */
  active: boolean;
  /** Touches the selected (focused) node: drawn with an animated flow. */
  flow?: boolean;
  /** False when the chip would collide with another (the hovered node's edges are placed first). */
  showLabel?: boolean;
  /** elk route (absolute); straight smooth-step fallback when absent. */
  points?: ElkPoint[];
}

export type SubjectFlowNode = Node<MapNodeData, "subject">;
export type ExternalFlowNode = Node<MapNodeData, "external">;
export type GroupFlowNode = Node<MapNodeData, "scope">;
export type BoundaryFlowNode = Node<BoundaryData, "boundary">;
export type BandFlowNode = Node<BandData, "band">;
export type MapFlowNode = SubjectFlowNode | ExternalFlowNode | GroupFlowNode | BoundaryFlowNode | BandFlowNode;
export type CrossLinkFlowEdge = Edge<CrossLinkData, "crossLink">;
