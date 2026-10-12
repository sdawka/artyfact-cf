import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import * as api from "@/api/client";
import { qk, useEvolutions } from "@/api/queries";
import { useSystemRoute } from "@/model/useSelection";

/**
 * Candidate id -> model ids it touches. Uses the candidate's `changedSubjects` (unmapped paths
 * dropped) when its evolution's candidates are loaded, else the evolution's `affectedNodes`.
 */
export function useCandidateTouches(candidateIds: readonly string[]): Map<string, string[]> {
  const { systemId } = useSystemRoute();
  const { data: board } = useEvolutions();
  const evolutionOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of board?.realizations ?? []) if (r.candidate) m.set(r.candidate, r.evolution);
    return m;
  }, [board]);
  const evolutions = useMemo(
    () => [...new Set(candidateIds.map((c) => evolutionOf.get(c)).filter((e): e is string => !!e))],
    [candidateIds, evolutionOf],
  );
  const results = useQueries({
    queries: evolutions.map((evo) => ({ queryKey: qk.candidates(systemId, evo), queryFn: () => api.getCandidates(systemId, evo) })),
  });
  const loaded = results.map((r) => r.data);
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  return useMemo(() => {
    const out = new Map<string, string[]>();
    const byId = new Map(loaded.flatMap((d) => d?.candidates ?? []).map((c) => [c.id, c]));
    for (const id of candidateIds) {
      const cand = byId.get(id);
      const evo = board?.evolutions.find((e) => e.id === evolutionOf.get(id));
      const subjects = cand ? cand.changedSubjects.filter((s) => !s.startsWith("unmapped:")) : (evo?.affectedNodes ?? []);
      out.set(id, subjects);
    }
    return out;
    // `loaded` is a fresh array each render; `stamp` changes when any of it does.
  }, [candidateIds, board, evolutionOf, stamp]);
}
