import { useSystemSummary } from "@/views/work/plan/queries";
import { workWaiting } from "@/views/work/plan/signals";
import { useSystemRoute } from "./useSelection";

/**
 * Plan work waiting in the current System (`workWaiting` over `planCounts`). Read live from `GET /api/systems/:id`,
 * because the System list is only as fresh as the last registry refresh. The rail shows it after "Work" when above zero.
 */
export function useWorkCount(): number {
  const { systemId } = useSystemRoute();
  return workWaiting(useSystemSummary(systemId).data?.planCounts);
}
