import { useQuery } from "@tanstack/react-query";
import { useAdminToken } from "@/api/adminToken";
import { useClientMode } from "@/api/queries";
import { lifecycleApi } from "@/api/lifecycle";

/**
 * Realization plan reads. Ruling 7: plan GETs follow the System's visibility like /work, so they read without a token;
 * the token is sent when set. Plans emit no SSE events: the open plan polls every 5 s.
 * Keys start with [name, systemId] so one invalidation hits every variant.
 */
export const planKeys = {
  plans: (s: string) => ["plans", s] as const,
  plan: (s: string, p: string) => ["plan", s, p] as const,
  review: (s: string, p: string, updatedAt: string) => ["implementation-review", s, p, updatedAt] as const,
  /** Under "systems", so the SSE `system.*` invalidations refresh it too. */
  system: (s: string) => ["systems", s, "summary"] as const,
};

export function useApiMode(): boolean {
  return useClientMode().data === "api";
}

export function usePlans(systemId: string, enabled: boolean) {
  const { token } = useAdminToken();
  return useQuery({ queryKey: planKeys.plans(systemId), queryFn: () => lifecycleApi.plans(systemId, token), refetchInterval: 5000, enabled, retry: false });
}

export function usePlan(systemId: string, planId: string | null, enabled: boolean) {
  const { token } = useAdminToken();
  return useQuery({ queryKey: planKeys.plan(systemId, planId ?? ""), queryFn: () => lifecycleApi.plan(systemId, planId!, token), refetchInterval: 5000, enabled: enabled && !!planId, retry: false });
}

/**
 * The System's live summary (`GET /api/systems/:id`). The list's counts are only as fresh as the last registry refresh,
 * and a lapsed lease changes `planCounts.awaitingAgent` with no write at all, so per-System counts come from here.
 */
export function useSystemSummary(systemId: string | undefined) {
  const api = useApiMode();
  return useQuery({
    queryKey: planKeys.system(systemId ?? ""),
    queryFn: () => lifecycleApi.system(systemId!),
    enabled: api && !!systemId,
    refetchInterval: 15_000,
    retry: false,
  });
}
