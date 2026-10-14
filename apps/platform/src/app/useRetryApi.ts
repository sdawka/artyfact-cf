import { useQueryClient } from "@tanstack/react-query";
import { resetClientMode } from "@/api/client";

/** Leaves fixture mode and refetches everything (the "Retry API" action). */
export function useRetryApi() {
  const qc = useQueryClient();
  return () => { resetClientMode(); void qc.invalidateQueries(); };
}
