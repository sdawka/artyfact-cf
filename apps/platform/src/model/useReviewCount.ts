import { useSystems } from "@/api/queries";
import { useSystemRoute } from "@/model/useSelection";
import { useReviewQueue } from "@/views/review/useReviewQueue";

/**
 * How many decisions wait on a person in the current System's Review (submitted candidates, amendments awaiting an
 * admin, promotable Evolutions, candidates behind head) plus a pending import review. The rail shows it after "Review"
 * when above zero.
 */
export function useReviewCount(): number {
  const queue = useReviewQueue().count;
  const { systemId } = useSystemRoute();
  const system = useSystems().data?.find((s) => s.systemId === systemId);
  return queue + (system?.importReview?.status === "pending" ? 1 : 0);
}
