import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { AcceptRequest, PromoteRequest, Realization, RejectRequest, StartWorkRequest, SubmitRequest } from "../../shared/api";
import { useSystemRoute } from "@/model/useSelection";
import * as api from "./client";

/** Query keys. Invalidate by prefix, e.g. `["evaluations", systemId]`. */
export const qk = {
  systems: () => ["systems"] as const,
  model: (systemId: string, rev: string) => ["model", systemId, rev] as const,
  readiness: (systemId: string, rev: string) => ["readiness", systemId, rev] as const,
  evolutions: (systemId: string) => ["evolutions", systemId] as const,
  realization: (systemId: string, id: string) => ["realization", systemId, id] as const,
  candidates: (systemId: string, evolutionId: string) => ["candidates", systemId, evolutionId] as const,
  evaluations: (systemId: string, candidate?: string) => ["evaluations", systemId, candidate ?? null] as const,
  conflicts: (systemId: string) => ["conflicts", systemId] as const,
  history: (systemId: string) => ["history", systemId] as const,
  packet: (systemId: string, id: string) => ["packet", systemId, id] as const,
  amendmentReview: (systemId: string, id: string) => ["amendmentReview", systemId, id] as const,
};

/** Used by the route loader (`ensureQueryData`) and by `useModelBundle`. */
export const modelQuery = (systemId: string, rev: string) =>
  queryOptions({ queryKey: qk.model(systemId, rev), queryFn: () => api.getModel(systemId, rev), staleTime: 30_000 });

export const useSystems = () => useQuery({ queryKey: qk.systems(), queryFn: api.getSystems });

export function useModelBundle(systemId?: string, rev?: string) {
  const route = useSystemRoute();
  return useQuery(modelQuery(systemId ?? route.systemId, rev ?? route.rev));
}

export function useReadiness() {
  const { systemId, rev } = useSystemRoute();
  return useQuery({ queryKey: qk.readiness(systemId, rev), queryFn: () => api.getReadiness(systemId, rev) });
}

/** Work board data; polled every 5 s (SSE invalidation makes it faster when available). */
export function useEvolutions() {
  const { systemId } = useSystemRoute();
  return useQuery({ queryKey: qk.evolutions(systemId), queryFn: () => api.getEvolutions(systemId), refetchInterval: 5_000 });
}

export function useRealization(realizationId: string | undefined) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.realization(systemId, realizationId ?? ""),
    queryFn: () => api.getRealization(systemId, realizationId!),
    enabled: !!realizationId,
  });
}

export function useCandidates(evolutionId: string | undefined) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.candidates(systemId, evolutionId ?? ""),
    queryFn: () => api.getCandidates(systemId, evolutionId!),
    enabled: !!evolutionId,
  });
}

export function useEvaluations(opts: { candidate?: string } = {}) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.evaluations(systemId, opts.candidate),
    queryFn: () => api.getEvaluations(systemId, opts),
    select: (r) => r.evaluations,
  });
}

export function useConflicts() {
  const { systemId } = useSystemRoute();
  return useQuery({ queryKey: qk.conflicts(systemId), queryFn: () => api.getConflicts(systemId), select: (r) => r.conflicts });
}

export function useHistory() {
  const { systemId } = useSystemRoute();
  return useQuery({ queryKey: qk.history(systemId), queryFn: () => api.getHistory(systemId), select: (r) => r.commits });
}

export function usePacket(realizationId: string | undefined) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.packet(systemId, realizationId ?? ""),
    queryFn: () => api.getPacket(systemId, realizationId!),
    enabled: !!realizationId,
  });
}

/** Rule findings and System One judgments for a Genome-targeting realization. */
export function useAmendmentReview(evolutionId: string | undefined, realizationId: string | undefined) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.amendmentReview(systemId, realizationId ?? ""),
    queryFn: () => api.getAmendmentReview(systemId, evolutionId!, realizationId!),
    enabled: !!realizationId && !!evolutionId,
  });
}

/** Realizations of evolutions whose `affectedNodes` include `nodeId` (Inspector Changes tab). */
export function useRealizationsTouching(nodeId: string | undefined): { data: Realization[]; isLoading: boolean } {
  const q = useEvolutions();
  const data = useMemo(() => {
    if (!nodeId || !q.data) return [];
    const evolutions = new Set(q.data.evolutions.filter((e) => e.affectedNodes.includes(nodeId)).map((e) => e.id));
    return q.data.realizations.filter((r) => evolutions.has(r.evolution));
  }, [nodeId, q.data]);
  return { data, isLoading: q.isLoading };
}

// ---------------------------------------------------------------------------
// Mutations (each invalidates the board; promotion also the model and history)
// ---------------------------------------------------------------------------

export function useStartWork() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ evolutionId, body, adminToken }: { evolutionId: string; body?: StartWorkRequest; adminToken?: string }) =>
      api.startWork(systemId, evolutionId, body, adminToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.evolutions(systemId) }),
  });
}

export function useSubmit() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ realizationId, body }: { realizationId: string; body: SubmitRequest }) =>
      api.submit(systemId, realizationId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.evolutions(systemId) });
      void qc.invalidateQueries({ queryKey: ["candidates", systemId] });
      void qc.invalidateQueries({ queryKey: ["evaluations", systemId] });
    },
  });
}

/** Errors with `api.StaleBaseError` on 409. */
export function usePromote() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, adminToken }: { body: PromoteRequest; adminToken?: string }) => api.promote(systemId, body, adminToken),
    onSettled: () => {
      for (const k of ["evolutions", "candidates", "history", "model", "readiness", "systems"]) {
        void qc.invalidateQueries({ queryKey: k === "systems" ? [k] : [k, systemId] });
      }
    },
  });
}

export function useAcceptAmendment() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ evolutionId, body, adminToken }: { evolutionId: string; body: AcceptRequest; adminToken?: string }) =>
      api.acceptAmendment(systemId, evolutionId, body, adminToken),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["model", systemId] });
      void qc.invalidateQueries({ queryKey: qk.evolutions(systemId) });
    },
  });
}

export function useRejectAmendment() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ realizationId, body, adminToken }: { realizationId: string; body: RejectRequest; adminToken?: string }) =>
      api.rejectAmendment(systemId, realizationId, body, adminToken),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.evolutions(systemId) });
      void qc.invalidateQueries({ queryKey: ["realization", systemId] });
    },
  });
}

/** Subscribes to System events for the current route and invalidates the affected queries. Mount once (Shell does). */
export function useSystemEvents() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  useEffect(
    () =>
      api.subscribeEvents(systemId, (e) => {
        const inv = (...keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k, systemId] }));
        switch (e.type) {
          case "evaluation.completed":
            return inv("evaluations", "candidates");
          case "candidate.submitted":
          case "conflict.detected":
            return inv("candidates", "conflicts", "evolutions");
          case "system.promoted":
            return inv("history", "model", "readiness", "evolutions", "candidates");
          case "genome.accepted":
            return inv("model", "readiness", "evolutions");
          default:
            return inv("evolutions", "realization");
        }
      }),
    [systemId, qc],
  );
}
