import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useEvaluations } from "@/api/queries";
import { buildIndex, type ModelIndex } from "./index";
import { rollup, type Rollup } from "./status";
import type { UiBundle } from "./types";

export interface ModelApi extends Omit<ModelIndex, "model" | "entries"> {
  bundle: UiBundle;
  index: ModelIndex;
  /** Verdict counts for `id` and its descendants, from the current evaluations. */
  rollup(id: string, opts?: { candidate?: string }): Rollup;
}

const ModelContext = createContext<ModelApi | null>(null);

/** Provides `useModel()` for one bundle. The route layout mounts it; tests can mount it directly. */
export function ModelProvider({ bundle, children }: { bundle: UiBundle; children: ReactNode }) {
  const index = useMemo(() => buildIndex(bundle), [bundle]);
  const evaluations = useEvaluations();
  const evals = evaluations.data;
  const value = useMemo<ModelApi>(() => {
    const { model: _model, entries: _entries, ...lookups } = index;
    return { ...lookups, bundle, index, rollup: (id, opts) => rollup(index, id, evals ?? [], opts) };
  }, [bundle, index, evals]);
  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel(): ModelApi {
  const m = useContext(ModelContext);
  if (!m) throw new Error("useModel() needs a <ModelProvider> (mounted by the /s/:systemId/r/:rev route)");
  return m;
}

/** `useModel()` that returns null outside a provider (for components usable anywhere, like NodeChip). */
export const useModelOptional = () => useContext(ModelContext);
