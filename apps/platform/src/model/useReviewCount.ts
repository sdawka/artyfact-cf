import { useReviewQueue } from "@/views/review/useReviewQueue";

/**
 * How many decisions wait on a person in the current System's Review: open app candidates (stale ones included) and
 * Genome amendments awaiting an admin, one each, plus a pending import review (`waitingCount`; a promotable candidate is
 * not counted twice). Home reads the realization part from the server (`realizationCounts.awaitingReview`). The rail
 * shows it when above zero.
 */
export function useReviewCount(): number {
  return useReviewQueue().count;
}
