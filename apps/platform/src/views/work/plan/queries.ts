import { useQuery } from "@tanstack/react-query";
import { useAdminToken } from "@/api/adminToken";
import { useClientMode } from "@/api/queries";
import { lifecycleApi } from "@/api/lifecycle";

/**
 * Realization plan reads. The token is sent when set; see `PUBLIC_PLAN_READS` for reads without one. Plans emit no SSE
 * events: the open plan polls every 5 s.
 * Keys start with [name, systemId] so one invalidation hits every variant.
 */
export const planKeys = {
  plans: (s: string) => ["plans", s] as const,
  plan: (s: string, p: string) => ["plan", s, p] as const,
  review: (s: string, p: string, updatedAt: string) => ["implementation-review", s, p, updatedAt] as const,
  /** Under "systems", so the SSE `system.*` invalidations refresh it too. */
  system: (s: string) => ["systems", s, "summary"] as const,
};

/**
 * Ruling 7: plan GETs follow the System's visibility, so a public System's plans read without a token. The routes on
 * this branch still require admin, and a tokenless read would 401 (a console error on every Work visit), so reads wait
 * for the token until the GET guards change. TODO(P10): set true when `worker/routes/lifecycle.ts` makes the GETs public.
 */
export const PUBLIC_PLAN_READS = false;

export function useApiMode(): boolean {
  return useClientMode().data === "api";
}

export function usePlans(systemId: string, enabled: boolean) {
  const { token } = useAdminToken();
  return useQuery({ queryKey: planKeys.plans(systemId), queryFn: () => lifecycleApi.plans(systemId, token), refetchInterval: 5000, enabled: enabled && (PUBLIC_PLAN_READS || !!token), retry: false });
}

export function usePlan(systemId: string, planId: string | null, enabled: boolean) {
  const { token } = useAdminToken();
  return useQuery({ queryKey: planKeys.plan(systemId, planId ?? ""), queryFn: () => lifecycleApi.plan(systemId, planId!, token), refetchInterval: 5000, enabled: enabled && !!planId && (PUBLIC_PLAN_READS || !!token), retry: false });
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
