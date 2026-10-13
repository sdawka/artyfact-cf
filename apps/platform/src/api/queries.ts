import { queryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type {
  AcceptRequest, BuildKind, CommitHash, CreateEvolutionRequest, EditorCommitRequest, EditorCommitResponse, FileScope,
  PhenomeEventsQuery, PromoteRequest, Realization, RejectRequest, StartWorkRequest,
} from "../../shared/api";
import type { TemplateUpgradeRequest } from "../../shared/api";
import { emitFx } from "@/effects/fx";
import { useSystemRoute } from "@/model/useSelection";
import * as api from "./client";

/** Query keys. Invalidate by prefix, e.g. `["evaluations", systemId]`. */
export const qk = {
  systems: () => ["systems"] as const,
  parts: () => ["parts"] as const,
  part: (partId: string, version: string) => ["part", partId, version] as const,
  clientMode: () => ["clientMode"] as const,
  model: (systemId: string, rev: string) => ["model", systemId, rev] as const,
  readiness: (systemId: string, rev: string) => ["readiness", systemId, rev] as const,
  evolutions: (systemId: string) => ["evolutions", systemId] as const,
  candidates: (systemId: string, evolutionId: string) => ["candidates", systemId, evolutionId] as const,
  evaluations: (systemId: string, candidate?: string) => ["evaluations", systemId, candidate ?? null] as const,
  conflicts: (systemId: string) => ["conflicts", systemId] as const,
  history: (systemId: string) => ["history", systemId] as const,
  amendmentReview: (systemId: string, id: string) => ["amendmentReview", systemId, id] as const,
  // Iteration 2. Every key starts with [name, systemId] so `invalidateQueries({ queryKey: [name, systemId] })` hits all variants.
  revisions: (systemId: string) => ["revisions", systemId] as const,
  changelog: (systemId: string, limit?: number) => ["changelog", systemId, limit ?? null] as const,
  changelogEntry: (systemId: string, commitId: string) => ["changelogEntry", systemId, commitId] as const,
  compare: (systemId: string, level: CompareLevel, from: string | undefined, to: string) => ["compare", systemId, level, from ?? null, to] as const,
  compareFile: (systemId: string, repo: FileScope, from: string | undefined, to: string, path: string) =>
    ["compareFile", systemId, repo, from ?? null, to, path] as const,
  tree: (systemId: string, repo: FileScope, rev: string) => ["tree", systemId, repo, rev] as const,
  file: (systemId: string, repo: FileScope, rev: string, path: string) => ["file", systemId, repo, rev, path] as const,
  builds: (systemId: string, q: BuildsQuery = {}) => ["builds", systemId, q.realization ?? null, q.commit ?? null, q.kind ?? null] as const,
  deployments: (systemId: string) => ["deployments", systemId] as const,
  phenome: (systemId: string, q: PhenomeEventsQuery = {}) => ["phenome", systemId, q] as const,
  artifacts: (systemId: string) => ["artifacts", systemId] as const,
};

/** `system` = two System commits (SystemCompare); `genome` = two Genome revisions (GenomeCompare). File level uses `useCompareFile`. */
export type CompareLevel = "system" | "genome";
export interface BuildsQuery {
  commit?: CommitHash;
  kind?: BuildKind;
  realization?: string;
}

/** Used by the route loader (`ensureQueryData`) and by `useModelBundle`. */
export const modelQuery = (systemId: string, rev: string) =>
  queryOptions({ queryKey: qk.model(systemId, rev), queryFn: () => api.getModel(systemId, rev), staleTime: 30_000 });

export const useSystems = () => useQuery({ queryKey: qk.systems(), queryFn: api.getSystems });
export const useParts = () => useQuery({ queryKey: qk.parts(), queryFn: api.getParts, select: (r) => r.parts });
export const usePart = (partId: string, version: string) => useQuery({ queryKey: qk.part(partId, version), queryFn: () => api.getPart(partId, version), enabled: !!partId && !!version });

/** `api` or `fixture` (API unreachable). Invalidate `qk.clientMode()` after `resetClientMode()`. */
export const useClientMode = () => useQuery({ queryKey: qk.clientMode(), queryFn: api.getClientMode });

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

/** Rule findings and System One judgments for a Genome-targeting realization. */
export function useAmendmentReview(evolutionId: string | undefined, realizationId: string | undefined) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.amendmentReview(systemId, realizationId ?? ""),
    queryFn: () => api.getAmendmentReview(systemId, evolutionId!, realizationId!),
    enabled: !!realizationId && !!evolutionId,
  });
}

// ---------------------------------------------------------------------------
// Iteration 2 reads. All read systemId from the route and stay disabled outside `/s/`.
// ---------------------------------------------------------------------------

/** Revision picker options (head, System commits, candidates). */
export function useRevisions() {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.revisions(systemId),
    queryFn: () => api.getRevisions(systemId),
    select: (r) => r.revisions,
    enabled: !!systemId,
  });
}

/** Changelog rows, newest first, paged with `fetchNextPage()`; rows are `data.pages.flatMap((p) => p.rows)`. */
export function useChangelog(opts: { limit?: number } = {}) {
  const { systemId } = useSystemRoute();
  return useInfiniteQuery({
    queryKey: qk.changelog(systemId, opts.limit),
    queryFn: ({ pageParam }) => api.getChangelog(systemId, { limit: opts.limit, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore,
    enabled: !!systemId,
  });
}

/** One System commit against its parent (immutable once written). */
export function useChangelogEntry(commitId: string | null | undefined) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.changelogEntry(systemId, commitId ?? ""),
    queryFn: () => api.getChangelogEntry(systemId, commitId!),
    enabled: !!systemId && !!commitId,
    staleTime: 5 * 60_000,
  });
}

/** `level: "system"` → `SystemCompare`, `"genome"` → `GenomeCompare`. `from` omitted = the parent of `to`. */
export function useCompare<L extends CompareLevel>(q: { level: L; from?: string; to: string | null | undefined }) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.compare(systemId, q.level, q.from, q.to ?? ""),
    queryFn: (): Promise<L extends "system" ? api.CompareResult["system"] : api.CompareResult["genome"]> =>
      (q.level === "system" ? api.getCompareSystem(systemId, { from: q.from, to: q.to! }) : api.getCompareGenome(systemId, { from: q.from, to: q.to! })) as never,
    enabled: !!systemId && !!q.to,
  });
}

/** One file on both sides of a compare. */
export function useCompareFile(q: { repo: FileScope; from?: string; to: string | null | undefined; path: string | null | undefined }) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: qk.compareFile(systemId, q.repo, q.from, q.to ?? "", q.path ?? ""),
    queryFn: () => api.getCompareFile(systemId, { repo: q.repo, from: q.from, to: q.to!, path: q.path! }),
    enabled: !!systemId && !!q.to && !!q.path,
  });
}

/** File list of `repo` at `rev` (default: the route's rev). */
export function useTree(q: { repo: FileScope; rev?: string }) {
  const { systemId, rev: routeRev } = useSystemRoute();
  const rev = q.rev ?? routeRev;
  return useQuery({ queryKey: qk.tree(systemId, q.repo, rev), queryFn: () => api.listFiles(systemId, { repo: q.repo, rev }), enabled: !!systemId });
}

/** One file's content; disabled until `path` is set. */
export function useFile(q: { repo: FileScope; rev?: string; path: string | null | undefined }) {
  const { systemId, rev: routeRev } = useSystemRoute();
  const rev = q.rev ?? routeRev;
  return useQuery({
    queryKey: qk.file(systemId, q.repo, rev, q.path ?? ""),
    queryFn: () => api.getFile(systemId, { repo: q.repo, rev, path: q.path! }),
    enabled: !!systemId && !!q.path,
  });
}

/** Builds (newest first), optionally for one realization, commit or kind. */
export function useBuilds(q: BuildsQuery = {}) {
  const { systemId } = useSystemRoute();
  return useQuery({ queryKey: qk.builds(systemId, q), queryFn: () => api.getBuilds(systemId, q), select: (r) => r.builds, enabled: !!systemId });
}

/** `{ production, history }`. */
export function useDeployments() {
  const { systemId } = useSystemRoute();
  return useQuery({ queryKey: qk.deployments(systemId), queryFn: () => api.getDeployments(systemId), enabled: !!systemId });
}

/** Runtime events (newest first) plus per-version counts. */
export function usePhenomeEvents(q: PhenomeEventsQuery = {}) {
  const { systemId } = useSystemRoute();
  return useQuery({ queryKey: qk.phenome(systemId, q), queryFn: () => api.getPhenomeEvents(systemId, q), enabled: !!systemId });
}

/** Realized output records, newest first. An empty result is valid for a Genome-only System. */
export function useRealizedArtifacts() {
  const { systemId } = useSystemRoute();
  return useQuery({ queryKey: qk.artifacts(systemId), queryFn: () => api.getRealizedArtifacts(systemId), select: (r) => r.artifacts, enabled: !!systemId });
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

/** Errors with `api.StaleBaseError` on 409. */
export function usePromote() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, adminToken }: { body: PromoteRequest; adminToken?: string }) => api.promote(systemId, body, adminToken),
    onSettled: () => {
      invalidate(qc, systemId, "evolutions", "candidates", "history", "changelog", "revisions", "model", "readiness", "systems");
    },
  });
}

/** Admin: re-run a candidate's checks (e.g. after its preview caught up with the passed build). */
export function useEvaluateCandidate() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, adminToken }: { candidateId: string; adminToken?: string }) => api.evaluateCandidate(systemId, candidateId, adminToken),
    onSettled: () => invalidate(qc, systemId, "evolutions", "candidates", "evaluations", "systems"),
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
    },
  });
}

/** Admin: create an Evolution. */
export function useCreateEvolution() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, adminToken }: { body: CreateEvolutionRequest; adminToken?: string }) => api.createEvolution(systemId, body, adminToken),
    onSuccess: () => invalidate(qc, systemId, "evolutions", "systems"),
  });
}

/** Input of {@link useManualCommit}. */
export interface ManualCommitInput {
  commit: EditorCommitRequest;
  /** Resume: commit to this existing realization (e.g. from a {@link ManualCommitError}) instead of starting one. */
  realizationId?: string;
  /** The realization's secret when resuming; falls back to `adminToken`. */
  secret?: string;
  /** Existing Evolution to start the realization on. */
  evolutionId?: string;
  /** Created first when neither `evolutionId` nor `realizationId` is given. */
  newEvolution?: CreateEvolutionRequest;
  target?: "app" | "genome";
  /** Start-work body, used verbatim when this call starts the realization (default: editor origin, `target`, agentLabel "editor"). */
  startWork?: StartWorkRequest;
  adminToken?: string;
}
export interface ManualCommitResult {
  evolutionId: string | undefined;
  realizationId: string;
  /** The realization secret when this call started the realization (shown once; never stored). */
  secret?: string;
  result: EditorCommitResponse;
}

/** What a failed manual commit had already created, so the caller can retry without duplicating it. */
export interface ManualCommitProgress {
  evolutionId?: string;
  realizationId?: string;
  /** Present when this call started the realization: the only copy of its one-time secret. */
  secret?: string;
}

/**
 * A step of {@link useManualCommit} failed after an earlier step succeeded. Retry by passing `progress.realizationId`
 * + `progress.secret` (or just `progress.evolutionId`) back in. `cause` is the original error (e.g. a 409 `ApiRequestError`).
 */
export class ManualCommitError extends Error {
  constructor(
    readonly step: "startWork" | "commit",
    readonly progress: ManualCommitProgress,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ManualCommitError";
  }
}

/**
 * A manual commit from the editor. With `realizationId` (+ `secret`) it only commits. Otherwise it starts an
 * `origin: "editor"` realization on `evolutionId`, creating the Evolution first from `newEvolution`; creating and starting
 * need `adminToken`. A failure after the Evolution or realization exists throws {@link ManualCommitError} with what exists.
 */
export function useManualCommit() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation<ManualCommitResult, Error, ManualCommitInput>({
    mutationFn: async (input) => {
      if (input.realizationId) {
        const result = await api.commitFiles(systemId, input.realizationId, input.commit, input.secret ?? input.adminToken);
        return { evolutionId: input.evolutionId, realizationId: input.realizationId, result };
      }
      let evolutionId = input.evolutionId;
      if (!evolutionId) {
        if (!input.newEvolution) throw new Error("Pick an Evolution or describe a new one.");
        evolutionId = (await api.createEvolution(systemId, input.newEvolution, input.adminToken)).evolution.id;
      }
      let started: Awaited<ReturnType<typeof api.startWork>>;
      try {
        const body: StartWorkRequest = input.startWork ?? { origin: "editor", target: input.target ?? "app", agentLabel: "editor" };
        started = await api.startWork(systemId, evolutionId, body, input.adminToken);
      } catch (cause) {
        throw new ManualCommitError("startWork", { evolutionId }, cause);
      }
      const progress = { evolutionId, realizationId: started.realization.id, secret: started.secret };
      try {
        const result = await api.commitFiles(systemId, started.realization.id, input.commit, started.secret);
        return { ...progress, result };
      } catch (cause) {
        throw new ManualCommitError("commit", progress, cause);
      }
    },
    onSettled: () => invalidate(qc, systemId, "evolutions", "candidates", "builds", "revisions", "tree", "file", "systems"),
  });
}

// ---------------------------------------------------------------------------
// App template upgrades
// ---------------------------------------------------------------------------

/** `["templateUpgrade", systemId, ref]`; promotions invalidate it (see SSE_INVALIDATIONS). */
export const templateUpgradeKey = (systemId: string, ref = "head") => ["templateUpgrade", systemId, ref] as const;

/** The plan to bring the app repo up to the current template scaffold (always against head). */
export function useTemplateUpgrade(opts: { enabled?: boolean } = {}) {
  const { systemId } = useSystemRoute();
  return useQuery({
    queryKey: templateUpgradeKey(systemId),
    queryFn: () => api.getTemplateUpgrade(systemId),
    enabled: !!systemId && opts.enabled !== false,
    retry: false,
  });
}

/** Admin: apply the plan as a new candidate. */
export function useApplyTemplateUpgrade() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, adminToken }: { body: TemplateUpgradeRequest; adminToken?: string }) => api.applyTemplateUpgrade(systemId, body, adminToken),
    onSettled: () => invalidate(qc, systemId, "evolutions", "candidates", "builds", "revisions", "templateUpgrade", "systems"),
  });
}

/** Invalidates `[name, systemId]` for each name (`systems` is global: `["systems"]`). */
function invalidate(qc: QueryClient, systemId: string, ...names: string[]) {
  for (const k of names) void qc.invalidateQueries({ queryKey: k === "systems" ? [k] : [k, systemId] });
}

/** Every list a view may have mounted; the polling fallback (no SSE) refreshes these. */
const LIVE_LISTS = ["evolutions", "candidates", "builds", "deployments", "phenome", "changelog", "revisions", "systems"];

/**
 * Which query prefixes each SSE event invalidates (`systems` is global). Exhaustive: `ping` invalidates nothing; `poll`
 * (the 3 s fallback when EventSource is unavailable) refreshes the live lists. Exported for tests.
 */
export const SSE_INVALIDATIONS: Record<api.SseType | "poll", readonly string[]> = {
  "realization.created": ["evolutions"],
  "realization.updated": ["evolutions"],
  checkpoint: ["evolutions"],
  "evolution.updated": ["evolutions"],
  "evaluation.completed": ["evaluations", "candidates"],
  "candidate.submitted": ["candidates", "conflicts", "evolutions", "revisions", "builds"],
  "conflict.detected": ["candidates", "conflicts", "evolutions"],
  "system.promoted": ["history", "changelog", "revisions", "model", "readiness", "evolutions", "candidates", "tree", "file", "compare", "systems", "templateUpgrade"],
  "genome.accepted": ["model", "readiness", "evolutions", "changelog", "revisions", "tree", "file"],
  "build.updated": ["builds", "candidates", "changelog", "changelogEntry", "systems"],
  "deployment.updated": ["deployments", "changelog", "changelogEntry", "phenome", "systems"],
  "phenome.ingested": ["phenome", "systems"],
  "system.updated": ["systems"],
  "system.imported": ["systems"],
  "evolution.created": ["evolutions", "systems"],
  ping: [],
  poll: LIVE_LISTS,
};

/** Subscribes to System events for the current route and invalidates the affected queries. Mount once (Shell does). */
export function useSystemEvents() {
  const { systemId } = useSystemRoute();
  const qc = useQueryClient();
  useEffect(
    () =>
      api.subscribeEvents(systemId, (e) => {
        if (e.type === "candidate.submitted") emitFx({ kind: "submitted" });
        invalidate(qc, systemId, ...(SSE_INVALIDATIONS[e.type] ?? []));
      }),
    [systemId, qc],
  );
}
