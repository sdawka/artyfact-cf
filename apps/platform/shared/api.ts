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

import type { Finding, ModelIndex, PhenomeEventHeader, Readiness, SemanticDelta as ModelDelta, SystemModel, schema } from "@artyfact/model";
import type { LinkCertainty, MapLayer, NodeCriterion, ResolvedKindView } from "@artyfact/ontology";
import type { Commitment, ReviewResult, SemanticDelta } from "@artyfact/semantic";

export type { Finding, PhenomeEventHeader, Readiness } from "@artyfact/model";
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
/** `?a=1&b=2` from the defined, non-empty entries; "" when there are none. */
const qs = (q: Record<string, string | number | undefined>) => {
  const p = Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${enc(String(v))}`);
  return p.length ? `?${p.join("&")}` : "";
};
/** System-scoped realization routes added in iteration 2: `/api/systems/:sid/realizations/:rid`. */
const srz = (s: string, r: string) => `${sys(s)}/realizations/${enc(r)}`;
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
  /** `POST` (admin) → {@link EvaluateCandidateResponse}: re-run an open candidate's submission hooks. */
  evaluateCandidate: (s: string, c: string) => `${sys(s)}/candidates/${enc(c)}/evaluate`,
  history: (s: string) => `${sys(s)}/history`,
  events: (s: string) => `${sys(s)}/events`,

  // Iteration 2. `evolutions(s)` also takes POST {@link CreateEvolutionRequest} (admin).
  /** Editor: `GET` → {@link FilesResponse}. */
  files: (s: string, scope: FileScope, ref?: RefString) => `${sys(s)}/files${qs({ scope, ref })}`,
  /** Editor: `GET` → {@link FileResponse}. */
  file: (s: string, scope: FileScope, path: string, ref?: RefString) => `${sys(s)}/file${qs({ scope, ref, path })}`,
  /** Editor: `POST` {@link EditorCommitRequest} → {@link EditorCommitResponse}. */
  editorCommit: (s: string, r: string) => `${srz(s, r)}/commit`,
  /** `GET` → {@link RevisionsResponse}. */
  revisions: (s: string) => `${sys(s)}/revisions`,
  /** `GET` → {@link ChangelogResponse}, newest first; `before` is a System commit id. */
  changelog: (s: string, q: { limit?: number; before?: string } = {}) => `${sys(s)}/changelog${qs(q)}`,
  /** `GET` → {@link ChangelogEntry}. */
  changelogEntry: (s: string, commitId: string) => `${sys(s)}/changelog/${enc(commitId)}`,
  /** `GET` → {@link SystemCompare}. `from` omitted = the parent of `to`. */
  compareSystem: (s: string, from: RefString | undefined, to: RefString) => `${sys(s)}/compare/system${qs({ from, to })}`,
  /** `GET` → {@link GenomeCompare}. */
  compareGenome: (s: string, from: RefString | undefined, to: RefString) => `${sys(s)}/compare/genome${qs({ from, to })}`,
  /** `GET` → {@link FileCompare}. */
  compareFile: (s: string, scope: FileScope, from: RefString | undefined, to: RefString, path: string) =>
    `${sys(s)}/compare/file${qs({ scope, from, to, path })}`,
  /** `POST` {@link BuildReport} → {@link BuildReportResponse}; `GET` → {@link BuildsResponse}. */
  realizationBuilds: (s: string, r: string) => `${srz(s, r)}/builds`,
  /** `GET` → {@link BuildsResponse}; `POST` {@link BuildReport} (production report) → {@link BuildReportResponse}. */
  builds: (s: string, q: { commit?: CommitHash; kind?: BuildKind } = {}) => `${sys(s)}/builds${qs(q)}`,
  /** `GET` → {@link DeploymentsResponse}; `POST` {@link DeploymentRequest} → {@link DeploymentCreated}. */
  deployments: (s: string) => `${sys(s)}/deployments`,
  /** `POST` → {@link IngestTokenResponse}: mints a fresh Phenome ingest token for the deployment. */
  deploymentIngestToken: (s: string, d: string) => `${sys(s)}/deployments/${enc(d)}/ingest-token`,
  /** `POST` {@link PhenomeIngestRequest} → {@link PhenomeIngestResponse}; `GET` → {@link PhenomeEventsResponse}. */
  phenomeEvents: (s: string, q: PhenomeEventsQuery = {}) => `${sys(s)}/phenome/events${qs({ ...q })}`,

  /** `GET` → {@link TemplateUpgradePlan}; `POST` {@link TemplateUpgradeRequest} (admin) → {@link TemplateUpgradeResponse}. */
  templateUpgrade: (s: string, ref?: RefString) => `${sys(s)}/template-upgrade${qs({ ref })}`,

  // Iteration 3: intents (admin). See docs/design/ontology.md.
  /** `POST` {@link IntentRequest} → 201 {@link Proposal}. */
  intents: (s: string) => `${sys(s)}/intents`,
  /** `GET` → {@link Proposal}. */
  intent: (s: string, p: string) => `${sys(s)}/intents/${enc(p)}`,
  /** `POST` {@link IntentReply} → {@link Proposal} (the same proposal, revised). */
  intentReply: (s: string, p: string) => `${sys(s)}/intents/${enc(p)}/reply`,
  /** `POST` {@link IntentAccept} → 201 {@link IntentAcceptResponse}. */
  intentAccept: (s: string, p: string) => `${sys(s)}/intents/${enc(p)}/accept`,
  intentRevise: (s: string, p: string) => `${sys(s)}/intents/${enc(p)}/revise`,
  intentAbandon: (s: string, p: string) => `${sys(s)}/intents/${enc(p)}/abandon`,
  /** `PUT` {@link IntentDecisionsRequest} (admin) → {@link Proposal}; 404 unknown node, 409 `invalid-state` unless open. */
  intentDecisions: (s: string, p: string) => `${sys(s)}/intents/${enc(p)}/decisions`,

  // System import review (backend.md B.10). Distinct from ontology package import review (shared/ontology-packages.ts).
  /** `GET` → {@link SystemImportReview}; 404 when the System has none. */
  importReview: (s: string) => `${sys(s)}/import-review`,
  /** `POST` {@link SystemImportReviewAccept} (admin) → {@link SystemImportReviewAcceptResponse}. */
  importReviewAccept: (s: string) => `${sys(s)}/import-review/accept`,
} as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Dotted model id such as `system.peopling`, `screen.people`, `evolution.1`, `crit.x`. */
export type NodeId = string;
export type SystemId = string;
/** Git commit hash (full sha) of a Genome or Artifacts repo. */
export type CommitHash = string;
/** SHA-256 hex of canonical JSON. */
export type Sha256 = string;

export type Certainty = "declared" | "assumed" | "proposed";

/**
 * Error codes the Genome review and planning routes add (`ApiError.code` stays a plain string):
 * `import-unreviewed` (409) work was asked for while the System import review is pending;
 * `rejected-node-referenced` (422) accepting the import review would remove nodes that surviving nodes still reference.
 * Invalid task lists stay 400 `bad-request` on create; the draft route reports them as `problems`.
 */
export type ReviewPlanErrorCode = "import-unreviewed" | "rejected-node-referenced";

/** Error body for every non-2xx response. */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Systems and the model bundle
// ---------------------------------------------------------------------------

/**
 * What the System list and overview show as badges, derived by `summary()`:
 * `evolving` a realization is claimed/working/evaluating; `pending-realization` evaluated candidates not promoted, or
 * actionable evolutions with no realization; `awaiting-admin` a Genome candidate awaits accept; `built` a promotion
 * bound an app commit; `deployed` production is live on `appCommit`; `behind` live production is older than `appCommit`;
 * `not-fully-built` readiness errors/missing > 0 or not built; `observed` a Phenome event in the last 24 h;
 * `unrealized` phase unrealized and no candidates ever. `import-pending` the System import review is pending;
 * `tasks-awaiting-agent` `planCounts.awaitingAgent > 0`; `plan-awaiting-promotion` `planCounts.integrated > 0`.
 */
export type Signifier =
  | "evolving" | "pending-realization" | "awaiting-admin" | "not-fully-built" | "built" | "deployed" | "behind" | "observed" | "unrealized"
  | "import-pending" | "tasks-awaiting-agent" | "plan-awaiting-promotion";

/** Production deployment state relative to `appCommit`. */
export type DeployState = "none" | "pending" | "live" | "behind" | "failed";

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
  // Iteration 2: optional until the backend slice that computes them lands, and so summaries stored before it parse.
  /** App commit bound at the head. */
  appCommit?: CommitHash;
  built?: boolean;
  /**
   * `pending`: open candidates (submitted, evaluated, selected); `awaitingAdmin`: Genome amendments; `awaitingReview`:
   * both, one per realization, the number the Review rail shows (absent from older servers).
   */
  realizationCounts?: { evolving: number; pending: number; awaitingAdmin: number; awaitingReview?: number };
  openCandidates?: number;
  latestBuild?: BuildSummary | null;
  deployment?: { production: Deployment | null; previews: number };
  deployState?: DeployState;
  phenome?: { events: number; lastEmittedAt?: string };
  readiness?: { errors: number; missing: number };
  signifiers?: Signifier[];
  /** Realization plans (docs/design/lifecycle.md, contract addendum). Absent from older servers. */
  planCounts?: PlanCounts;
  /** The System import review; absent when the System was imported without one (`review: false`). */
  importReview?: { status: SystemImportReviewStatus; genomeCommit: CommitHash; nodes: number };
}

/**
 * Realization plan counts on the System summary (on `GET /api/systems` only as fresh as the last registry refresh):
 * `open` plans not yet promoted; `awaitingAgent` tasks of open plans an agent can take now (pending with every
 * dependency selected, or claimed/working with the latest attempt's lease lapsed, and no conflicting task with a live
 * attempt); `submitted` tasks whose candidate
 * awaits selection; `integrated` plans integrated and awaiting promotion.
 */
export interface PlanCounts {
  open: number;
  awaitingAgent: number;
  submitted: number;
  integrated: number;
}

/** `GET /api/platform`: whether this Worker is the hosted demo, whose judgments are simulated, and its Flagship flags. */
export interface PlatformResponse {
  hostedDemo: boolean;
  notice?: string;
  /** The `cat-mode` Flagship flag; false when the binding is absent or evaluation fails. */
  catMode: boolean;
}

/** `GET /api/systems`. */
export interface SystemsResponse {
  systems: SystemSummary[];
}

/** `DELETE /api/systems/:id` (admin). `stateCleared` is false when the registry row went but the System DO could not be wiped. */
export interface DeleteSystemResponse {
  systemId: string;
  stateCleared: boolean;
}

/** The three readiness states the UI shows; they are never summed. */
export interface ReadinessSummary {
  modelReadiness: { findings: Finding[]; blockers: Finding[] };
  implementationConformance: { pass: number; fail: number; unknown: number; stale: number; notRun: number };
  outcomeProgress: { observed: number; unknown: number };
  computedAt: string;
}

/**
 * The full `@artyfact/model` rules-engine `Readiness` (findings with derivations, `derived` relation → tuples,
 * packs, snapshotHash, incomplete, actionable) plus the {@link ReadinessSummary}.
 */
export type ReadinessReport = Readiness & ReadinessSummary & {
  /** Exact imported Genome integrity, distinct from legacy rules readiness. */
  integrity?: import("./integrity").IntegrityCurrentSummary;
};

/** `SystemModel.index` without functions: `byId` without the duplicated `item`, `path()` materialised. */
export interface SerializedIndex extends Omit<ModelIndex, "byId" | "path" | "layer" | "depthOf" | "layerOf"> {
  byId: Record<NodeId, { id: NodeId; type: string; kind: string; name: string }>;
  /** Containment path from the System root, for every indexed id. */
  paths: Record<NodeId, NodeId[]>;
  /** Nearest `section` at or above each id, where there is one. */
  layers: Record<NodeId, NodeId>;
}

/** The composed template's view hints: every declared kind resolved, and the Map layers in template order. */
export interface ModelViews {
  kinds: Record<string, ResolvedKindView>;
  layers: MapLayer[];
}

/** `@artyfact/model`'s `SystemModel` as JSON (see `serializeModel` in the Worker). */
export type SerializedModel = Omit<SystemModel, "index" | "graph" | "template"> & { index: SerializedIndex; views: ModelViews };

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
}

/** `GET /api/systems/:id/readiness?rev=`. */
export type ReadinessResponse = ReadinessReport & {
  systemId: SystemId;
  revision: string;
  genomeCommit: CommitHash;
};

// ---------------------------------------------------------------------------
// Evolutions, realizations, candidates, evaluations, commits
// ---------------------------------------------------------------------------

/** The Genome's Evolution plus runtime state; `state` is the platform's current state. */
export type Evolution = schema.Evolution & {
  /** Who decided and why (`decision` keeps the model's string form: the rationale). */
  decisionRecord?: { by: string; policy: string; rationale: string; at: string };
};

export interface Checkpoint {
  /** Per-realization ordinal; always set by the backend (optional for UI fixtures). */
  seq?: number;
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
  /** Who drives it: the CLI (default) or the in-browser editor. */
  origin?: RealizationOrigin;
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
  /** Candidate manifest hash (`CandidateManifest.hash`). */
  hash?: string;
  /** Per-subject operation, when the backend can tell added from changed from removed. */
  subjectDelta?: { added?: string[]; changed?: string[]; removed?: string[] };
  submittedAt: string;
  state: "submitted" | "evaluated" | "selected" | "promoted" | "rejected";
  /** Preview URL from the submit or a later build report. */
  previewUrl?: string;
  /** Latest build of this candidate's commit. */
  build?: BuildSummary;
  /** Task and integration candidates: the model delta of the candidate's `system/` vs the pinned Genome; absent when it is untouched. */
  model?: CandidateModel;
}

/**
 * A lifecycle candidate's model delta (docs/design/task-fork-model.md §2): `changedPaths` are the `system/**` files that
 * differ from the pinned Genome at `genomeCommit`, `delta` the semantic difference of the two loaded models, `changedNodes`
 * its ids. `loadError` is set when the candidate's model does not load (`delta` is then empty, not unchanged).
 */
export interface CandidateModel {
  prefix: "system";
  genomeCommit: string;
  changedPaths: string[];
  changedNodes: string[];
  delta: ModelDelta;
  loadError?: string;
  /** Changed model files outside the Task's write nodes (their directories and declaring files): a reviewer accepts them knowingly or not at all. */
  outsideWriteNodes?: string[];
}

export interface ArtifactBinding {
  repo: string;
  commit: CommitHash;
  /** Where the app's first code came from when it was seeded from a template scaffold (`artyfact init --from-template`). */
  scaffoldFrom?: ScaffoldSource;
  /** Accepted Genome actually implemented by this binding, independent of the current Genome. */
  realizedGenome?: CommitHash;
  realizationPlan?: string;
}

/** A scaffold source in the namespace: a whole repo (forked) or a subtree of one (copied). */
export interface ScaffoldSource {
  repo: string;
  commit: CommitHash;
  path?: string;
}

/** The `platform` meta repo the System was imported against (provenance only; evaluation uses the bundled packages). */
export interface PlatformRef {
  repo: string;
  commit: CommitHash;
}

/** Composition manifest hashed (canonical JSON, SHA-256) into a System commit. */
export interface SystemManifest {
  genomeCommit: CommitHash;
  artifacts: Record<NodeId, ArtifactBinding>;
  templateVersions: Record<string, string>;
  hookVersions: Record<string, string>;
  /** `platform` repo commit at import; null when the namespace had no `platform` repo. Absent on states from before 2.7. */
  platform?: PlatformRef | null;
}

/** The model's SystemCommit (`manifest` as artifact bindings) plus the hashed composition. The backend always sets the extras. */
export type SystemCommit = schema.SystemCommit & {
  /**
   * `acknowledged`: advisory criteria the promoter accepted with the rationale. `evidenceProviders`: the distinct
   * System One providers (`fake`, `typesafe`, `openrouter`, …) behind the gating evaluations; `fake` means the
   * operator ran with `FAKE_S1=1` and those judgments were canned.
   */
  decision: { acknowledged?: NodeId[]; evidenceProviders?: string[] };
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
  /** Who drives the realization: the CLI (default) or the in-browser editor. */
  origin?: RealizationOrigin;
}

export type RealizationOrigin = "cli" | "editor";

/** What triggered a submit: the CLI, a push event, a sync, the UI (editor commit), or a CI report. */
export type SubmitSource = "cli" | "event" | "sync" | "ui" | "ci";

/** `POST /api/systems/:id/evolutions` (admin): a new Evolution in state `proposed`/`actionable` per policy. */
export interface CreateEvolutionRequest {
  title: string;
  intent: string;
  affectedNodes?: NodeId[];
  kind?: schema.Evolution["kind"];
  risk?: schema.Evolution["risk"];
  acceptanceCriteria?: NodeId[];
}
export interface CreateEvolutionResponse {
  evolution: Evolution;
}

/** Machine-readable form of the Task Packet; `markdown` is the same content for agents. Never carries a token. */
export interface TaskPacket {
  systemId: SystemId;
  realizationId: string;
  evolutionId: NodeId;
  title: string;
  target: "app" | "genome";
  intent: string;
  /**
   * Fork to clone; never carries the git token. `secret` (the realization secret) is present only in the StartWork
   * response's copy, never in the stored packet or GET packet.
   */
  workspace: { repo: string; fork: string; baseCommit: CommitHash; remote: string; secret?: string };
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
  /**
   * Realization secret (64 hex chars), returned once. Send it as `Authorization: Bearer <secret>` on the realization's
   * checkpoint, submit, sync, status and packet routes. The platform keeps only its SHA-256.
   */
  secret: string;
  /** Fork remote URL (same as `token.remote`). */
  remote: string;
  /** Ready to paste: `ARTYFACT_TOKEN=<token> ARTYFACT_SECRET=<secret> npx artyfact start <rid> --system <sid> --evolution <eid> --dir <dir>`. */
  startCommand: string;
  /** Same line as `startCommand` (the integrator's name for it). The only other place the token and secret appear. */
  cli: string;
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
  /** When the stored conflicts were last computed (at submit/promote); null if never. */
  conflictsComputedAt?: string | null;
  /** Set when the last conflict run for this candidate failed. */
  conflictsError?: string;
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

/**
 * `POST /api/systems/:id/candidates/:cid/evaluate` (admin): re-runs the candidate's submission hooks with its current
 * preview URL and passed build; the evaluations replace the earlier ones. 409 for promoted or rejected candidates.
 */
export interface EvaluateCandidateResponse {
  realization: Realization;
  candidate: Candidate;
  evaluations: Evaluation[];
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
  /** Model node ids that collide (newer backend shape). */
  nodes?: string[];
  /** File paths that collide (newer backend shape). */
  paths?: string[];
}

/** One criterion of a candidate's promotion gate, as the Worker computes it and the DO enforces it (worker/promotion.ts). */
export interface GateCriterion {
  id: string;
  severity: "hard" | "soft" | "advisory";
  /** Must be pass+completed for this candidate. Non-blocking ones are advisories that need a rationale when not green. */
  blocking: boolean;
  /** Deferred acceptance criterion: known to the gate, neither blocking nor advisory. */
  deferred?: true;
  /**
   * Hooks of this criterion whose `triggers` include none of submission, candidate or promotion (deployment, outcome
   * or selection stage). Their `not-run` rows cannot exist before promotion and are disregarded; nothing else is.
   */
  offTriggerHooks?: string[];
}

/** `GET /api/systems/:id/evolutions/:eid/candidates`. */
export interface CandidatesResponse {
  evolution: NodeId;
  candidates: Candidate[];
  evaluations: Evaluation[];
  conflicts: ConflictReport[];
  conflictsComputedAt?: string | null;
  /** Candidate id → its promotion gate from the canonical Genome (the set the server enforces). Absent when it cannot be computed. */
  gates?: Record<string, GateCriterion[]>;
  /** Why `gates` is absent (the Genome does not load, the Evolution is unknown); promotion would be refused `gate-unavailable`. */
  gatesError?: string;
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
 * 409 `blocked`: a blocking criterion lacks pass+completed. 400 `advisories-unacknowledged`:
 * no blocking items, but advisories exist and the rationale is empty (a request the caller fixes by adding one).
 * `criteria` lists the blocking items. Legacy promote and accept and plan promote answer alike.
 */
export interface PromoteBlockedResponse extends ApiError {
  error: { code: "blocked" | "advisories-unacknowledged"; message: string; details: { criteria: GateItem[]; advisories: GateItem[] } };
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
  /** That candidate's commit; accept names both. */
  commit?: CommitHash;
  /** Every System One signal from the hooks (reviewDelta, topology, purposeMeasures); `review` is the reviewDelta subset. */
  signals?: unknown[];
  /** Commitments the review asked about (statement text for `contradicts.<id>`); optional. */
  commitments?: Commitment[];
  /** Set when the candidate Genome does not load; `delta` is then empty because nothing could be diffed, not because nothing changed. */
  loadError?: string;
}

/** `POST /api/systems/:id/evolutions/:eid/accept` (admin) for genome-amendment realizations. */
export interface AcceptRequest {
  /** Canonical names; the backend also accepts `realization` / `rationale` as aliases. */
  realizationId: string;
  /**
   * The candidate the admin reviewed and its commit (from the review). The server refuses 409 `stale-candidate` unless
   * it is still the realization's latest candidate at that commit, so a later submit is never accepted unseen.
   */
  candidateId: string;
  commit: CommitHash;
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

/**
 * `POST /api/systems/import` (admin). Re-importing a System from different repos/commits is 409 `already-imported` unless `force`.
 * `genomeRepo`/`appRepo` default to `<slug>.genome` / `<slug>.app` (see `artyfact/naming`).
 */
export interface ImportSystemRequest {
  systemId: SystemId;
  genomeRepo?: string;
  appRepo?: string;
  /** Recorded on the app's artifact binding when the app repo was seeded from a template scaffold. */
  scaffoldFrom?: ScaffoldSource;
  force?: boolean;
  /**
   * Default true: an import that writes a new System commit leaves a {@link SystemImportReview} pending, and work is
   * refused 409 `import-unreviewed` until it is accepted. `false` skips (and clears a pending) review: CLI
   * `--no-review`, fake seeds, bootstrap from an accepted ontology package.
   */
  review?: boolean;
  /** Existing reviewed preview; the server reloads the remote files and requires an exact snapshot match. */
  integrityRunId?: string;
  /** Explicit legacy bypass for intent-authored imports that cannot yet run a real provider; always leaves review pending. */
  integrityUnreviewedReason?: string;
}
export interface ImportSystemResponse {
  integrity?: import("./integrity").IntegrityCurrentSummary;
  system: SystemSummary;
  head: string;
  genomeRepo: string;
  appRepo: string;
  genomeCommit: CommitHash;
  appCommit: CommitHash | null;
  /** Evolutions seeded from the Genome's `evolutions/*.yaml`. */
  evolutions: NodeId[];
  platform: PlatformRef | null;
  /** Non-blocking import findings: `platform.unsynced`, `platform.pin-missing`. */
  warnings: Finding[];
}

export interface EvaluationsResponse {
  evaluations: Evaluation[];
}
/** Stored conflicts among open candidates, computed at submit and promote (never on read). */
export interface ConflictsResponse {
  conflicts: ConflictReport[];
  computedAt: string | null;
  /** Candidates whose last conflict run failed. */
  errors: { candidate: string; error: string }[];
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
  | { type: "build.updated"; build: Build }
  | { type: "deployment.updated"; deployment: Deployment }
  | { type: "phenome.ingested"; count: number; deploymentId?: string; commit: CommitHash }
  | { type: "system.updated"; system: SystemSummary }
  | { type: "evolution.created"; evolution: Evolution }
  /** The System import review was stored, accepted or (`status: null`) cleared. */
  | { type: "system.import-review"; status: SystemImportReviewStatus | null }
  | { type: "ping" };

export type SseEventType = SseEvent["type"];

/**
 * Every SSE `data:` line is one JSON envelope: the event plus its emission time. Events emitted while no client is
 * connected are dropped and there is no `id:`/replay, so clients refetch the state they show on connect and on every reconnect.
 */
export type SseEnvelope = SseEvent & { at: string };

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: "ok";
  service: "artyfact-platform";
  time: string;
}

// ---------------------------------------------------------------------------
// Iteration 2: refs, files, compare, changelog
// ---------------------------------------------------------------------------

/**
 * A revision the compare, file and changelog routes accept: `head`, a System commit id (`sc-N…`), a candidate id,
 * a 40-hex commit of the scoped repo, or a realization id (= its fork head).
 */
export type RefString = string;

/** Which repo a file route reads: the app (Artifacts app repo or a fork) or the Genome. */
export type FileScope = "app" | "genome";

/** A {@link RefString} resolved to a concrete repo and commit. */
export interface ResolvedRef {
  ref: RefString;
  repo: string;
  commit: CommitHash;
  /** The System commit the ref names or binds, when there is one. */
  systemCommit?: string;
  /** The candidate the ref names, when it is one. */
  candidate?: string;
}

/** One entry of the revision picker. */
export interface RevisionOption {
  id: RefString;
  kind: "head" | "commit" | "candidate";
  label: string;
  at?: string;
  evolution?: NodeId;
  /** Candidate state, for `candidate` options. */
  state?: string;
}
/** `GET /api/systems/:id/revisions`. */
export interface RevisionsResponse {
  revisions: RevisionOption[];
}

/** `GET /api/systems/:id/files?scope=&ref=`. */
export interface FilesResponse {
  ref: ResolvedRef;
  /** Genome scope: `nodes` are the ids the loaded model declares in each path (absent when the Genome does not load). */
  files: { path: string; hash: string; size?: number; nodes?: NodeId[] }[];
}
/** `GET /api/systems/:id/file?scope=&ref=&path=`. `text` is null for binary files. */
export interface FileResponse {
  ref: ResolvedRef;
  path: string;
  hash: string;
  text: string | null;
  size: number;
  truncated: boolean;
  binary: boolean;
  /** Model nodes the path maps to: the source map (app) or the ids the loaded model declares in it (Genome; absent when it does not load). */
  nodes?: NodeId[];
}

export interface ChangedFiles {
  added: string[];
  modified: string[];
  removed: string[];
}

/** `GET /api/systems/:id/compare/system?from=&to=`: two System commits side by side. */
export interface SystemCompare {
  from: SystemCommit | null;
  to: SystemCommit;
  /**
   * Genome commits on each side, their semantic delta and the Genome repo's changed files (`pathNodes`: the delta's
   * nodes declared in each path). Null delta and files with `loadError` when a side does not load.
   */
  genome: {
    from: CommitHash | null; to: CommitHash; delta: ModelDelta | null; files: ChangedFiles | null; pathNodes: Record<string, NodeId[]>; loadError?: string;
    /** Sides whose Genome is in the retired v1 layout: never loaded, so `delta` is null; the UI shows the legacy notice. */
    legacyFormat?: ("from" | "to")[];
  };
  /**
   * The app binding's change; null when neither side binds an app. `files` include the pinned model copy under
   * `system/` (`splitPinnedModel` in `shared/model-path.ts` separates it); `pinnedGenome` is the Genome commit that copy
   * equals at `to`, when the platform can tell.
   */
  app: { from: ResolvedRef | null; to: ResolvedRef; files: ChangedFiles; pathNodes: Record<string, NodeId[]>; pinnedGenome?: CommitHash } | null;
  manifest: { templateVersions: string[]; hookVersions: string[]; platformChanged: boolean };
  identical: boolean;
}

/** `GET /api/systems/:id/compare/genome?from=&to=`. */
export interface GenomeCompare {
  from: ResolvedRef | null;
  to: ResolvedRef;
  delta: ModelDelta | null;
  loadError?: string;
  /** As in {@link SystemCompare}: sides in the retired v1 layout, with `delta` null. */
  legacyFormat?: ("from" | "to")[];
  files: ChangedFiles;
}

/** One side of a {@link FileCompare}; `hash`/`text` are null when the path is absent on that side. */
export type FileSide = ResolvedRef & { hash: string | null; text: string | null; size: number };

/** `GET /api/systems/:id/compare/file?scope=&from=&to=&path=`. */
export interface FileCompare {
  path: string;
  from: FileSide;
  to: FileSide;
  truncated: boolean;
  binary: boolean;
}

/** One System commit in the changelog list. */
export interface ChangelogRow {
  id: string;
  parent: string | null;
  at: string;
  by: string;
  policy: string;
  rationale: string;
  /** The rationale is still being written (async summary). */
  rationalePending?: boolean;
  kind: "import" | "promotion" | "acceptance";
  evolutions: { id: NodeId; title: string }[];
  candidates: { id: string; realization: string; commit: CommitHash; repo: string; agent: string }[];
  genomeCommit: CommitHash;
  /** The Genome at this commit is in the retired v1 layout; `summary` counts files only and the UI shows the legacy notice. */
  legacyFormat?: true;
  summary: { nodesAdded: number; nodesChanged: number; nodesRemoved: number; filesChanged: number; criteriaAffected: number };
  manifestHash: Sha256 | null;
  platform: PlatformRef | null;
  builds: BuildSummary[];
  deployment: Deployment | null;
  /** Some gating evidence came from the fake System One provider. */
  fakeProvider?: boolean;
  /** The row's comparison could not be computed (summary counts are zero); it is retried on the next read. */
  loadError?: string;
}
/** `GET /api/systems/:id/changelog?limit=&before=`. */
export interface ChangelogResponse {
  rows: ChangelogRow[];
  /** Pass as `before` for the next page; absent on the last page. */
  nextBefore?: string;
}

/** `GET /api/systems/:id/changelog/:commitId`: a System commit against its parent, with criteria and code links. */
export interface ChangelogEntry extends SystemCompare {
  row: ChangelogRow;
  decision: SystemCommit["decision"];
  criteria: { id: NodeId; before: Verdict | "not-run"; after: Verdict | "not-run"; evaluation?: string }[];
  /** Changed files of the app and the Genome (`scope`), app first, each sorted by path. */
  codeLinks: { scope: FileScope; path: string; repo: string; commit: CommitHash; nodes: NodeId[]; status: "added" | "modified" | "removed" }[];
}

// ---------------------------------------------------------------------------
// Iteration 2: editor
// ---------------------------------------------------------------------------

/** `POST /api/systems/:id/realizations/:rid/commit`: write files to the realization's fork and submit the result. */
export interface EditorCommitRequest {
  message: string;
  /** Why the change was made; recorded on the candidate. */
  why?: string;
  /** `content: null` deletes the path. */
  changes: { path: string; content: string | null }[];
  /** Fork head the editor saw; mismatch is 409. */
  expectedHead?: CommitHash;
  author?: string;
}
export interface EditorCommitResponse {
  commit: CommitHash;
  parent: CommitHash;
  tree: string;
  submitted: SubmitResponse;
  build?: BuildSummary;
}

// ---------------------------------------------------------------------------
// Iteration 2: builds and deployments
// ---------------------------------------------------------------------------

export type BuildStatus = "queued" | "running" | "passed" | "failed" | "error";
export type BuildKind = "preview" | "production";
export type BuildReporter = "ci" | "agent" | "admin";

export interface BuildStep {
  name: string;
  status: BuildStatus;
  durationMs?: number;
  logsUrl?: string;
}

/** What CI, an agent or an admin reports about a build. Without `id` a new build row is created. */
export interface BuildReport {
  output?: RealizedArtifactReport;
  id?: string;
  status: BuildStatus;
  kind?: BuildKind;
  commit: CommitHash;
  url?: string;
  /** Runtime build identifier, separate from source revision and realized output identity. */
  buildId?: string;
  logsUrl?: string;
  /** Workflow instance id. */
  externalId?: string;
  deploymentId?: string;
  steps?: BuildStep[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Build extends Omit<BuildReport, "id" | "kind" | "output"> {
  source?: { repo: string; commit: CommitHash };
  genomeCommit?: CommitHash;
  thingId?: string;
  artifactId?: string;
  output?: RealizedArtifact;
  id: string;
  kind: BuildKind;
  realization: string | null;
  candidate: string | null;
  reporter: BuildReporter;
  createdAt: string;
  updatedAt: string;
}

export type BuildSummary = Pick<Build, "id" | "status" | "kind" | "commit" | "url" | "buildId" | "finishedAt">;

/** `POST …/realizations/:rid/builds` and `POST /api/systems/:id/builds`. */
export interface BuildReportResponse {
  build: Build;
  candidate?: Candidate;
  evaluations?: Evaluation[];
}
/** `GET …/realizations/:rid/builds` and `GET /api/systems/:id/builds?commit=&kind=`. */
export interface BuildsResponse {
  builds: Build[];
}

export type DeploymentStatus = "pending" | "live" | "superseded" | "failed";

export interface Deployment {
  /** Absent for historic or unreported output identity. */
  output?: string;
  id: string;
  kind: BuildKind;
  status: DeploymentStatus;
  repo: string;
  commit: CommitHash;
  artifactId?: string;
  systemCommit?: string;
  realization?: string;
  candidate?: string;
  /** Build row id. */
  build?: string;
  url?: string;
  buildId?: string;
  by: string;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/systems/:id/deployments`. */
export interface DeploymentsResponse {
  production: Deployment | null;
  /** Newest first. */
  history: Deployment[];
}
/** `POST /api/systems/:id/deployments` (admin). Defaults: production of the head's app commit. */
export interface DeploymentRequest {
  /** Required to disambiguate a production deployment when the System has multiple source bindings. */
  artifactId?: string;
  /** Reuse an existing realized output; its stored source must match the deployment scope. */
  outputId?: string;
  kind?: BuildKind;
  commit?: CommitHash;
  realization?: string;
  /** Where the deployment is served (http or https). */
  url?: string;
}
/** The ingest token appears only in the create response and in {@link IngestTokenResponse}; the platform keeps its hash. */
export type DeploymentCreated = Deployment & { ingestToken?: string };
/** `POST /api/systems/:id/deployments/:did/ingest-token` (admin). */
export interface IngestTokenResponse {
  deployment: Deployment;
  ingestToken: string;
}

/** Parameters the platform passes to the `artyfact-ci` Workflow (`env.CI.create({ params })`). */
export interface CiBuildParams {
  thingId?: string;
  artifactId?: string;
  genomeCommit?: CommitHash;
  buildId: string;
  systemId: SystemId;
  realizationId: string | null;
  candidateId: string | null;
  namespace: string;
  repo: string;
  commit: CommitHash;
  kind: BuildKind;
  workerName: string;
  vars: Record<string, string>;
  commands: { install: string; test?: string; build?: string; deploy: string };
  /** Where the Workflow posts {@link BuildReport}s. */
  reportUrl: string;
  deploymentId?: string;
}

// ---------------------------------------------------------------------------
// Iteration 2: Phenome (events the deployed app emits)
// ---------------------------------------------------------------------------

/** A stored Phenome event. */
export interface PhenomeEvent extends PhenomeEventHeader {
  outputId?: string;
  genomeCommit?: CommitHash;
  seq: number;
  receivedAt: string;
  realization?: string;
}

/** `POST /api/systems/:id/phenome/events` (ingest token). At most 100 events, 8 KB each. */
export interface PhenomeIngestRequest {
  events: PhenomeEventHeader[];
}
export interface PhenomeIngestResponse {
  accepted: number;
  dropped: { index: number; reason: string }[];
}

export interface PhenomeEventsQuery {
  thing?: string;
  /** Exact runtime buildId, not the platform build row ID. */
  build?: string;
  output?: string;
  deployment?: string;
  commit?: CommitHash;
  kind?: string;
  realization?: string;
  limit?: number;
  /** A `seq`: events strictly older. */
  before?: number;
}

/** `GET /api/systems/:id/phenome/events?…`: newest first, plus per-version counts. */
export interface PhenomeEventsResponse {
  events: PhenomeEvent[];
  nextBefore?: number;
  versions: { output: string | null; genomeCommit: string | null; key: string; buildId: string; commit: CommitHash; deployment: string | null; systemCommit: string | null; count: number }[];
}

// Immutable reusable package catalog. System-scoped packages are never listed on the public home.
export type PartScope = { kind: "shared" } | { kind: "system"; systemId: string };
export interface PartRecord { package: schema.PartPackage; scope: PartScope; digest: string; publishedAt: string }
export interface PartSummary { partId: string; version: string; name?: string; description?: string; scope: PartScope; digest: string; publishedAt: string; dependencies: schema.PartRef[] }
export interface PartsResponse { parts: PartSummary[] }
export interface PartResponse { part: PartRecord }
export interface PublishPartRequest { package: schema.PartPackage }

/** One specific output, independent of the source binding and of its deployments. */
export interface RealizedArtifact { id: string; thingId: string; artifactId: string; source: { repo: string; commit: CommitHash }; genomeCommit: CommitHash; build: string; locator?: string; digest?: string; createdAt: string }
export interface RealizedArtifactReport { locator?: string; digest?: string }
export interface RealizedArtifactsResponse { artifacts: RealizedArtifact[] }

// ---------------------------------------------------------------------------
// App template upgrades
// ---------------------------------------------------------------------------

/** `.artyfact/template.json` in an app repo: what the template scaffold shipped, as git blob ids per path. */
export interface TemplateLock {
  /** `thing/<name>@<version>`: the template's directory under `templates/` in the `platform` repo. */
  template: string;
  /** Commit of the scaffold source (the `platform` repo, or the repo `scaffold.yaml` names) the files came from. */
  scaffoldCommit: CommitHash;
  files: Record<string, string>;
}

/**
 * What an upgrade does to one path. `add`: new in the template. `update`: untouched since the lock and changed in the
 * template. `remove`: dropped by the template and untouched since the lock. `conflict`: the app changed it (or there is
 * no lock to tell) and the template changed it too; applied only when listed in `include` (the template version wins).
 */
export type TemplateUpgradeAction = "add" | "update" | "conflict" | "remove";

export interface TemplateUpgradeFile {
  path: string;
  action: TemplateUpgradeAction;
  reason: string;
}

/** `GET /api/systems/:id/template-upgrade?ref=head` for a Thing template that ships no `scaffold.yaml`: nothing to upgrade from. */
export interface TemplateUpgradeNoScaffold {
  status: "no-scaffold";
  template: string;
}

/** `GET /api/systems/:id/template-upgrade?ref=head` (200; {@link TemplateUpgradeNoScaffold} when the template has no scaffold). */
export interface TemplateUpgradePlan {
  template: string;
  /** The lock's `scaffoldCommit`; null when the app repo has no lock. */
  from: CommitHash | null;
  /** The current scaffold source commit. */
  to: CommitHash;
  /** No file to apply and the lock already records the current template files. */
  upToDate: boolean;
  files: TemplateUpgradeFile[];
  /** The app revision the plan was computed against. */
  app: { repo: string; commit: CommitHash };
  /** Whether the app repo has a readable `.artyfact/template.json`. */
  locked: boolean;
}

/** `POST /api/systems/:id/template-upgrade` (admin). `include`: conflict paths to overwrite with the template version. */
export interface TemplateUpgradeRequest {
  include?: string[];
}

/** 201: an ordinary app candidate (gates, CI preview) on a new Evolution. */
export interface TemplateUpgradeResponse {
  /** Present only in historical responses. New upgrades are accepted-Genome implementation tasks. */
  evolution?: Evolution;
  realizationPlan: import('./lifecycle').RealizationPlan;
  task: import('./lifecycle').Task;
  realization: Realization;
  candidate: Candidate;
  plan: TemplateUpgradePlan;
}

// ---------------------------------------------------------------------------
// Iteration 3: intents (describe a change → proposed node updates). Spec: docs/design/ontology.md, "Intents".
// ---------------------------------------------------------------------------

/** `POST /api/systems/:id/intents` (admin). `anchor`: the node the user started from (Inspector, Code). */
export interface IntentRequest {
  message: string;
  anchor?: NodeId;
}

/** `open` until accepted (a commit was made) or abandoned; replies keep it `open`. */
export type ProposalStatus = "open" | "accepted" | "abandoned";

/** One routing step: the level asked (`shortlist`, `intent`, `space`, `kind`, `node`, …), the option chosen, its confidence. */
export interface ProposalRouteStep {
  level: string;
  /** `unclear` when the step got no usable answer. */
  choice: string;
  /** 0 when the step got no usable answer. */
  confidence: number;
}

export type ProposedOpKind = "add" | "update" | "remove" | "link" | "unlink";

/**
 * One node update the user accepts or rejects on its own. `node`: the target (for `link`/`unlink` the `from` end;
 * for `add` the id the platform minted for the new node, so later ops can name it). `add` carries `kind`, `parent`
 * and the new node's `fields` (and `criteria`); `update` the changed `fields` (`null` removes a field) and criteria
 * upserted by id or removed. An engine `add` with links becomes the `add` plus one `link` op per link, each listing
 * the `add` in `dependsOn`; accepting an op without the ops it depends on is a 422.
 */
export interface ProposedOp {
  id: string;
  op: ProposedOpKind;
  node: NodeId;
  kind?: string;
  parent?: NodeId;
  fields?: Record<string, unknown>;
  link?: { rel: string; to: NodeId; certainty?: LinkCertainty };
  criteria?: (NodeCriterion | { id: string; remove: true })[];
  /** `update`: the node's `files` globs (relative to the nearest `root`); a list replaces them, `null` removes them. */
  files?: string[] | null;
  dependsOn?: string[];
}

/** A question back to the user; answer it with {@link IntentReply}. */
export interface ProposalQuestion {
  id: string;
  text: string;
}

/**
 * A deterministic problem with the proposal (engine `validateOps`, codec, or a finding the ops introduce):
 * `opId` absent means the whole proposal. Finding levels map error → error, missing → missing, warning → warning;
 * `review`, `info` and `pass` findings are not problems.
 */
export interface ProposalProblem {
  opId?: string;
  severity: "error" | "missing" | "warning";
  message: string;
}

/** Who decided: the router's and translator's providers and models, and the Genome commit the proposal was computed on. */
export interface ProposalProvenance {
  /** System One for routing: `typesafe`, `openrouter`, `fake` or `off`. */
  router: { provider: string; model: string; calls: number };
  /** The translator: `openrouter`, `fake` or `off`. */
  translator: { provider: string; model: string };
  /** Head Genome commit at proposal time; accepting against a moved head is a 409 `stale-base`. */
  genomeCommit: CommitHash;
  /** True when either side was a fake provider; the UI labels the proposal. */
  fake: boolean;
}

export interface ProposalAttempt {
  stagedApproval: NonNullable<Proposal["stagedApproval"]>;
  disposition: "revised" | "abandoned";
  reason: string;
  endedAt: string;
  acceptError?: string;
}

/** `GET /api/systems/:id/intents/:pid`; also the body of the create and reply responses. */
export interface Proposal {
  /** Durable Genome Evolution linked before human approval; absent on legacy proposals. */
  evolutionId?: string;
  stagedApproval?: {evolutionId:string;realizationId:string;candidateId:string;commit:string;opIds:string[];
    /** The plan decisions the candidate was staged under; absent for candidates staged before plans. */
    decisions?: ProposalDecisions;
    integrity?: import("./integrity").IntegrityReviewBinding};
  attempts?: ProposalAttempt[];
  id: string;
  systemId: SystemId;
  message: string;
  anchor?: NodeId;
  status: ProposalStatus;
  route: ProposalRouteStep[];
  ops: ProposedOp[];
  questions: ProposalQuestion[];
  problems: ProposalProblem[];
  /** The translator's reply when the message only asked for information (no ops). */
  answer?: string;
  provenance: ProposalProvenance;
  /**
   * The agreement tree: the ops grouped under the nodes they touch, rooted at Things (or the System root), each node
   * carrying the admin's explicit decision. `[]` for proposals stored before plans existed.
   */
  plan: ProposalPlanNode[];
  /** The proposal whose deferred ops this one holds. */
  deferredFrom?: string;
  createdAt: string;
}

/** An admin's decision on one agreement-tree node; it applies to the node's subtree unless a descendant decides otherwise. */
export type ProposalDecision = "agree" | "reject" | "defer";

/** Node id → explicit decision, as stored (`decisions_json`). Inheritance is the Worker's (worker/intents.ts). */
export type ProposalDecisions = Record<NodeId, ProposalDecision>;

/**
 * One node of an agreement tree ({@link Proposal.plan}, {@link SystemImportReview.tree}). `path` is the ancestor chain
 * from the System root down to and including this node (the System root's path is `[root]`; the trailing "Other
 * changes" node, for ops on unknown nodes, has `[]`). `summary` counts the subtree's ops (or, in an import review,
 * describes the node). `opIds` are the ops on this node itself; intermediate ancestors carry none.
 */
export interface ProposalPlanNode {
  id: NodeId;
  kind: string;
  title: string;
  path: NodeId[];
  summary: string;
  opIds: string[];
  children: ProposalPlanNode[];
  decision?: ProposalDecision;
}

/** `POST /api/systems/:id/intents/:pid/reply` (admin). `questionId`: the question answered; absent, a free follow-up. */
export interface IntentReply {
  answer: string;
  questionId?: string;
}

/** `POST /api/systems/:id/intents/:pid/accept` (admin): the ops to apply; the rest are rejected. */
export interface IntentAccept {
  opIds: string[];
  integrity?: { runId: string };
}
export interface IntentReviseRequest { candidateId: string; commit: CommitHash; answer: string; questionId?: string }
export interface IntentAbandonRequest { candidateId: string; commit: CommitHash; reason: string }

/**
 * 201: the accepted ops written to the Genome through a Genome realization (`origin: editor`), its commit and the
 * candidate the gates evaluate; the Evolution's `affectedNodes` are the touched nodes.
 */
export interface IntentAcceptResponse {
  systemCommit?: SystemCommit;
  evolution: Evolution;
  realization: Realization;
  candidate: Candidate;
  commit: CommitHash;
  /** The new open proposal holding the ops of `defer` nodes, and the topmost deferred nodes that held ops. */
  deferred?: { proposal: string; nodeIds: NodeId[] };
  /** Op ids neither accepted nor deferred (rejected, undecided, or left out), when there were any. */
  dropped?: string[];
  /** Why the deferred proposal could not be created; the accept itself succeeded. */
  deferralError?: string;
}

/**
 * `PUT /api/systems/:id/intents/:pid/decisions` (admin) → {@link Proposal}. A decision on a node clears its
 * descendants' explicit decisions; `null` clears the node's own.
 */
export interface IntentDecisionsRequest {
  decisions: { nodeId: NodeId; decision: ProposalDecision | null }[];
}

// ---------------------------------------------------------------------------
// System import review (backend.md B.10)
// ---------------------------------------------------------------------------

export type SystemImportReviewStatus = "pending" | "accepted";

/** `GET /api/systems/:id/import-review`: the imported Genome as an agreement tree (every node added). */
export interface SystemImportReview {
  status: SystemImportReviewStatus;
  /** The Genome commit the review describes (the imported one, not necessarily the current head). */
  genomeCommit: CommitHash;
  tree: ProposalPlanNode[];
  findings: Finding[];
  /** App paths no node's `files` maps: the first 200, sorted. */
  unmapped: string[];
  /** How many app paths are unmapped in all, when the review stored a capped list. */
  unmappedTotal?: number;
  decidedAt?: string;
  interpretation?: string;
  rejectedNodes?: NodeId[];
  integrity?: import("./integrity").IntegrityReviewBinding;
  integrityUnreviewed?: { reason: string; at: string };
}

/** `POST /api/systems/:id/import-review/accept` (admin). Rejected nodes are removed by an accepted Genome amendment. */
export interface SystemImportReviewAccept {
  interpretation?: string;
  rejectedNodes?: NodeId[];
}

export interface SystemImportReviewAcceptResponse {
  review: SystemImportReview;
  /** The accepted amendment that removed `rejectedNodes`, when there were any. */
  amendment?: { evolution: string; realization: string; candidate: string; systemCommit?: string };
  /** Live Evolutions whose acceptance criteria the removal deletes (their gates fail closed). */
  warnings?: string[];
}

export type { RealizationPlan, Task, TaskAttempt, CreateRealizationPlanRequest, TaskStartResponse, TaskSubmitResponse, ImplementationReview, PlanPromoteRequest, PlanPromoteResponse, DraftRealizationPlanRequest, DraftRealizationPlanResponse, DraftPlanProblem, DraftPlanProvenance, LifecycleTaskPacket } from './lifecycle';
