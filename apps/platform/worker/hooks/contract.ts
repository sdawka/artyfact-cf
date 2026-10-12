/**
 * Contract between the backend core (slice 1.2) and the hook engines + queue consumer (slice 1.3).
 * Interfaces only. The wiring lives in `./index.ts`; implementations in `./run.ts` / `./queue.ts`.
 *
 * All contexts are built by the Worker (routes or queue), never inside the Durable Object, so hooks
 * may read Artifacts through `repo` and run `@artyfact/model` / `@artyfact/rules` directly.
 */
import type { Readiness, SemanticDelta, SystemModel, schema } from "@artyfact/model";
import type { ConflictReport, Evaluation, Realization, SubmitResponse } from "../../shared/api";
import type { ArtifactsRepoLike } from "../artifacts/client";
import type { CandidateManifest } from "../artifacts/candidates";
import type { SourceMapEntry } from "../artifacts/source-map";

export type { CandidateManifest };

/** A candidate as hooks see it: the manifest plus its platform id and current state. */
export interface CandidateRef extends CandidateManifest {
  id: string;
  state: "submitted" | "evaluated" | "selected" | "promoted" | "rejected";
  submittedAt: string;
  /** Genome realizations: delta of the candidate Genome vs base, when it loaded. */
  genomeDelta?: SemanticDelta;
}

/** Canonical model at the candidate's base Genome commit. */
export interface ModelAtBase {
  genomeCommit: string;
  model: SystemModel;
  readiness: Readiness;
}

interface BaseContext {
  env: Env;
  systemId: string;
  /** Promotion revalidation sets `promotion`; normal submission uses `submission`. */
  trigger: "submission" | "promotion";
  candidate: CandidateRef;
  realization: Realization;
  evolution: schema.Evolution;
  base: ModelAtBase;
  /** Evolution acceptance criteria resolved against `base.model` (missing ids dropped). */
  acceptanceCriteria: schema.Criterion[];
  /** Criteria that must be pass+completed before promotion (computed by the backend). */
  requiredCriteria: string[];
  /** From the Task Packet: what the realization may and may not touch. */
  permittedPaths: string[];
  protectedPaths: string[];
  sourceMap: SourceMapEntry[];
  /** Other open (submitted/evaluated) candidates in the same System, newest first. */
  otherCandidates: CandidateRef[];
  previewUrl?: string;
  /** The fork, for reading the candidate tree (e.g. required files). Valid only during the call. */
  repo: ArtifactsRepoLike;
}

/** App realizations: evaluate a candidate commit of the app fork. */
export interface SubmissionContext extends BaseContext {
  /** All blob paths at the candidate commit (repo-relative). */
  listFiles(): Promise<string[]>;
  /** File text at the candidate commit, or null if absent. */
  readFile(path: string): Promise<string | null>;
  /** Byte size of a file at the candidate commit, or null if absent. */
  fileSize(path: string): Promise<number | null>;
}

/** Genome realizations: evaluate a candidate commit of the Genome fork. */
export interface GenomeContext extends BaseContext {
  /** Genome YAML files (path relative to the Genome root) at base and at the candidate commit. */
  baseFiles: Map<string, string>;
  candidateFiles: Map<string, string>;
}

export interface GenomeReview {
  readiness: Readiness | null;
  /** Review signals for the Genome candidate (e.g. System One `reviewDelta`). Opaque to the backend. */
  review: unknown[];
  evaluations: Evaluation[];
  /** Candidate model delta vs base, if computed. */
  delta?: SemanticDelta;
}

export interface ConflictContext {
  env: Env;
  systemId: string;
  base: ModelAtBase;
  /** When set, report conflicts involving this candidate only; otherwise all pairs. */
  candidate?: CandidateRef;
  openCandidates: CandidateRef[];
}

export interface HookRunner {
  runSubmission(ctx: SubmissionContext): Promise<Evaluation[]>;
  runGenome(ctx: GenomeContext): Promise<GenomeReview>;
  conflicts(ctx: ConflictContext): Promise<ConflictReport[]>;
}

export type HookRunnerFactory = (env: Env) => HookRunner;

export type SubmitSource = "cli" | "event" | "sync" | "ui";

/** What the queue consumer gets per batch. */
export interface QueueContext {
  env: Env;
  /** Fork repo name → owning realization, or null for repos the platform did not create. */
  resolveFork(repo: string): Promise<{ systemId: string; realizationId: string } | null>;
  /** Submit `commit` for a realization; idempotent on (realization, commit). */
  submit(realizationId: string, commit: string, source: SubmitSource, systemId?: string): Promise<SubmitResponse>;
  /** Record an event id; resolves false if it was already seen (skip it). */
  markEventSeen(id: string, systemId?: string): Promise<boolean>;
}

export type QueueHandler = (batch: MessageBatch<unknown>, ctx: QueueContext) => Promise<void>;
