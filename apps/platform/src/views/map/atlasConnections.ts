import type { ModelIndex } from "@/model/index";
import type { Certainty } from "@/model/types";
import { certaintyStroke, type MapEdge, type MapGraph } from "./useMapGraph";

const DOUBT: Record<Certainty, number> = { declared: 0, observed: 0, derived: 1, assumed: 2, hypothesis: 3, proposed: 4 };

/** Select the actual subtree cut, not merely edges attached to its projected scope frame. */
export function selectedBoundaryEdges(graph: MapGraph, id: string | null, index?: ModelIndex): MapEdge[] {
  if (!id) return [];
  const inside = index ? new Set([id, ...index.descendants(id)]) : new Set(id === graph.scope ? graph.nodes.filter((node) => node.role === "scope" || node.role === "child").map((node) => node.id) : [id]);
  return graph.edges.flatMap((edge) => {
    const members = index ? edge.members.filter((member) => inside.has(member.from) !== inside.has(member.to)) : inside.has(edge.source) !== inside.has(edge.target) ? edge.members : [];
    if (!members.length) return [];
    const certainty = members.reduce((least, member) => DOUBT[member.certainty] > DOUBT[least] ? member.certainty : least, members[0]!.certainty);
    const { label: _label, ...rest } = edge;
    return [{ ...rest, members, count: members.length, certainty, stroke: certaintyStroke(certainty), ...(members.length === 1 && members[0]!.label && { label: members[0]!.label }) }];
  });
}

/** Project the outside half of the same cut for offscreen discovery. */
export function boundaryContextIds(graph: MapGraph, id: string | null, index: ModelIndex): string[] {
  if (!id) return [];
  const inside = new Set([id, ...index.descendants(id)]);
  return [...new Set(selectedBoundaryEdges(graph, id, index).flatMap((edge) => [edge.source, edge.target]).filter((endpoint) => !inside.has(endpoint)))];
}
