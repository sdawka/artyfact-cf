import type {
  AcceptRequest, AcceptResponse, ApiError, CandidatesResponse, ConflictReport, EvaluationsResponse,
  EvolutionsResponse, HistoryResponse, ModelBundle, PacketResponse, PromoteRequest, PromoteResponse,
  ReadinessReport, Realization, SseEvent, StartWorkRequest, StartWorkResponse, SubmitRequest,
  SubmitResponse, SystemSummary,
} from "../../shared/api";
import type { ModelJson, UiBundle } from "@/model/types";
import { FIXTURE_SYSTEM_ID, fixtureBundle } from "./fixtures";

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
  model: (s: string, rev: string) => `/api/systems/${enc(s)}/model?rev=${enc(rev)}`,
  readiness: (s: string, rev: string) => `/api/systems/${enc(s)}/readiness?rev=${enc(rev)}`,
  evolutions: (s: string) => `/api/systems/${enc(s)}/evolutions`,
  realization: (s: string, r: string) => `/api/systems/${enc(s)}/realizations/${enc(r)}`,
  candidates: (s: string, e: string) => `/api/systems/${enc(s)}/evolutions/${enc(e)}/candidates`,
  evaluations: (s: string, candidate?: string) =>
    `/api/systems/${enc(s)}/evaluations${candidate ? `?candidate=${enc(candidate)}` : ""}`,
  conflicts: (s: string) => `/api/systems/${enc(s)}/conflicts`,
  history: (s: string) => `/api/systems/${enc(s)}/history`,
  packet: (s: string, r: string) => `/api/systems/${enc(s)}/realizations/${enc(r)}/packet`,
  startWork: (s: string, e: string) => `/api/systems/${enc(s)}/evolutions/${enc(e)}/realizations`,
  submit: (s: string, r: string) => `/api/systems/${enc(s)}/realizations/${enc(r)}/submit`,
  promote: (s: string) => `/api/systems/${enc(s)}/promote`,
  accept: (s: string, e: string) => `/api/systems/${enc(s)}/evolutions/${enc(e)}/accept`,
  events: (s: string) => `/api/systems/${enc(s)}/events`,
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

function fixtureSummary(): SystemSummary {
  const b = fixtureBundle();
  return {
    systemId: b.systemId,
    title: b.model.system.name,
    head: null,
    genomeRepo: "fixture",
    appRepo: "fixture",
    genomeCommit: b.genomeCommit,
    ...(b.model.system.phase !== undefined && { phase: b.model.system.phase }),
    evolutionCounts: {},
    updatedAt: b.readiness.computedAt,
  };
}

function resolveMode() {
  mode ??= request<SystemSummary[] | { systems: SystemSummary[] }>(paths.systems())
    .then((r) => {
      const systems = Array.isArray(r) ? r : (r.systems ?? []);
      return systems.length ? { fixture: false, systems } : { fixture: true, systems: [fixtureSummary()] };
    })
    .catch(() => ({ fixture: true, systems: [fixtureSummary()] }));
  return mode;
}

/** True when the SPA is serving fixture data because the API is unreachable or has no Systems. */
export const isFixtureMode = async () => (await resolveMode()).fixture;

/** Test hook: forget the cached fixture decision. */
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
  if (await isFixtureMode()) return fixtureBundle().readiness;
  return request<ReadinessReport>(paths.readiness(systemId, rev));
}

export const getEvolutions = (systemId: string) =>
  readOrEmpty<EvolutionsResponse>({ evolutions: [], realizations: [] }, () => request(paths.evolutions(systemId)));

export async function getRealization(systemId: string, realizationId: string): Promise<Realization> {
  if (await isFixtureMode()) throw new ApiRequestError(404, "not-found", `No realization ${realizationId} in fixture data`);
  return request<Realization>(paths.realization(systemId, realizationId));
}

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

export async function getPacket(systemId: string, realizationId: string): Promise<PacketResponse> {
  if (await isFixtureMode()) throw new ApiRequestError(404, "not-found", `No packet for ${realizationId} in fixture data`);
  return request<PacketResponse>(paths.packet(systemId, realizationId));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const startWork = (systemId: string, evolutionId: string, body: StartWorkRequest = {}) =>
  writeOrThrow("Start work", () => post<StartWorkResponse>(paths.startWork(systemId, evolutionId), body));

export const submit = (systemId: string, realizationId: string, body: SubmitRequest) =>
  writeOrThrow("Submit", () => post<SubmitResponse>(paths.submit(systemId, realizationId), body));

/** Rejects with {@link StaleBaseError} when `expectedHead` is no longer the head. */
export const promote = (systemId: string, body: PromoteRequest, adminToken?: string) =>
  writeOrThrow("Promote", () =>
    post<PromoteResponse>(paths.promote(systemId), body, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

export const acceptAmendment = (systemId: string, evolutionId: string, body: AcceptRequest, adminToken?: string) =>
  writeOrThrow("Accept amendment", () =>
    post<AcceptResponse>(paths.accept(systemId, evolutionId), body, adminToken ? { authorization: `Bearer ${adminToken}` } : undefined),
  );

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const SSE_TYPES: SseEvent["type"][] = [
  "realization.created", "realization.updated", "checkpoint", "candidate.submitted", "evaluation.completed",
  "conflict.detected", "evolution.updated", "system.promoted", "genome.accepted",
];

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
    source.onerror = poll;
  });
  return () => {
    closed = true;
    source?.close();
    if (timer !== undefined) clearInterval(timer);
  };
}
