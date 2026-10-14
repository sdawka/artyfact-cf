import { useReviewQueue } from "@/views/review/useReviewQueue";

/** One pending import, legacy realization, submitted Task, or integrated plan per decision. */
export function useReviewCount(): number {
  return useReviewQueue().count;
}
