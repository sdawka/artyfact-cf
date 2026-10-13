/**
 * HookRunner contract between the SystemAuthority DO / routes (slice 1.2) and the hook engines (slice 1.3).
 *
 * Every context is plain, JSON-serialisable data: the caller reads Artifacts (trees, Genome files) and passes the
 * result in. The engines never touch the ARTIFACTS binding. Engine dependencies that are not data (System One
 * provider, fetch, clock) are given once to `createHookRunner()` in `run.ts`, not per call.
 *
 * Evaluation is the `@artyfact/model` schema type (execution: not-run | queued | running | completed | deferred |
 * error; verdict: pass | fail | unknown | stale | waived). `unknown` is never green; a hook that throws records
 * `execution: "error"` with the message in `observations`.
 */
import type { Readiness, SemanticDelta, schema } from "@artyfact/model";
import type { InterferenceResult, Level, PurposeMeasureResult, ReviewResult, SemanticChange, TopologyResult, Verdict } from "@artyfact/semantic";
import type { ConflictReport as ApiConflictReport } from "../../shared/api";

export type Evaluation = schema.Evaluation;

/** Plain file map: repo-relative path → UTF-8 content. */
export type FileMap = Record<string, string>;

/** One blob in the candidate's tree at `commit`. */
export interface TreeEntry {
  path: string;
  /** Size in bytes. */
  size: number;
}

/** A submitted candidate, as stored by the DO. */
export interface CandidateRef {
  id: string;
  realizationId: string;
  evolutionId: string;
  /** `app` forks the app repo; `genome` forks the Genome repo (amendment). */
  target: "app" | "genome";
  commit: string;
  baseCommit: string;
  /** Repo-relative paths changed vs `baseCommit` (added, modified and removed). */
  changedPaths: string[];
  /** Model node ids via source-map; `unmapped:<path>` for misses. */
  changedNodes: string[];
  /**
   * Source-map result per changed path (path → node ids; `[]` or absent = unmapped). Scope needs it to pass an app
   * candidate: when absent, every changed non-platform path is unattributed and scope is at best `unknown`.
   */
  pathNodes?: Record<string, string[]>;
  previewUrl?: string;
  /** Runtime identity from a passed stored build for this candidate, commit, and preview URL. */
  expectedBuildId?: string;
  /**
   * `target: "genome"` only: the full Genome file map at `commit`. Paths are Genome-relative (`node.yaml`,
   * `thing.webapp/section.ui/node.yaml`); a `system/` prefix is accepted and stripped.
   */
  genomeFiles?: FileMap;
}

/** Input to `runSubmission`, `runGenome` and `conflicts`. */
export interface SubmissionContext {
  systemId: string;
  candidate: CandidateRef;
  /** Canonical Genome commit the candidate is based on, and its full file map. Criteria and hooks come from here. */
  genomeCommit: string;
  genomeFiles: FileMap;
  /** Blobs in the candidate tree at `candidate.commit` (manifest engine). */
  tree: TreeEntry[];
  /** Globs from the Task Packet (picomatch, `dot: true`). */
  permittedPaths: string[];
  protectedPaths: string[];
  /** Other open (submitted, not promoted/rejected) candidates of the same System, excluding `candidate`. */
  openCandidates: CandidateRef[];
  /**
   * Facts only the DO knows, for `inputs.check` items on promotion hooks (C.system.promotion). Omit at submission:
   * the matching checks are then `not-run` and the criterion stays `unknown`. Supply at promotion revalidation.
   */
  promotionFacts?: PromotionFacts;
  /**
   * Why the hooks run: at `submission` (default) hooks triggered on submission or candidate run; at the `promotion`
   * re-run, hooks triggered on promotion run as well (and system criteria gated on promotion are selected).
   */
  trigger?: "submission" | "promotion";
  /**
   * The candidate's Evolution as the SystemAuthority DO stores it, with the task's acceptance criteria for a task
   * realization. When given (and naming `candidate.evolutionId`), hook selection uses it over the Genome's Evolution;
   * Evolutions created through the API exist only there.
   */
  evolution?: EvolutionRef;
}

/** The Evolution fields hook selection reads. */
export type EvolutionRef = Pick<schema.Evolution, "id" | "kind" | "acceptanceCriteria" | "affectedNodes" | "state">;

export interface PromotionFacts {
  /** Current head commit of the candidate's target repo in the System manifest; `base-current` = equals candidate.baseCommit. */
  currentBaseCommit?: string;
  /** `manifest-exact`: the composed manifest to promote binds exactly this candidate's commit(s). */
  manifestExact?: boolean;
  /** `evidence-fresh`: every required evaluation was produced for this candidate at this commit. */
  evidenceFresh?: boolean;
}

export type GenomeContext = SubmissionContext;
export type ConflictContext = Pick<SubmissionContext, "systemId" | "candidate" | "genomeCommit" | "genomeFiles" | "openCandidates">;

/**
 * A conflict between candidates. Extends the wire DTO (`subjects` = nodes ∪ paths) with the split lists.
 * `semantic` carries the System One interference judgment for the pair, when it ran.
 */
export interface ConflictReport extends ApiConflictReport {
  nodes: string[];
  paths: string[];
  semantic?: InterferenceResult;
  /** Set when overlap could not be fully determined (a Genome that does not load, a composition check that threw). */
  error?: string;
}

/** One System One signal on a Genome candidate, for the admin review queue. Never a gate by itself. */
export interface DeltaReview {
  /** Node, claim or other model id the signal is about. */
  subject: string;
  judgment: "reviewDelta" | "topology" | "purposeMeasures";
  level: Level;
  verdict: Verdict;
  /** reviewDelta only: the change as sent to System One. */
  change?: SemanticChange;
  signals: ReviewResult | TopologyResult | PurposeMeasureResult;
}

export interface GenomeResult {
  readiness: Readiness;
  review: DeltaReview[];
  evaluations: Evaluation[];
}

export interface HookRunner {
  /** Selects the candidate's hooks (see run.ts) and returns one Evaluation per (hook, criterion), never missing a required one. */
  runSubmission(ctx: SubmissionContext): Promise<Evaluation[]>;
  /** Genome realizations: rules on the fork (Readiness), System One review of the delta, plus runSubmission's evaluations. */
  runGenome(ctx: GenomeContext): Promise<GenomeResult>;
  /** File / soft-semantic / hard-semantic conflicts between `candidate` and each open candidate. */
  conflicts(ctx: ConflictContext): Promise<ConflictReport[]>;
}

/** Queue consumer callbacks (queue.ts). */
export interface QueueContext {
  /** Realization id owning the Artifacts repo `repoName` (a fork), or null when the repo is not a known fork. */
  resolveFork(namespace: string, repoName: string): Promise<string | null>;
  /** DO submit, idempotent on (realization, commit). */
  submit(realizationId: string, commit: string, source: "event"): Promise<unknown>;
  /** Records `id` in events_seen; true when it was new. */
  markEventSeen(id: string): Promise<boolean>;
}

export type { SemanticDelta };
