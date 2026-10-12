import { useMemo } from "react";
import type { Evolution, Realization } from "../../../shared/api";
import { useEvolutions } from "@/api/queries";
import { useModel } from "@/model/useModel";

/**
 * Evolutions of the System: the live board (API) wins over the model's declared Evolutions, so
 * fixture mode still shows the Genome's six. Realizations only come from the API.
 */
export function useWorkData(): { evolutions: Evolution[]; realizations: Realization[]; isLoading: boolean } {
  const m = useModel();
  const q = useEvolutions();
  const live = q.data?.evolutions;
  const realizations = q.data?.realizations;
  const declared = m.index.model.evolutions;
  return useMemo(() => {
    const byId = new Map<string, Evolution>();
    for (const e of declared ?? []) byId.set(e.id, e);
    for (const e of live ?? []) byId.set(e.id, e);
    return { evolutions: [...byId.values()], realizations: realizations ?? [], isLoading: q.isLoading };
  }, [declared, live, realizations, q.isLoading]);
}
