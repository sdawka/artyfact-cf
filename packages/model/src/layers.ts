import type { AssayHook, Criterion } from "./schema.ts";

/**
 * The three criteria layers (docs/design/task-fork-model.md §3): `genome` says the model exists and is consistent,
 * `realization` says the code realizes the pinned nodes, `phenome` says the running Thing behaves. The layer is the
 * criterion's `targetKind` (model → genome, artifact → realization, runtime | observation → phenome); without one it
 * is read off the engines of its hooks.
 */
export type CriterionLayer = "genome" | "realization" | "phenome";

const BY_TARGET: Record<string, CriterionLayer> = { model: "genome", artifact: "realization", runtime: "phenome", observation: "phenome" };
const BY_ENGINE: Record<string, CriterionLayer> = { "model-rules": "genome", "system-one": "genome", llm: "genome", manifest: "realization", diff: "realization", vitest: "realization", http: "phenome", browser: "phenome" };

export function layerOf(c: Pick<Criterion, "targetKind">, hooks: Pick<AssayHook, "engine">[] = []): CriterionLayer {
  const byTarget = c.targetKind && BY_TARGET[c.targetKind];
  if (byTarget) return byTarget;
  const engines = [...new Set(hooks.map((h) => BY_ENGINE[h.engine]).filter((l): l is CriterionLayer => !!l))];
  return engines.length === 1 ? engines[0]! : engines.includes("phenome") ? "phenome" : engines.includes("realization") ? "realization" : "genome";
}
