import { useReviewQueue } from "@/views/review/useReviewQueue";

/**
 * How many decisions wait on a person in the current System's Review (submitted candidates, amendments awaiting an
 * admin, promotable Evolutions, candidates behind head). The rail shows it after "Review" when above zero.
 */
export function useReviewCount(): number {
  return useReviewQueue().count;
}
