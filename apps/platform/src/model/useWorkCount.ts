import { useEvolutions } from "@/api/queries";
import { taskSignals } from "@/views/work/plan/signals";

/** How many Evolutions have a plan ready or tasks waiting on an agent. The rail shows it after "Work" when above zero. */
export function useWorkCount(): number {
  const evolutions = useEvolutions().data?.evolutions ?? [];
  return evolutions.filter((e) => {
    const s = taskSignals(e);
    return s.planReady || s.awaitingAgent > 0;
  }).length;
}
