import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Candidate, ConflictReport } from "../../../shared/api";
import * as api from "@/api/client";
import { qk, useConflicts, useEvolutions, useHistory } from "@/api/queries";
import { useSystemRoute } from "@/model/useSelection";
import { reviewQueue, waitingCount, type QueueGroup } from "./queue";

const WAITING = new Set(["submitted", "evaluated", "selected", "awaiting-admin"]);

export interface ReviewQueue {
  groups: QueueGroup[];
  /** Decisions waiting for a person ({@link waitingCount}): promotion rows are not counted twice. */
  count: number;
  /** Candidates loaded for the Evolutions with something waiting (subjects, base, state). */
  candidates: Candidate[];
  conflicts: ConflictReport[];
  isLoading: boolean;
}

/**
 * The Review queue from the board, the history and the candidates of each Evolution with something waiting. It uses
 * the same queries (and cache) as Work, so the rail count, the Work cards and the Review page agree.
 */
export function useReviewQueue(): ReviewQueue {
  const { systemId } = useSystemRoute();
  const board = useEvolutions();
  const history = useHistory();
  const commits = history.data;
  const { data: conflicts } = useConflicts();
  const realizations = board.data?.realizations;
  const evolutionIds = useMemo(
    () => [...new Set((realizations ?? []).filter((r) => !!r.evolution && WAITING.has(r.status)).map((r) => r.evolution))].sort(),
    [realizations],
  );
  const results = useQueries({
    queries: evolutionIds.map((e) => ({ queryKey: qk.candidates(systemId, e), queryFn: () => api.getCandidates(systemId, e), enabled: !!systemId })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  const loaded = results.map((r) => r.data);
  return useMemo(() => {
    const candidates = loaded.flatMap((d) => d?.candidates ?? []);
    const all = [...(conflicts ?? []), ...loaded.flatMap((d) => d?.conflicts ?? [])];
    const groups = reviewQueue({ evolutions: board.data?.evolutions ?? [], realizations: realizations ?? [], commits, candidates, conflicts: all });
    return { groups, count: waitingCount(groups), candidates, conflicts: all, isLoading: board.isLoading || history.isLoading };
    // `loaded` is a fresh array each render; `stamp` changes when any of it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.data, board.isLoading, history.isLoading, realizations, commits, conflicts, stamp]);
}
