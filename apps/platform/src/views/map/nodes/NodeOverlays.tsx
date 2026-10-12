import { useRealizationsTouching } from "@/api/queries";
import { PhenomeBadge } from "../overlays/PhenomeBadge";
import { ProteomeBadge } from "../overlays/ProteomeBadge";
import type { MapNodeData } from "./types";

/** Realization count for the ring; only queried on the proteome layer. */
export function useRealizationCount(id: string, layer: MapNodeData["layer"]) {
  return useRealizationsTouching(layer === "proteome" ? id : undefined).data.length;
}

/** The layer's badge row for a node. */
export function LayerBadges({ id, layer, realizations }: { id: string; layer: MapNodeData["layer"]; realizations: number }) {
  if (layer === "phenome") return <PhenomeBadge id={id} />;
  if (layer === "proteome") return <ProteomeBadge count={realizations} />;
  return null;
}
