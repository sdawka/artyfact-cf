import { layerOf, type CriterionLayer } from "@artyfact/model";
import type { AssayHook, Criterion } from "../../shared/api";
import type { IndexEntry } from "./index";

/** The three criteria layers (docs/design/task-fork-model.md §3) in reading order, with the UI's words for each. */
export const LAYER_ORDER: readonly CriterionLayer[] = ["genome", "realization", "phenome"];
export const LAYER_WORDS: Record<CriterionLayer, { label: string; says: string }> = {
  genome: { label: "Model", says: "the model exists and is consistent" },
  realization: { label: "Realization", says: "the code realizes the pinned nodes" },
  phenome: { label: "Running thing", says: "the running Thing behaves" },
};
export const UNKNOWN_LAYER = { label: "Layer unknown", says: "no layer recorded for these checks" };

export interface LayerGroup<T> {
  layer: CriterionLayer | "unknown";
  label: string;
  says: string;
  items: T[];
}

/** Non-empty groups in layer order (Model, Realization, Running thing), then whatever has no layer. */
export function groupByLayer<T>(items: readonly T[], layerFor: (item: T) => CriterionLayer | undefined): LayerGroup<T>[] {
  const by = new Map<CriterionLayer | "unknown", T[]>();
  for (const item of items) {
    const l = layerFor(item) ?? "unknown";
    by.set(l, [...(by.get(l) ?? []), item]);
  }
  const out: LayerGroup<T>[] = [];
  for (const layer of LAYER_ORDER) {
    const its = by.get(layer);
    if (its?.length) out.push({ layer, ...LAYER_WORDS[layer], items: its });
  }
  const rest = by.get("unknown");
  if (rest?.length) out.push({ layer: "unknown", ...UNKNOWN_LAYER, items: rest });
  return out;
}

type ModelLookup = { byId(id: string): IndexEntry | undefined; hooksFor(criterionId: string): AssayHook[] };

/** The layer of a criterion in the loaded model (`layerOf` over its targetKind and hooks); undefined when it is not a criterion there. */
export function layerFromModel(m: ModelLookup, criterionId: string): CriterionLayer | undefined {
  const entry = m.byId(criterionId);
  if (entry?.type !== "criterion") return undefined;
  return layerOf(entry.item as Criterion, m.hooksFor(criterionId));
}

/** A server-sent layer map first (`TaskReview.layers`, `checkLayers`), else the loaded model. */
export const layerFor = (layers: Record<string, CriterionLayer> | undefined, m: ModelLookup | null, criterionId: string): CriterionLayer | undefined =>
  layers?.[criterionId] ?? (m ? layerFromModel(m, criterionId) : undefined);
