/**
 * Wire types shared by the Worker (apps/platform/worker) and the SPA (src/api/client.ts).
 *
 * Source of truth: docs/design/backend.md (B.2, B.4, B.5, B.7) and docs/design/ui.md (C.0, C.6).
 * Domain DTOs (Evolution, Realization, ...) are the wire forms of docs/design/model.md objects; they
 * carry runtime state (status, timestamps) the Genome schema does not, so they stay local. Types that
 * are identical to `@artyfact/model` exports are re-exported from it below.
 *
 * All timestamps are ISO-8601 strings. All routes are under `/api`.
 */

import type { ModelIndex, SystemModel } from "@artyfact/model";

export type {
  /** Rules-engine readiness for a Genome snapshot (findings carry derivations). */
  Readiness as RulesReadiness,
  /** One rules-engine finding (`level`, `rule`, `subject`, `derivation`). */
  Finding as RuleFinding,
  SemanticDelta,
} from "@artyfact/model";
import type { Readiness as RulesReadiness } from "@artyfact/model";

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

/** Result of evaluating one criterion. Only `pass` renders in the success colour. */
export type Verdict = "pass" | "fail" | "unknown" | "stale" | "not-run";
/** Whether the verifier actually ran. A `pass` without `completed` never counts. */
export type Execution = "completed" | "not-run" | "errored" | "timed-out";

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

/** A finding produced by the rules engine (`@artyfact/rules`). */
export interface Finding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  subject: NodeId;
  message: string;
  facts?: Record<string, unknown>;
  nextAction?: string;
}

/** Readiness report: the three states are never summed. */
export interface ReadinessReport {
  modelReadiness: { findings: Finding[]; blockers: Finding[] };
  implementationConformance: { pass: number; fail: number; unknown: number; stale: number; notRun: number };
  outcomeProgress: { observed: number; unknown: number };
  computedAt: string;
}

/**
 * `GET /api/systems/:id/model?rev=`. `model` is the parsed System (shape defined by
 * `@artyfact/model`'s `System`); it is opaque here so the contract package can evolve.
 */
export interface ModelBundle {
  systemId: SystemId;
  /** Revision the model was loaded at: `canonical`, a System commit id, or a candidate id. */
  revision: string;
  genomeCommit: CommitHash;
  model: SerializedModel;
  readiness: ReadinessReport;
  /** Full rules-engine output behind `readiness.modelReadiness` (findings with derivations). */
  rules?: RulesReadiness;
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

/** `GET /api/systems/:id/readiness?rev=`. */
export interface ReadinessResponse {
  systemId: SystemId;
  revision: string;
  genomeCommit: CommitHash;
  readiness: ReadinessReport;
  rules: RulesReadiness;
}

/** `GET /api/systems`. */
export interface SystemsResponse {
  systems: SystemSummary[];
}

// ---------------------------------------------------------------------------
// Evolutions, realizations, candidates, evaluations, commits
// ---------------------------------------------------------------------------

export type EvolutionState =
  | "proposed" | "genome-approved" | "actionable" | "realizing"
  | "evaluated" | "promoted" | "rejected" | "withdrawn";

export interface Evolution {
  id: NodeId;
  title: string;
  intent: string;
  state: EvolutionState;
  baseRevision?: string;
  kind: "implementation" | "genome-amendment" | "mixed";
  affectedNodes: NodeId[];
  affectedClaims: NodeId[];
  genomeDelta: { op: "add" | "change" | "remove"; path: string; summary: string }[];
  acceptanceCriteria: NodeId[];
  requiredEvidence: string[];
  dependsOn: NodeId[];
  risk: "low" | "medium" | "high";
  realizations: string[];
  decision?: { by: string; policy: string; rationale: string; at: string };
}

export type RealizationStatus =
  | "claimed" | "working" | "submitted" | "evaluating" | "evaluated"
  | "selected" | "promoted" | "rejected" | "abandoned" | "awaiting-admin";

export interface Realization {
  id: string;
  systemId: SystemId;
  evolution: NodeId;
  /** 1-based ordinal within the evolution (`kit-app--rN`). */
  n: number;
  agent: {
    id: string;
    harness?: string;
    role: "implementer" | "assay-author" | "verifier" | "reviewer" | "repairer";
  };
  /** `app` forks the app repo; `genome` forks the Genome repo (amendment). */
  target: "app" | "genome";
  /** `local` = CLI on the user's machine; `hosted` = platform-run agent. */
  mode?: "local" | "hosted";
  /** `repo` is the repo the fork was taken from; `remote` is the fork's git URL (no credentials). */
  workspace: { repo: string; fork: string; baseCommit: CommitHash; tokenExpiresAt?: string; remote?: string };
  /** System head when work started; promotion is stale-base if the head has moved since. */
  baseRevision?: string | null;
  status: RealizationStatus;
  checkpoints: Checkpoint[];
  candidate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Checkpoint {
  seq: number;
  at: string;
  summary: string;
  commit?: CommitHash;
}

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

export interface Evaluation {
  id: string;
  candidate: string;
  criterion: NodeId;
  ownerId?: NodeId;
  subjectId?: NodeId;
  targetRef?: string;
  startedAt?: string;
  finishedAt?: string;
  interpretation?: string;
  limitations?: string[];
  provenance?: Record<string, unknown>;
  hook: "exists" | "scope" | "genome-amendment" | "overlap" | "health" | "semantic" | (string & {});
  execution: Execution;
  verdict: Verdict;
  observations: unknown;
  /** R2 key of raw evidence, if any. */
  evidenceKey?: string;
  verifier: string;
  at: string;
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

export interface SystemCommit {
  id: string;
  parent: string | null;
  manifest: SystemManifest;
  manifestHash: Sha256;
  evolutions: NodeId[];
  candidates: string[];
  rejected: string[];
  evidence: string[];
  decision: { by: string; policy: string; rationale: string; at: string };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Work protocol (backend.md B.4/B.5)
// ---------------------------------------------------------------------------

/** `POST /api/systems/:id/evolutions/:eid/realizations` body. */
export interface StartWorkRequest {
  agentLabel?: string;
  target?: "app" | "genome";
  role?: Realization["agent"]["role"];
}

/** Machine-readable form of the Task Packet; `markdown` is the same content for agents. */
export interface TaskPacket {
  systemId: SystemId;
  realizationId: string;
  evolutionId: NodeId;
  title: string;
  target: "app" | "genome";
  intent: string;
  /** Fork to clone; never carries a token. */
  workspace: { repo: string; fork: string; baseCommit: CommitHash; remote: string };
  /** `gate: true` = required for promotion (hard, not deferred). */
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
  submitInstructions: string;
  /** SHA-256 of the canonical JSON of every other field except `markdown` and `agentsMd`. */
  hash: Sha256;
  markdown: string;
  /** Harness-agnostic AGENTS.md block (backend.md B.6). */
  agentsMd: string;
}

/** Response to start work. `token` is a write token for the fork, shown once. */
export interface StartWorkResponse {
  systemId: SystemId;
  realization: Realization;
  packet: TaskPacket;
  token: { value: string; expiresAt: string; remote: string };
  /** Fork remote URL (same as `token.remote`). */
  remote: string;
}

/** `GET /api/realizations/:id/packet`. Token is never re-issued here. */
export interface PacketResponse {
  systemId: SystemId;
  realization: Realization;
  packet: TaskPacket;
  /** Fork remote URL (without credentials). */
  remote: string;
}

/** `POST …/realizations/:rid/checkpoints`. `message` is accepted as an alias of `summary`. */
export interface CheckpointRequest {
  summary?: string;
  message?: string;
  commit?: CommitHash;
}
export interface CheckpointResponse {
  realization: Realization;
  checkpoint: Checkpoint;
}

/** `GET …/realizations/:rid`: the realization with its latest candidate's evaluations and conflicts. */
export interface RealizationResponse {
  systemId: SystemId;
  realization: Realization;
  candidate?: Candidate;
  evaluations: Evaluation[];
  conflicts: ConflictReport[];
}

/** `POST …/realizations/:rid/sync`: `submitted` is null when the fork head is already a candidate. */
export interface SyncResponse {
  head: CommitHash | null;
  submitted: SubmitResponse | null;
}

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

/** `POST /api/systems/:id/promote` (Authorization: Bearer ADMIN_TOKEN). */
export interface PromoteRequest {
  /** Candidate(s) to promote; several for a composed promotion. `candidateIds` is accepted as an alias. */
  candidates?: string[];
  candidateIds?: string[];
  /** Head the client saw; mismatch yields 409 {@link StaleBaseResponse}. */
  expectedHead: string | null;
  rationale: string;
}
export interface PromoteResponse {
  commit: SystemCommit;
  /** Sibling candidates marked rejected by this promotion. */
  rejected: string[];
}
export interface StaleBaseResponse extends ApiError {
  error: { code: "stale-base"; message: string; details: { currentHead: string | null } };
}
/** 409 when a required-gate criterion lacks `verdict=pass, execution=completed`. */
export interface PromoteBlockedResponse extends ApiError {
  error: {
    code: "blocked";
    message: string;
    details: { blocking: { candidate: string; criterion: NodeId; verdict: Verdict | "missing"; execution: Execution | "missing" }[] };
  };
}

/** `POST /api/systems/:id/evolutions/:eid/accept` (admin) for genome realizations. Aliases: `realizationId`, `interpretation`. */
export interface AcceptRequest {
  realization?: string;
  realizationId?: string;
  rationale?: string;
  interpretation?: string;
}
export interface AcceptResponse {
  genomeCommit: CommitHash;
  realization: Realization;
  commit: SystemCommit;
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
