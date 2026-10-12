import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Evaluation } from "../../shared/api";
import { useEvaluations, useHistory } from "@/api/queries";
import { buildIndex, type ModelIndex } from "./index";
import { offTriggerHookIds } from "../../shared/verdict";
import { rollup, verdictOf, verdictScope, type Rollup, type UiVerdict, type VerdictScope } from "./status";
import type { UiBundle } from "./types";
import { useSelection, useSystemRoute } from "./useSelection";

export interface ModelApi extends Omit<ModelIndex, "model" | "entries"> {
  bundle: UiBundle;
  index: ModelIndex;
  /** Whose evaluations count: `?candidates=` if set, else candidates promoted into this revision. */
  scope: VerdictScope;
  /** All evaluations loaded for the System (unscoped; filter with `scope` before showing verdicts). */
  evaluations: readonly Evaluation[];
  /** Verdict of a criterion within `scope`. */
  verdictOf(criterionId: string): UiVerdict;
  /** Verdict counts for `id` and its descendants within `scope`. */
  rollup(id: string): Rollup;
  /** Hooks that never run before promotion (their not-run rows do not count against a verdict). */
  offTrigger: ReadonlySet<string>;
}

const ModelContext = createContext<ModelApi | null>(null);

/** Provides `useModel()` for one bundle. The route layout mounts it; it needs the router. */
export function ModelProvider({ bundle, children }: { bundle: UiBundle; children: ReactNode }) {
  const index = useMemo(() => buildIndex(bundle), [bundle]);
  const { data: evaluations } = useEvaluations();
  const { data: commits } = useHistory();
  const { candidates } = useSelection();
  const { rev } = useSystemRoute();
  const scope = useMemo(() => verdictScope(candidates, commits ?? [], rev), [candidates, commits, rev]);
  const value = useMemo<ModelApi>(() => {
    const { model: _model, entries: _entries, ...lookups } = index;
    const evals = evaluations ?? [];
    const offTrigger = offTriggerHookIds(index.model.hooks);
    return {
      ...lookups,
      bundle,
      index,
      scope,
      evaluations: evals,
      offTrigger,
      verdictOf: (cid) => verdictOf(cid, evals, scope, offTrigger),
      rollup: (id) => rollup(index, id, evals, scope, offTrigger),
    };
  }, [bundle, index, evaluations, scope]);
  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel(): ModelApi {
  const m = useContext(ModelContext);
  if (!m) throw new Error("useModel() needs a <ModelProvider> (mounted by the /s/:systemId/r/:rev route)");
  return m;
}

/** `useModel()` that returns null outside a provider (for components usable anywhere, like NodeChip). */
export const useModelOptional = () => useContext(ModelContext);
