import {
  routes,
  type AcceptRequest, type AcceptResponse, type ApiError, type BuildKind, type BuildsResponse, type CandidatesResponse,
  type ChangelogEntry, type ChangelogResponse, type CommitHash, type ConflictReport, type CreateEvolutionRequest,
  type CreateEvolutionResponse, type DeploymentsResponse, type EditorCommitRequest, type EditorCommitResponse, type EvaluateCandidateResponse, type EvaluationsResponse,
  type EvolutionsResponse, type FileCompare, type FileResponse, type FileScope, type FilesResponse, type GenomeCandidateReview,
  type GenomeCompare, type HistoryResponse, type ModelBundle, type PhenomeEventsQuery, type PhenomeEventsResponse, type PromoteRequest,
  type PartResponse, type PromoteResponse, type ReadinessReport, type RealizedArtifactsResponse, type RejectRequest, type RejectResponse, type RevisionsResponse, type SseEvent,
  type StartWorkRequest, type StartWorkResponse, type SystemCompare, type SystemSummary,
  type PartsResponse,
} from "../../shared/api";
import { isBlocking } from "../../shared/verdict";
import type { TemplateUpgradeNoScaffold, TemplateUpgradePlan, TemplateUpgradeRequest, TemplateUpgradeResponse } from "../../shared/api";
import type { IntentAccept, IntentAcceptResponse, IntentReply, IntentRequest, Proposal } from "../../shared/api";
import type { ModelJson, UiBundle } from "@/model/types";

/** Any non-2xx response. `body` is the parsed {@link ApiError} when the server sent one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: ApiError,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** 409 from promote: the System head moved since the client read it. */
export class StaleBaseError extends ApiRequestError {
  constructor(
    readonly currentHead: string | null,
    body?: ApiError,
  ) {
    super(409, "stale-base", body?.error.message ?? "The System head changed; reload and review again.", body);
    this.name = "StaleBaseError";
  }
}

/** Thrown by mutations while the SPA runs on fixture data (no backend). */
export class FixtureModeError extends Error {
  constructor(action: string) {
    super(`${action} needs the platform API; the UI is showing fixture data.`);
    this.name = "FixtureModeError";
  }
}

const enc = encodeURIComponent;

/** Every route the client calls, in one place. All are under `/api`. */
export const paths = {
  systems: () => `/api/systems`,
  parts: () => "/api/parts",
  systemParts: (s: string) => `/api/systems/${enc(s)}/parts`,
  systemPart: (s: string, partId: string, version: string) => `/api/systems/${enc(s)}/parts/${enc(partId)}/${enc(version)}`,
  part: (partId: string, version: string) => `/api/parts/${enc(partId)}/${enc(version)}`,
  model: (s: string, rev: string) => `/api/systems/${enc(s)}/model?rev=${enc(rev)}`,
  readiness: (s: string, rev: string) => `/api/systems/${enc(s)}/readiness?rev=${enc(rev)}`,
  evolutions: (s: string) => `/api/systems/${enc(s)}/evolutions`,
  candidates: (s: string, e: string) => `/api/systems/${enc(s)}/evolutions/${enc(e)}/candidates`,
  evaluations: (s: string, candidate?: string) =>
    `/api/systems/${enc(s)}/evaluations${candidate ? `?candidate=${enc(candidate)}` : ""}`,
  conflicts: (s: string) => `/api/systems/${enc(s)}/conflicts`,
  history: (s: string) => `/api/systems/${enc(s)}/history`,
  startWork: (s: string, e: string) => `/api/systems/${enc(s)}/evolutions/${enc(e)}/realizations`,
  promote: (s: string) => `/api/systems/${enc(s)}/promote`,
  evaluateCandidate: routes.evaluateCandidate,
  amendmentReview: (s: string, e: string, r: string) =>
    `/api/systems/${enc(s)}/evolutions/${enc(e)}/realizations/${enc(r)}/review`,
  reject: (s: string, r: string) => `/api/systems/${enc(s)}/realizations/${enc(r)}/reject`,
  accept: (s: string, e: string) => `/api/systems/${enc(s)}/evolutions/${enc(e)}/accept`,
  events: (s: string) => `/api/systems/${enc(s)}/events`,
  // Iteration 2: the shared contract's paths (API names: `scope` for the UI's `repo`, `ref` for the UI's `rev`).
  createEvolution: (s: string) => routes.evolutions(s),
  revisions: routes.revisions,
  changelog: routes.changelog,
  changelogEntry: routes.changelogEntry,
  compareSystem: routes.compareSystem,
  compareGenome: routes.compareGenome,
  compareFile: routes.compareFile,
  files: routes.files,
  file: routes.file,
  editorCommit: routes.editorCommit,
  builds: routes.builds,
  realizationBuilds: routes.realizationBuilds,
  deployments: routes.deployments,
  phenomeEvents: routes.phenomeEvents,
  artifacts: (s: string) => `/api/systems/${enc(s)}/artifacts`,
  // Iteration 3: intents (admin).
  intents: routes.intents,
  intent: routes.intent,
  intentReply: routes.intentReply,
  intentAccept: routes.intentAccept,
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      body = undefined;
    }
    if (res.status === 409 && body?.error?.code === "stale-base") {
      const details = body.error.details as { currentHead?: string | null } | undefined;
      throw new StaleBaseError(details?.currentHead ?? null, body);
    }
    throw new ApiRequestError(res.status, body?.error?.code ?? `http-${res.status}`, body?.error?.message ?? res.statusText, body);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown, headers?: Record<string, string>) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body), ...(headers && { headers }) });

// ---------------------------------------------------------------------------
// Fixture fallback: decided once by the first getSystems() call.
// ---------------------------------------------------------------------------

let mode: Promise<{ fixture: boolean; systems: SystemSummary[] }> | undefined;

export const FIXTURE_SYSTEM_ID = "system.keep-in-touch";

/** The fixture JSON is large, so it is a separate chunk loaded only on the fallback path. */
const fixtureBundle = () => import("./fixtures").then((m) => m.fixtureBundle());

async function fixtureSummary(): Promise<SystemSummary> {
  const b = await fixtureBundle();
  return {
    systemId: b.systemId,
    title: b.model.system.name,
    head: null,
    genomeRepo: "fixture",
    appRepo: "fixture",
    genomeCommit: b.genomeCommit,
    ...(b.model.system.phase !== undefined && { phase: b.model.system.phase }),
    evolutionCounts: {},
    // Iteration-2 fields zero-filled: nothing is built, deployed or observed in the fixture.
    built: false,
    realizationCounts: { evolving: 0, pending: 0, awaitingAdmin: 0 },
    openCandidates: 0,
    latestBuild: null,
    deployment: { production: null, previews: 0 },
    deployState: "none",
    phenome: { events: 0 },
    readiness: {
      errors: b.readiness.modelReadiness.findings.filter((f) => isBlocking(f) && f.level === "error").length,
      missing: b.readiness.modelReadiness.findings.filter((f) => isBlocking(f) && f.level === "missing").length,
    },
    signifiers: [],
    // The fixture's computedAt is a placeholder epoch; "" renders as "updated unknown".
    updatedAt: "",
  };
}

/**
 * Fixture mode means the API is unreachable (network error or non-2xx on `/api/systems`). A reachable API with
 * no Systems is a real, empty platform: `getSystems()` returns `[]` and Home shows its empty state.
 */
function resolveMode() {
  mode ??= request<SystemSummary[] | { systems: SystemSummary[] }>(paths.systems()).then(
    (r) => ({ fixture: false, systems: Array.isArray(r) ? r : (r.systems ?? []) }),
    async (cause: unknown) => {
      console.warn("artyfact: /api/systems unreachable, showing fixture data", cause);
      return { fixture: true, systems: [await fixtureSummary()] };
    },
  );
  return mode;
}

/** True when the SPA is serving fixture data because the API is unreachable. */
export const isFixtureMode = async () => (await resolveMode()).fixture;

export type ClientMode = "api" | "fixture";

/** `fixture` while the API is unreachable (TopBar / Home pill), else `api`. */
export const getClientMode = async (): Promise<ClientMode> => ((await resolveMode()).fixture ? "fixture" : "api");

/** Forget the cached fixture decision so the next call asks the API again (TopBar "Retry API", tests). */
export function resetClientMode() {
  mode = undefined;
}

async function readOrEmpty<T>(empty: T, load: () => Promise<T>): Promise<T> {
  return (await isFixtureMode()) ? empty : load();
}

async function writeOrThrow<T>(action: string, run: () => Promise<T>): Promise<T> {
  if (await isFixtureMode()) throw new FixtureModeError(action);
  return run();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getSystems(): Promise<SystemSummary[]> {
  return (await resolveMode()).systems;
}

/** Shared, immutable Part catalog. System-private packages require an explicit System route and are never requested here. */
export const getParts = () => readOrEmpty<PartsResponse>({ parts: [] }, () => request<PartsResponse>(paths.parts()));
export const getPart = (partId: string, version: string) => request<PartResponse>(paths.part(partId, version));
export const getSystemParts = (systemId: string, token: string) => request<PartsResponse>(paths.systemParts(systemId), { headers: { authorization: `Bearer ${token}` } });
export const getSystemPart = (systemId: string, partId: string, version: string, token: string) => request<PartResponse>(paths.systemPart(systemId, partId, version), { headers: { authorization: `Bearer ${token}` } });

/** Realized outputs are independent records; an empty list is meaningful for Genome-only Things. */
export const getRealizedArtifacts = (systemId: string) =>
  readOrEmpty<RealizedArtifactsResponse>({ artifacts: [] }, () => request<RealizedArtifactsResponse>(paths.artifacts(systemId)));

/** `rev` is `head`/`canonical`, a System commit id or a candidate id. */
export async function getModel(systemId: string, rev: string): Promise<UiBundle> {
  if (await isFixtureMode()) {
    if (systemId !== FIXTURE_SYSTEM_ID) throw new ApiRequestError(404, "not-found", `No fixture for ${systemId}`);
    return fixtureBundle();
  }
  const b = await request<ModelBundle>(paths.model(systemId, rev));
  return { ...b, model: b.model as ModelJson, source: "api" };
}

export async function getReadiness(systemId: string, rev: string): Promise<ReadinessReport> {
  if (await isFixtureMode()) return (await fixtureBundle()).readiness;
  return request<ReadinessReport>(paths.readiness(systemId, rev));
}

export const getEvolutions = (systemId: string) =>
  readOrEmpty<EvolutionsResponse>({ evolutions: [], realizations: [] }, () => request(paths.evolutions(systemId)));

export const getCandidates = (systemId: string, evolutionId: string) =>
  readOrEmpty<CandidatesResponse>({ evolution: evolutionId, candidates: [], evaluations: [], conflicts: [] }, () =>
    request(paths.candidates(systemId, evolutionId)),
  );

export const getEvaluations = (systemId: string, opts: { candidate?: string } = {}) =>
  readOrEmpty<EvaluationsResponse>({ evaluations: [] }, () => request(paths.evaluations(systemId, opts.candidate)));

export const getConflicts = (systemId: string) =>
  readOrEmpty<{ conflicts: ConflictReport[] }>({ conflicts: [] }, () => request(paths.conflicts(systemId)));

export const getHistory = (systemId: string) =>
  readOrEmpty<HistoryResponse>({ commits: [] }, () => request(paths.history(systemId)));

/** UI revision for file and compare reads; `rev` maps to the API's `ref`, `repo` to its `scope`. */
export interface FileRef {
  repo: FileScope;
  rev?: string;
}

const fixtureRef = (rev: string | undefined, repo: FileScope) => ({ ref: rev ?? "head", repo: `fixture/${repo}`, commit: "0".repeat(40) });
const notInFixture = (what: string) => new ApiRequestError(404, "not-found", `${what} is not available in fixture data`);

/** Head, System commits and candidates for revision pickers. Fixture: head only. */
export const getRevisions = (systemId: string) =>
  readOrEmpty<RevisionsResponse>({ revisions: [{ id: "head", kind: "head", label: "head" }] }, () => request(paths.revisions(systemId)));

/** Newest first; pass `nextBefore` as `before` for the next page. */
export const getChangelog = (systemId: string, q: { limit?: number; before?: string } = {}) =>
  readOrEmpty<ChangelogResponse>({ rows: [] }, () => request(paths.changelog(systemId, q)));

export async function getChangelogEntry(systemId: string, commitId: string): Promise<ChangelogEntry> {
  if (await isFixtureMode()) throw notInFixture(`Changelog entry ${commitId}`);
  return request(paths.changelogEntry(systemId, commitId));
}

/** `from` omitted = the parent of `to`. */
export async function getCompareSystem(systemId: string, q: { from?: string; to: string }): Promise<SystemCompare> {
  if (await isFixtureMode()) throw notInFixture("Compare");
  return request(paths.compareSystem(systemId, q.from, q.to));
}

export async function getCompareGenome(systemId: string, q: { from?: string; to: string }): Promise<GenomeCompare> {
  if (await isFixtureMode()) throw notInFixture("Compare");
  return request(paths.compareGenome(systemId, q.from, q.to));
}

export async function getCompareFile(systemId: string, q: { repo: FileScope; from?: string; to: string; path: string }): Promise<FileCompare> {
  if (await isFixtureMode()) throw notInFixture("Compare");
  return request(paths.compareFile(systemId, q.repo, q.from, q.to, q.path));
}

/** Files of a repo at a revision. Fixture: the Keep in Touch Genome for `repo: "genome"`, nothing for the app. */
export async function listFiles(systemId: string, { repo, rev }: FileRef): Promise<FilesResponse> {
  if (await isFixtureMode()) {
    const files = repo === "genome" ? (await import("./fixtures").then((m) => m.fixtureFiles())).entries : [];
    return { ref: fixtureRef(rev, repo), files };
  }
  return request(paths.files(systemId, repo, rev));
}

/** One file's text (null for binary). Fixture: Genome files only. */
export async function getFile(systemId: string, { repo, rev, path }: FileRef & { path: string }): Promise<FileResponse> {
  if (await isFixtureMode()) {
    const f = repo === "genome" ? await import("./fixtures").then((m) => m.fixtureFiles()) : undefined;
    const entry = f?.entries.find((e) => e.path === path);
    if (!f || !entry) throw notInFixture(`${repo}:${path}`);
    return { ref: fixtureRef(rev, repo), path, hash: entry.hash, text: f.files[path] ?? null, size: entry.size, truncated: false, binary: false };
  }
  return request(paths.file(systemId, repo, path, rev));
}

/** System builds, optionally for one commit or kind; with `realization`, that realization's builds. */
export const getBuilds = (systemId: string, q: { commit?: CommitHash; kind?: BuildKind; realization?: string } = {}) =>
  readOrEmpty<BuildsResponse>({ builds: [] }, () =>
    request(q.realization ? paths.realizationBuilds(systemId, q.realization) : paths.builds(systemId, { commit: q.commit, kind: q.kind })),
  );

export const getDeployments = (systemId: string) =>
  readOrEmpty<DeploymentsResponse>({ production: null, history: [] }, () => request(paths.deployments(systemId)));

export const getPhenomeEvents = (systemId: string, q: PhenomeEventsQuery = {}) =>
  readOrEmpty<PhenomeEventsResponse>({ events: [], versions: [] }, () => request(paths.phenomeEvents(systemId, q)));

export async function getAmendmentReview(systemId: string, evolutionId: string, realizationId: string): Promise<GenomeCandidateReview> {
  if (await isFixtureMode()) throw new ApiRequestError(404, "not-found", `No amendment review for ${realizationId} in fixture data`);
  return request<GenomeCandidateReview>(paths.amendmentReview(systemId, evolutionId, realizationId));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Admin only: the response carries the one-time write token and realization secret. */
export const startWork = (systemId: string, evolutionId: string, body: StartWorkRequest = {}, adminToken?: string) =>
  writeOrThrow("Start work", () =>
    post<StartWorkResponse>(paths.startWork(systemId, evolutionId), body, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

/** Rejects with {@link StaleBaseError} when `expectedHead` is no longer the head. */
export const promote = (systemId: string, body: PromoteRequest, adminToken?: string) =>
  writeOrThrow("Promote", () =>
    post<PromoteResponse>(paths.promote(systemId), body, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

/** Admin only: re-run an open candidate's checks against its current preview; the new evaluations replace the old. */
export const evaluateCandidate = (systemId: string, candidateId: string, adminToken?: string) =>
  writeOrThrow("Re-run checks", () =>
    post<EvaluateCandidateResponse>(paths.evaluateCandidate(systemId, candidateId), {}, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

export const acceptAmendment = (systemId: string, evolutionId: string, body: AcceptRequest, adminToken?: string) =>
  writeOrThrow("Accept amendment", () =>
    post<AcceptResponse>(paths.accept(systemId, evolutionId), body, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

export const rejectAmendment = (systemId: string, realizationId: string, body: RejectRequest, adminToken?: string) =>
  writeOrThrow("Reject amendment", () =>
    post<RejectResponse>(paths.reject(systemId, realizationId), body, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

/** Admin only: a new Evolution (state per the System's policy). */
export const createEvolution = (systemId: string, body: CreateEvolutionRequest, adminToken?: string) =>
  writeOrThrow("Create evolution", () =>
    post<CreateEvolutionResponse>(paths.createEvolution(systemId), body, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

/**
 * Writes files to a realization's fork and submits the commit. `token` is the realization secret (from `startWork`)
 * or the admin token, sent as `Authorization: Bearer`. A moved fork head (`expectedHead`) is a 409 {@link ApiRequestError}.
 */
export const commitFiles = (systemId: string, realizationId: string, body: EditorCommitRequest, token?: string) =>
  writeOrThrow("Commit", () =>
    post<EditorCommitResponse>(paths.editorCommit(systemId, realizationId), body, token ? { authorization: `Bearer ${token}` } : undefined),
  );

// ---------------------------------------------------------------------------
// Intents (admin): describe a change, review the proposed node updates, accept some of them
// ---------------------------------------------------------------------------

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : undefined);

/** Routes and translates `message` into a {@link Proposal}. A platform without intents answers 501 `not-implemented`. */
export const createIntent = (systemId: string, body: IntentRequest, adminToken?: string) =>
  writeOrThrow("Describing a change", () => post<Proposal>(paths.intents(systemId), body, bearer(adminToken)));

export async function getIntent(systemId: string, proposalId: string, adminToken?: string): Promise<Proposal> {
  if (await isFixtureMode()) throw notInFixture(`Proposal ${proposalId}`);
  const headers = bearer(adminToken);
  return request<Proposal>(paths.intent(systemId, proposalId), headers && { headers });
}

/** Answers a question (or follows up without `questionId`); returns the same proposal, revised. */
export const replyIntent = (systemId: string, proposalId: string, body: IntentReply, adminToken?: string) =>
  writeOrThrow("Replying to a proposal", () => post<Proposal>(paths.intentReply(systemId, proposalId), body, bearer(adminToken)));

/** Applies `opIds` (the rest are rejected). 409 {@link StaleBaseError} when the Genome moved; 422 when an op lacks one it depends on. */
export const acceptIntent = (systemId: string, proposalId: string, body: IntentAccept, adminToken?: string) =>
  writeOrThrow("Accepting a proposal", () => post<IntentAcceptResponse>(paths.intentAccept(systemId, proposalId), body, bearer(adminToken)));

// ---------------------------------------------------------------------------
// App template upgrades
// ---------------------------------------------------------------------------

/** What upgrading the app repo to the current template scaffold would change. Not available on fixture data. */
export async function getTemplateUpgrade(systemId: string, ref = "head"): Promise<TemplateUpgradePlan | TemplateUpgradeNoScaffold> {
  if (await isFixtureMode()) throw notInFixture("The template upgrade plan");
  return request(routes.templateUpgrade(systemId, ref));
}

/** Admin only: apply the plan (plus the `include`d conflicts) as a new Evolution's candidate. 409 when up to date. */
export const applyTemplateUpgrade = (systemId: string, body: TemplateUpgradeRequest, adminToken?: string) =>
  writeOrThrow("Template upgrade", () =>
    post<TemplateUpgradeResponse>(routes.templateUpgrade(systemId), body, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SseType = SseEvent["type"];

/** What `useCompare` returns per level. */
export interface CompareResult {
  system: SystemCompare;
  genome: GenomeCompare;
}

/** Every event type, checked exhaustive against `SseEvent` by `satisfies`. */
const SSE_TYPE_SET = {
  "realization.created": true, "realization.updated": true, checkpoint: true, "candidate.submitted": true,
  "evaluation.completed": true, "conflict.detected": true, "evolution.updated": true, "system.promoted": true,
  "genome.accepted": true, "system.imported": true, "build.updated": true, "deployment.updated": true,
  "phenome.ingested": true, "system.updated": true, "evolution.created": true, ping: true,
} satisfies Record<SseType, true>;

/** Named EventSource listeners (the server may also send unnamed `data:` frames, handled by `onmessage`). */
export const SSE_TYPES = Object.keys(SSE_TYPE_SET) as SseType[];

/**
 * Streams System events. Falls back to polling every 3 s when EventSource is unavailable or
 * errors; while polling, `onEvent` receives `{ type: "poll" }` so callers refetch.
 * Returns an unsubscribe function. Does nothing in fixture mode.
 */
export function subscribeEvents(
  systemId: string,
  onEvent: (e: SseEvent | { type: "poll" }) => void,
  opts: { pollMs?: number } = {},
): () => void {
  let closed = false;
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const poll = () => {
    source?.close();
    source = undefined;
    if (!closed && timer === undefined) timer = setInterval(() => onEvent({ type: "poll" }), opts.pollMs ?? 3000);
  };
  void isFixtureMode().then((fixture) => {
    if (closed || fixture) return;
    if (typeof EventSource === "undefined") return poll();
    source = new EventSource(paths.events(systemId));
    const handle = (msg: MessageEvent<string>) => {
      try {
        onEvent(JSON.parse(msg.data) as SseEvent);
      } catch {
        // ignore malformed frames and pings
      }
    };
    source.onmessage = handle;
    for (const t of SSE_TYPES) source.addEventListener(t, handle as EventListener);
    // EventSource reconnects by itself; poll only once the browser has given up.
    source.onerror = () => {
      if (source?.readyState === EventSource.CLOSED) poll();
    };
  });
  return () => {
    closed = true;
    source?.close();
    if (timer !== undefined) clearInterval(timer);
  };
}
