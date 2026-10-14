import { useMemo } from "react";
import { useEvolutions } from "@/api/queries";
import { awaitingReview } from "../review/queue";
import { useReviewQueue } from "../review/useReviewQueue";

export interface EvolutionSignal {
  /** Candidates or amendments of this Evolution waiting in Review. */
  awaiting: number;
  /** Any of its candidates is in a conflict. */
  overlap: boolean;
  /** The other Evolutions its candidates conflict with. */
  overlapWith: string[];
  /** A promotion row waits on Review for this Evolution. */
  promotable: boolean;
  /** The realization of the first waiting row, for "Open in Review". */
  realization?: string;
}

/** Per Evolution: how many candidates or amendments await review, and whether any of its candidates conflicts. */
export function useEvolutionSignals(): { signals: Map<string, EvolutionSignal>; isLoading: boolean } {
  const queue = useReviewQueue();
  const { data: board } = useEvolutions();
  const signals = useMemo(() => {
    const out = new Map<string, EvolutionSignal>();
    const evolutionOf = new Map<string, string>();
    for (const r of board?.realizations ?? []) if (r.candidate) evolutionOf.set(r.candidate, r.evolution);
    for (const c of queue.candidates) evolutionOf.set(c.id, c.evolution);
    const pairs = new Map<string, Set<string>>();
    for (const c of queue.conflicts) {
      const owners = [...new Set((c.candidates ?? []).map((id) => evolutionOf.get(id)).filter((e): e is string => !!e))];
      for (const e of owners) {
        const set = pairs.get(e) ?? new Set<string>();
        for (const o of owners) if (o !== e) set.add(o);
        pairs.set(e, set);
      }
    }
    const conflicted = new Set(pairs.keys());
    for (const e of new Set([...queue.groups.map((g) => g.evolution), ...conflicted])) {
      if (!e) continue;
      const group = queue.groups.find((g) => g.evolution === e);
      const first = group?.rows.find((r) => r.realization && r.kind !== "promotion");
      out.set(e, { awaiting: awaitingReview(group), promotable: !!group?.rows.some((r) => r.kind === "promotion"), overlap: conflicted.has(e), overlapWith: [...(pairs.get(e) ?? [])], ...(first?.realization && { realization: first.realization.id }) });
    }
    return out;
  }, [queue, board]);
  return { signals, isLoading: queue.isLoading };
}
