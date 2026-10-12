/**
 * Wire types shared by the Worker (apps/platform/worker) and the SPA (src/api/client.ts).
 *
 * Source of truth: docs/design/backend.md (B.2, B.4, B.5, B.7) and docs/design/ui.md (C.0, C.6).
 * Domain types (Verdict, Execution, Evaluation, Finding, Readiness, Criterion, AssayHook, Journey,
 * CandidateManifest) are re-exported from `@artyfact/model`. Evolution, Realization and SystemCommit are
 * the model types extended with the runtime fields the platform adds (status, timestamps, ids); a value
 * of the wire type is always usable where the model type is expected, except that a Genome realization
 * waiting for admin acceptance has status `awaiting-admin`.
 *
 * All timestamps are ISO-8601 strings. All routes are under `/api` (see {@link routes}).
 */

import type { Finding, ModelIndex, Readiness, SystemModel, schema } from "@artyfact/model";
import type { Commitment, ReviewResult, SemanticDelta } from "@artyfact/semantic";

export type { Finding, Readiness } from "@artyfact/model";
export type { SemanticDelta as ModelDelta } from "@artyfact/model";
export type { SemanticDelta } from "@artyfact/semantic";
/** Rules-engine readiness (alias kept for the backend). */
export type RulesReadiness = Readiness;
export type Verdict = schema.Verdict;
export type Execution = schema.Execution;
export type Evaluation = schema.Evaluation;
export type Criterion = schema.Criterion;
export type AssayHook = schema.AssayHook;
export type Journey = schema.Journey;
export type EvolutionState = schema.EvolutionState;
export type CandidateManifest = schema.CandidateManifest;

// ---------------------------------------------------------------------------
// Routes (all under /api). The CLI uses the evolution-scoped realization routes.
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;
const sys = (s: string) => `/api/systems/${enc(s)}`;
/** Realization routes: `/api/systems/:sid/evolutions/:eid/realizations/:rid` (also served at `/api/systems/:sid/realizations/:rid` and `/api/realizations/:rid`). */
const rz = (s: string, e: string, r: string) => `${sys(s)}/evolutions/${enc(e)}/realizations/${enc(r)}`;

export const routes = {
  health: () => "/api/health",
  systems: () => "/api/systems",
  importSystem: () => "/api/systems/import",
  system: (s: string) => sys(s),
  model: (s: string, rev?: string) => `${sys(s)}/model${rev ? `?rev=${enc(rev)}` : ""}`,
  readiness: (s: string, rev?: string) => `${sys(s)}/readiness${rev ? `?rev=${enc(rev)}` : ""}`,
  work: (s: string) => `${sys(s)}/work`,
  evolutions: (s: string) => `${sys(s)}/evolutions`,
  evolution: (s: string, e: string) => `${sys(s)}/evolutions/${enc(e)}`,
  startWork: (s: string, e: string) => `${sys(s)}/evolutions/${enc(e)}/realizations`,
  candidates: (s: string, e: string) => `${sys(s)}/evolutions/${enc(e)}/candidates`,
  accept: (s: string, e: string) => `${sys(s)}/evolutions/${enc(e)}/accept`,
  realization: (s: string, e: string, r: string) => rz(s, e, r),
  packet: (s: string, e: string, r: string) => `${rz(s, e, r)}/packet`,
  checkpoints: (s: string, e: string, r: string) => `${rz(s, e, r)}/checkpoints`,
  submit: (s: string, e: string, r: string) => `${rz(s, e, r)}/submit`,
  sync: (s: string, e: string, r: string) => `${rz(s, e, r)}/sync`,
  review: (s: string, e: string, r: string) => `${rz(s, e, r)}/review`,
  reject: (s: string, e: string, r: string) => `${rz(s, e, r)}/reject`,
  evaluations: (s: string, candidate?: string) => `${sys(s)}/evaluations${candidate ? `?candidate=${enc(candidate)}` : ""}`,
  conflicts: (s: string) => `${sys(s)}/conflicts`,
  promote: (s: string) => `${sys(s)}/promote`,
  history: (s: string) => `${sys(s)}/history`,
  events: (s: string) => `${sys(s)}/events`,
} as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Dotted model id such as `system.keep-in-touch`, `screen.people`, `evolution.1`, `crit.x`. */
export type NodeId = string;
export type SystemId = string;
/** Git commit hash (full sha) of a Genome or Artifacts repo. */
export type CommitHash = string;
/** SHA-256 hex of canonical JSON. */
export type Sha256 = string;

export type Certainty = "declared" | "assumed" | "proposed";

/** Error body for every non-2xx response. */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Systems and the model bundle
// ---------------------------------------------------------------------------

export interface SystemSummary {
  systemId: SystemId;
  title: string;
  /** Current System head commit id, or null before the first import. */
  head: string | null;
  genomeRepo: string;
  appRepo: string;
  genomeCommit: CommitHash;
  phase?: string;
  /** Number of evolutions per state, e.g. `{ actionable: 2 }`. */
  evolutionCounts: Partial<Record<EvolutionState, number>>;
  updatedAt: string;
}

/** `GET /api/systems`. */
export interface SystemsResponse {
  systems: SystemSummary[];
}

/** Readiness report: the three states are never summed. */
export interface ReadinessReport {
  modelReadiness: { findings: Finding[]; blockers: Finding[] };
  implementationConformance: { pass: number; fail: number; unknown: number; stale: number; notRun: number };
  outcomeProgress: { observed: number; unknown: number };
  computedAt: string;
}

/** `SystemModel.index` without functions: `byId` without the duplicated `item`, `path()` materialised. */
export interface SerializedIndex extends Omit<ModelIndex, "byId" | "path" | "layer"> {
  byId: Record<NodeId, { id: NodeId; type: string; kind: string; name: string }>;
  /** Containment path from the System root, for every indexed id. */
  paths: Record<NodeId, NodeId[]>;
  /** Nearest `section` at or above each id, where there is one. */
  layers: Record<NodeId, NodeId>;
}

/** `@artyfact/model`'s `SystemModel` as JSON (see `serializeModel` in the Worker). */
export type SerializedModel = Omit<SystemModel, "index"> & { index: SerializedIndex };

/** `GET /api/systems/:id/model?rev=`. */
export interface ModelBundle {
  systemId: SystemId;
  /** `fixture` when the SPA fell back to its bundled example (client-side only). */
  source?: "api" | "fixture";
  /** Revision the model was loaded at: `canonical`, a System commit id, a candidate id or a Genome sha. */
  revision: string;
  genomeCommit: CommitHash;
  /** A {@link SerializedModel} from the API; typed loosely so the SPA's fixture bundles fit. */
  model: unknown;
  readiness: ReadinessReport;
  /** Full rules-engine output behind `readiness.modelReadiness` (findings with derivations). */
  rules?: Readiness;
}

/** `GET /api/systems/:id/readiness?rev=`. */
export interface ReadinessResponse {
  systemId: SystemId;
  revision: string;
  genomeCommit: CommitHash;
  readiness: ReadinessReport;
  rules: Readiness;
}

// ---------------------------------------------------------------------------
// Evolutions, realizations, candidates, evaluations, commits
// ---------------------------------------------------------------------------

/** The Genome's Evolution plus runtime state; `state` is the platform's current state. */
export type Evolution = schema.Evolution & {
  /** Who decided and why (`decision` keeps the model's string form: the rationale). */
  decisionRecord?: { by: string; policy: string; rationale: string; at: string };
};

export interface Checkpoint {
  seq: number;
  at: string;
  summary: string;
  commit?: CommitHash;
}

export type RealizationStatus = schema.Realization["status"] | "awaiting-admin";

/** The backend always sets `systemId`, `n`, `createdAt` and `updatedAt`; they are optional so UI fixtures can omit them. */
export type Realization = Omit<schema.Realization, "status" | "workspace" | "checkpoints"> & {
  systemId?: SystemId;
  /** System-wide ordinal: the fork is `<repo>--r<n>`. */
  n?: number;
  /** `local` = CLI on the user's machine; `hosted` = platform-run agent. */
  mode?: "local" | "hosted";
  /** `repo` is the repo the fork was taken from; `remote` is the fork's git URL (no credentials). */
  workspace: schema.Realization["workspace"] & { remote?: string };
  /** System head when work started; promotion is stale-base if the head has moved since. */
  baseRevision?: string | null;
  status: RealizationStatus;
  checkpoints: Checkpoint[];
  /** Set by `POST …/realizations/:rid/reject`. */
  rejectionReason?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface Candidate {
  id: string;
  realization: string;
  evolution: NodeId;
  commit: CommitHash;
  /** `composed` candidates bind several realizations (`artyfact compose`). */
  composedFrom?: string[];
  baseRevision: string;
  /** Repo-relative paths changed vs the base commit. */
  changedPaths: string[];
  /** Model nodes touched, via source-map; `unmapped:<path>` for misses. */
  changedSubjects: string[];
  genomeChanges: string[];
  submittedAt: string;
  state: "submitted" | "evaluated" | "selected" | "promoted" | "rejected";
}

export interface ArtifactBinding {
  repo: string;
  commit: CommitHash;
}

/** Composition manifest hashed (canonical JSON, SHA-256) into a System commit. */
export interface SystemManifest {
  genomeCommit: CommitHash;
  artifacts: Record<NodeId, ArtifactBinding>;
  templateVersions: Record<string, string>;
  hookVersions: Record<string, string>;
}

/** The model's SystemCommit (`manifest` as artifact bindings) plus the hashed composition. The backend always sets the extras. */
export type SystemCommit = schema.SystemCommit & {
  /** The hashed composition manifest. */
  composition?: SystemManifest;
  manifestHash?: Sha256;
  createdAt?: string;
};

// ---------------------------------------------------------------------------
// Work protocol (backend.md B.4/B.5)
// ---------------------------------------------------------------------------

/** `POST /api/systems/:id/evolutions/:eid/realizations` body. */
export interface StartWorkRequest {
  agentLabel?: string;
  target?: "app" | "genome";
  role?: schema.Realization["agent"]["role"];
}

/** Machine-readable form of the Task Packet; `markdown` is the same content for agents. Never carries a token. */
export interface TaskPacket {
  systemId: SystemId;
  realizationId: string;
  evolutionId: NodeId;
  title: string;
  target: "app" | "genome";
  intent: string;
  /** Fork to clone; never carries a token. */
  workspace: { repo: string; fork: string; baseCommit: CommitHash; remote: string };
  /** `gate: true` = blocks promotion when not pass+completed (hard, not deferred, gated on promotion). */
  acceptanceCriteria: { id: NodeId; title: string; text: string; gate: boolean; severity: string; subject: NodeId; hooks: string[] }[];
  /** Affected nodes as YAML, with their containment path from the System root. */
  genomeExcerpts: { id: NodeId; kind: string; path: NodeId[]; body: string }[];
  journeys: { id: NodeId; title: string; steps: string[] }[];
  commitments: string[];
  permittedPaths: string[];
  protectedPaths: string[];
  entryFiles: { path: string; certainty: Certainty }[];
  commands: string[];
  concurrentWork: { realization: string; agentLabel?: string; status: string; changedSubjects: string[] }[];
  /** `ARTYFACT_TOKEN=<token> npx artyfact start …` with the literal placeholder `<token>`. */
  startCommand: string;
  submitInstructions: string;
  /** SHA-256 of the canonical JSON of every other field except `markdown` and `agentsMd`. */
  hash: Sha256;
  markdown: string;
  /** Harness-agnostic AGENTS.md block (backend.md B.6). */
  agentsMd: string;
}

/** Response to start work. The only place the fork write token appears. */
export interface StartWorkResponse {
  systemId: SystemId;
  realization: Realization;
  packet: TaskPacket;
  token: { value: string; expiresAt: string; remote: string };
  /** Fork remote URL (same as `token.remote`). */
  remote: string;
  /** Ready to paste: `ARTYFACT_TOKEN=<real token> npx artyfact start <rid> --system <sid> --evolution <eid> --dir <dir>`. */
  startCommand: string;
}

/** `GET …/realizations/:rid/packet`. Token is never re-issued here. */
export interface PacketResponse {
  systemId: SystemId;
  realization: Realization;
  packet: TaskPacket;
  /** Fork remote URL (without credentials). */
  remote: string;
}

/** `POST …/realizations/:rid/checkpoints`. `summary` is accepted as an alias of `message`. */
export interface CheckpointRequest {
  message?: string;
  summary?: string;
  commit?: CommitHash;
}
export interface CheckpointResponse {
  realization: Realization;
  checkpoint: Checkpoint;
}

/**
 * `GET …/realizations/:rid`: the realization's own fields at the top level (so it is a {@link Realization}),
 * plus the latest candidate, its evaluations and conflicts.
 */
export type RealizationResponse = Realization & {
  realization: Realization;
  candidateDetail?: Candidate;
  evaluations: Evaluation[];
  conflicts: ConflictReport[];
};

/** `POST …/realizations/:rid/submit`. Idempotent on (realization, commit). */
export interface SubmitRequest {
  commit: CommitHash;
  previewUrl?: string;
}
export interface SubmitResponse {
  /** false when this (realization, commit) was already submitted; hooks are not re-run. */
  created: boolean;
  realization: Realization;
  candidate: Candidate;
  evaluations: Evaluation[];
  conflicts: ConflictReport[];
}

/** `POST …/realizations/:rid/sync`: `submitted` is null when the fork head is already a candidate. */
export interface SyncResponse {
  head: CommitHash | null;
  submitted: SubmitResponse | null;
}

export type ConflictKind = "file" | "soft-semantic" | "hard-semantic" | "evidence";

export interface ConflictReport {
  kind: ConflictKind;
  /** Candidate ids involved. */
  candidates: string[];
  /** File paths, node ids, claim ids or evidence keys that collide. */
  subjects: string[];
  message: string;
}

/** `GET /api/systems/:id/evolutions/:eid/candidates`. */
export interface CandidatesResponse {
  evolution: NodeId;
  candidates: Candidate[];
  evaluations: Evaluation[];
  conflicts: ConflictReport[];
}

/** `GET /api/systems/:id/work`: board data, polled every 5 s or streamed. */
export interface WorkResponse {
  evolutions: Evolution[];
  realizations: Realization[];
}

/** `GET /api/systems/:id/evolutions` (client `getEvolutions`). Same payload as the work board. */
export type EvolutionsResponse = WorkResponse;

/** A criterion that does not meet pass+completed on a candidate. */
export interface GateItem {
  candidate: string;
  criterion: NodeId;
  severity: "hard" | "soft" | "advisory";
  verdict: Verdict | "missing";
  execution: Execution | "missing";
}

/** `POST /api/systems/:id/promote` (Authorization: Bearer ADMIN_TOKEN). */
export interface PromoteRequest {
  /** Candidate(s) to promote; several for a composed promotion. `candidateIds` is accepted as an alias. */
  candidates?: string[];
  candidateIds?: string[];
  /** Head the client saw; mismatch yields 409 {@link StaleBaseResponse}. */
  expectedHead: string | null;
  /** Required (non-empty) when the promotion has advisories; it acknowledges them. */
  rationale: string;
}
export interface PromoteResponse {
  commit: SystemCommit;
  /** Sibling candidates marked rejected by this promotion. */
  rejected: string[];
  /** Soft/advisory promotion-gated criteria that were not pass+completed, acknowledged by the rationale. */
  advisories: GateItem[];
}
export interface StaleBaseResponse extends ApiError {
  error: { code: "stale-base"; message: string; details: { currentHead: string | null } };
}
/**
 * 409 `blocked`: a hard promotion-gated criterion lacks pass+completed. 409 `advisories-unacknowledged`:
 * no blocking items, but advisories exist and the rationale is empty.
 */
export interface PromoteBlockedResponse extends ApiError {
  error: { code: "blocked" | "advisories-unacknowledged"; message: string; details: { blocking: GateItem[]; advisories: GateItem[] } };
}

/** One System One review of a changed node (`reviewDelta`): the model proposes, policy decides. */
export type DeltaReview = ReviewResult;

/**
 * `GET /api/systems/:id/realizations/:rid/review`: a Genome-targeting candidate with rule findings
 * (readiness before and after) and System One judgments per changed node.
 */
export interface GenomeCandidateReview {
  delta: SemanticDelta;
  readinessBase: Readiness;
  readinessCandidate: Readiness;
  review: DeltaReview[];
  evaluations: Evaluation[];
  /** Candidate id the review belongs to. */
  candidate?: string;
  /** Every System One signal from the hooks (reviewDelta, topology, purposeMeasures); `review` is the reviewDelta subset. */
  signals?: unknown[];
  /** Commitments the review asked about (statement text for `contradicts.<id>`); optional. */
  commitments?: Commitment[];
}

/** `POST /api/systems/:id/evolutions/:eid/accept` (admin) for genome-amendment realizations. */
export interface AcceptRequest {
  /** Canonical names; the backend also accepts `realization` / `rationale` as aliases. */
  realizationId: string;
  interpretation: string;
}
export interface AcceptResponse {
  genomeCommit: CommitHash;
  realization: Realization;
  commit: SystemCommit;
}

/** `POST /api/systems/:id/realizations/:rid/reject` (admin): reject a Genome amendment. */
export interface RejectRequest {
  reason: string;
}
export interface RejectResponse {
  realization: Realization;
}

/** `POST /api/systems/import`. */
export interface ImportSystemRequest {
  systemId: SystemId;
  genomeRepo: string;
  appRepo: string;
}
export interface ImportSystemResponse {
  system: SystemSummary;
  head: string;
  genomeCommit: CommitHash;
  appCommit: CommitHash;
  /** Evolutions seeded from the Genome's `evolutions/*.yaml`. */
  evolutions: NodeId[];
}

export interface EvaluationsResponse {
  evaluations: Evaluation[];
}
export interface ConflictsResponse {
  conflicts: ConflictReport[];
}
export interface HistoryResponse {
  /** Newest first. */
  commits: SystemCommit[];
}

// ---------------------------------------------------------------------------
// Server-sent events (`GET /api/systems/:id/events`)
// ---------------------------------------------------------------------------

export type SseEvent =
  | { type: "realization.created"; realization: Realization }
  | { type: "realization.updated"; realization: Realization }
  | { type: "checkpoint"; realization: string; checkpoint: Checkpoint }
  | { type: "candidate.submitted"; candidate: Candidate }
  | { type: "evaluation.completed"; evaluation: Evaluation }
  | { type: "conflict.detected"; conflict: ConflictReport }
  | { type: "evolution.updated"; evolution: Evolution }
  | { type: "system.promoted"; commit: SystemCommit }
  | { type: "genome.accepted"; genomeCommit: CommitHash }
  | { type: "system.imported"; system: SystemSummary }
  | { type: "ping" };

export type SseEventType = SseEvent["type"];

/** Every SSE `data:` line is one JSON envelope: the event plus its emission time. */
export type SseEnvelope = SseEvent & { at: string };

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: "ok";
  service: "artyfact-platform";
  time: string;
}
