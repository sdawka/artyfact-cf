import { z } from "zod";

// File-level shapes of the Genome. Cross-file references are checked by Rule Packs, not here.

const id = (p: string) => z.string().regex(new RegExp(`^${p.replace(".", "\\.")}[\\w.-]+$`));
export const Id = {
  system: id("system."),
  thing: id("thing."),
  ext: id("ext."),
  gd: id("GD."),
  claim: id("T"),
  req: id("S."),
  crit: id("C."),
  journey: id("J."),
  evolution: id("evolution."),
  realization: id("realization."),
  artifact: id("artifact."),
  template: id("template."),
  /** A pinned template reference, `template.<kind>.<name>@<version>`; also what the loader stamps into `fromTemplate`. */
  templateRef: z.string().regex(/^template\.[\w.-]+@[\w.-]+$/),
};
export const AnyId = z.string().min(1);
const str = z.string();
const strs = z.array(z.string()).default([]);

export const Source = z.object({ doc: str, section: str.optional(), quote: str.optional() });
export type Source = z.infer<typeof Source>;

export const Certainty = z.enum(["declared", "assumed", "hypothesis", "proposed", "observed", "derived"]);
export type Certainty = z.infer<typeof Certainty>;

export const Relation = z.enum([
  "contains", "serves", "invokes", "governs", "reads", "writes", "storedIn", "refines", "realizes",
  "dependsOn", "satisfies", "measures", "affects", "inherits", "triggers", "references",
]);
export type Relation = z.infer<typeof Relation>;

export const CrossLink = z.object({
  rel: Relation,
  to: AnyId,
  direction: z.enum(["out", "in"]).default("out"),
  certainty: Certainty.default("declared"),
  label: str.optional(),
  source: Source.optional(),
});
export type CrossLink = z.infer<typeof CrossLink>;

export const NodeKind = z.enum([
  "system", "thing", "section", "screen", "component", "affordance", "route", "entity", "field", "operation",
  "policy", "binding", "grouping", "external", "purpose", "claim", "requirement",
]);
export type NodeKind = z.infer<typeof NodeKind>;

export const Field = z.object({ name: str, type: str, optional: z.boolean().default(false) });
export type Field = z.infer<typeof Field>;

export const OntologyNode = z.object({
  id: AnyId,
  kind: NodeKind,
  name: str,
  parent: AnyId.optional(),
  owningThing: AnyId.optional(),
  revision: z.number().int().default(1),
  description: str.optional(),
  source: Source.optional(),
  refines: z.array(AnyId).default([]),
  links: z.array(CrossLink).default([]),
  route: str.optional(),
  cardinality: str.optional(),
  states: strs,
  roles: strs,
  actor: str.optional(),
  trigger: str.optional(),
  preconditions: strs,
  effects: strs,
  failure: strs,
  fields: z.array(Field).default([]),
  invariants: strs,
  provisional: z.boolean().default(false),
  fromTemplate: Id.templateRef.optional(),
});
export type OntologyNode = z.infer<typeof OntologyNode>;

/** File form of an ontology node: may nest `children` (flattened by the loader, which sets `parent`). */
export type OntologyNodeInput = z.input<typeof OntologyNode> & { children?: OntologyNodeInput[] };
export const OntologyNodeInput: z.ZodType<z.infer<typeof OntologyNode> & { children?: unknown[] }, OntologyNodeInput> =
  OntologyNode.extend({ children: z.lazy(() => z.array(OntologyNodeInput)).optional() });

export const ExternalKind = z.enum(["person", "group", "context", "service", "device", "event", "organization", "resource"]);
export const Externals = z.object({
  id: Id.ext,
  kind: ExternalKind,
  name: str,
  /** What we model about it. */
  modeled: str,
  /** What remains outside our control. */
  external: str,
  links: z.array(CrossLink).default([]),
  source: Source.optional(),
});
export type Externals = z.infer<typeof Externals>;

export const Purpose = z.object({
  id: z.string().regex(/^P\d+$/),
  statement: str,
  beneficiaries: z.array(Id.ext),
  intendedChange: str,
  successCriteria: z.array(str),
  nonGoals: strs,
  constraints: strs,
  source: Source.optional(),
});
export type Purpose = z.infer<typeof Purpose>;

export const TheoryClaim = z.object({
  id: Id.claim,
  name: str,
  purpose: str,
  mechanism: str,
  beneficiaries: z.array(Id.ext),
  activities: z.array(AnyId).default([]),
  outcome: str,
  indicator: str,
  evaluationMethod: str,
  limitation: str,
  kind: z.enum(["hypothesis", "invariant"]).default("hypothesis"),
  status: z.enum(["unknown", "supported", "challenged", "inconclusive"]).default("unknown"),
  deferred: z.boolean().default(false),
});
export type TheoryClaim = z.infer<typeof TheoryClaim>;

export const GDFeature = z.object({
  id: Id.gd,
  name: str,
  summary: str,
  deferred: z.boolean().default(false),
  source: Source.optional(),
});
export type GDFeature = z.infer<typeof GDFeature>;

export const Commitment = z.object({
  id: AnyId,
  statement: str,
  features: z.array(Id.gd),
  coupledWith: strs,
  source: Source.optional(),
});
export type Commitment = z.infer<typeof Commitment>;

export const Description = z.object({
  narrative: str,
  features: z.array(GDFeature),
  commitments: z.array(Commitment),
  alternatives: strs,
  openQuestions: strs,
});
export type Description = z.infer<typeof Description>;

export const Requirement = z.object({
  id: Id.req,
  thing: Id.thing,
  title: str,
  text: str,
  refines: z.array(Id.gd).default([]),
  subjects: z.array(AnyId).default([]),
  enabled: z.boolean().default(true),
  source: Source.optional(),
});
export type Requirement = z.infer<typeof Requirement>;

export const ArtifactType = z.enum(["worker-fullstack", "model-kit", "document", "external"]);
export const ArtifactBinding = z.object({
  artifact: Id.artifact,
  type: ArtifactType,
  repo: str.optional(),
  commit: str.optional(),
  scope: z.array(AnyId).default([]),
});
export type ArtifactBinding = z.infer<typeof ArtifactBinding>;

export const Thing = z.object({
  id: Id.thing,
  name: str,
  templateRef: str.nullable(),
  description: str,
  artifacts: z.array(ArtifactBinding),
  sections: z.array(AnyId),
  purposeRefs: strs,
});
export type Thing = z.infer<typeof Thing>;

export const Gate = z.enum(["submission", "candidate", "selection", "promotion", "deployment", "outcome"]);
export type Gate = z.infer<typeof Gate>;
export const TargetKind = z.enum(["model", "artifact", "runtime", "observation"]);
export type TargetKind = z.infer<typeof TargetKind>;

export const Criterion = z.object({
  id: Id.crit,
  version: z.number().int().default(1),
  title: str,
  claim: str,
  ownerKind: z.enum(["system", "thing"]),
  ownerId: AnyId,
  subjectKind: NodeKind,
  subjectId: AnyId,
  targetKind: TargetKind,
  sourceRefs: strs,
  refines: z.array(Id.crit).default([]),
  satisfies: z.array(Id.crit).default([]),
  severity: z.enum(["hard", "soft", "advisory"]).default("hard"),
  gates: z.array(Gate),
  applicableWhen: str.optional(),
  deferred: z.boolean().default(false),
  hooks: strs,
  fromTemplate: Id.templateRef.optional(),
});
export type Criterion = z.infer<typeof Criterion>;

export const AssayHook = z.object({
  id: AnyId,
  version: z.number().int().default(1),
  assay: str,
  criteria: z.array(Id.crit),
  tier: z.enum(["basic", "execution", "semantic"]),
  engine: z.enum(["manifest", "diff", "model-rules", "vitest", "browser", "http", "llm"]),
  targetKind: TargetKind,
  triggers: z.array(Gate),
  inputs: z.record(z.string(), z.string()).default({}),
  verdictMapping: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().default(60000),
  costTier: z.enum(["free", "cheap", "expensive"]).default("free"),
  binding: z.enum(["defined", "implementation-missing", "bound"]).default("defined"),
  fromTemplate: Id.templateRef.optional(),
});
export type AssayHook = z.infer<typeof AssayHook>;

export const JourneyStep = z.object({
  id: AnyId,
  actor: z.enum(["user", "system", "external", "counterpart"]),
  action: str,
  screen: AnyId.optional(),
  operation: AnyId.optional(),
  state: str.optional(),
  external: Id.ext.optional(),
  kind: z.enum(["action", "reaction", "wait", "branch", "failure", "end"]).default("action"),
  next: z.array(z.object({ to: AnyId, when: str.optional() })).default([]),
  requirementRefs: z.array(Id.req).default([]),
  unresolved: z.boolean().default(false),
});
export type JourneyStep = z.infer<typeof JourneyStep>;

export const Journey = z.object({
  id: Id.journey,
  name: str,
  actorGoal: str,
  features: z.array(Id.gd),
  requirements: z.array(Id.req),
  start: AnyId,
  steps: z.array(JourneyStep),
  deferred: z.boolean().default(false),
  segments: z.array(z.object({ name: str, steps: z.array(str) })).optional(),
});
export type Journey = z.infer<typeof Journey>;

export const EvolutionState = z.enum([
  "proposed", "genome-approved", "actionable", "realizing", "evaluated", "promoted", "rejected", "withdrawn",
]);
export type EvolutionState = z.infer<typeof EvolutionState>;

export const Evolution = z.object({
  id: Id.evolution,
  title: str,
  intent: str,
  state: EvolutionState,
  baseRevision: str.optional(),
  kind: z.enum(["implementation", "genome-amendment", "mixed"]),
  affectedNodes: z.array(AnyId),
  affectedClaims: z.array(Id.claim).default([]),
  genomeDelta: z.array(z.object({ op: z.enum(["add", "change", "remove"]), path: str, summary: str })).default([]),
  acceptanceCriteria: z.array(Id.crit),
  requiredEvidence: strs,
  dependsOn: z.array(Id.evolution).default([]),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  realizations: z.array(Id.realization).default([]),
  decision: str.optional(),
});
export type Evolution = z.infer<typeof Evolution>;

export const Workspace = z.object({ repo: str, fork: str, baseCommit: str, tokenExpiresAt: str.optional() });
export const AgentRole = z.enum(["implementer", "assay-author", "verifier", "reviewer", "repairer"]);

export const Realization = z.object({
  id: Id.realization,
  evolution: Id.evolution,
  agent: z.object({ id: str, harness: str.optional(), role: AgentRole }),
  target: z.enum(["app", "genome"]),
  workspace: Workspace,
  status: z.enum(["claimed", "working", "submitted", "evaluating", "evaluated", "selected", "promoted", "rejected", "abandoned"]),
  checkpoints: z.array(z.object({ at: str, summary: str, commit: str.optional() })).default([]),
  candidate: str.optional(),
});
export type Realization = z.infer<typeof Realization>;

export const CandidateManifest = z.object({
  id: AnyId,
  realization: Id.realization,
  evolution: Id.evolution,
  system: Id.system,
  baseRevision: str,
  desiredRevision: str,
  artifacts: z.array(ArtifactBinding.extend({ repo: str, commit: str })),
  changedSubjects: z.array(AnyId),
  genomeChanges: strs,
  submittedAt: str,
  hash: str,
});
export type CandidateManifest = z.infer<typeof CandidateManifest>;

export const Verdict = z.enum(["pass", "fail", "unknown", "stale", "waived"]);
export type Verdict = z.infer<typeof Verdict>;
export const Execution = z.enum(["not-run", "queued", "running", "completed", "deferred", "error"]);
export type Execution = z.infer<typeof Execution>;

export const Evaluation = z.object({
  id: AnyId,
  candidate: str,
  hook: str,
  criterion: Id.crit,
  ownerId: AnyId,
  subjectId: AnyId,
  targetRef: str,
  execution: Execution,
  verdict: Verdict,
  verifier: str,
  startedAt: str,
  finishedAt: str.optional(),
  observations: z.array(z.unknown()).default([]),
  interpretation: str.optional(),
  limitations: strs,
  provenance: z.record(z.string(), z.string()).default({}),
});
export type Evaluation = z.infer<typeof Evaluation>;

export const SystemCommit = z.object({
  id: str,
  parent: str.nullable(),
  genomeCommit: str,
  manifest: z.array(ArtifactBinding),
  evolutions: z.array(Id.evolution),
  candidates: z.array(str),
  rejected: strs,
  evidence: z.array(str),
  decision: z.object({ by: str, policy: str, rationale: str, at: str }),
});
export type SystemCommit = z.infer<typeof SystemCommit>;

export const TaskPacket = z.object({
  version: z.literal(1),
  hash: str,
  system: Id.system,
  thing: Id.thing,
  evolution: Id.evolution,
  realization: Id.realization,
  role: AgentRole,
  target: z.enum(["app", "genome"]),
  pinned: z.object({ genomeCommit: str, kits: z.array(str) }),
  intent: str,
  acceptanceCriteria: z.array(Criterion),
  requirements: z.array(Requirement),
  nodes: z.array(OntologyNode),
  journeys: z.array(Journey),
  commitments: z.array(Commitment),
  workspace: Workspace.extend({ token: str }),
  permittedPaths: z.array(str),
  protectedPaths: z.array(str),
  entryFiles: z.array(z.object({ path: str, why: str, certainty: Certainty })),
  commands: z.record(z.string(), z.string()),
  concurrentWork: z.array(str),
  submit: z.object({ branch: str, manifestPath: z.literal(".artyfact/candidate.json"), instructions: str }),
});
export type TaskPacket = z.infer<typeof TaskPacket>;

export const SystemFile = z.object({
  id: Id.system,
  name: str,
  template: str.nullable(),
  profile: str.optional(),
  things: z.array(Id.thing),
  phase: str.default("unrealized"),
  head: str.optional(),
  purposes: z.array(str),
});
export type SystemFile = z.infer<typeof SystemFile>;

export const Template = z.object({
  id: Id.template,
  kind: z.enum(["system", "thing"]),
  version: str,
  name: str,
  description: str.optional(),
  sections: z.array(AnyId).default([]),
  nodes: z.array(OntologyNodeInput).default([]),
  criteria: z.array(Criterion).default([]),
  hooks: z.array(AssayHook).default([]),
  scaffold: z.object({ repo: str.optional(), path: str.optional() }).optional(),
  sourceMapDefaults: z.array(z.object({ glob: str, nodes: z.array(str) })).optional(),
  requires: strs,
});
export type Template = z.infer<typeof Template>;

/** kits.yaml: Kits the System requires; a Kit without `version` is unpinned (readiness finding). */
export const Kit = z.object({ id: AnyId, version: str.optional(), required: z.boolean().default(true) });
export type Kit = z.infer<typeof Kit>;
export const KitsFile = z.object({ kits: z.array(Kit).default([]) });
export type KitsFile = z.infer<typeof KitsFile>;

// File containers. A list file may be a bare array or `{<key>: [...]}`.
export const OntologyFile = z.object({ nodes: z.array(OntologyNodeInput).default([]) });
export const ExternalsFile = z.object({ externals: z.array(Externals).default([]) });
export const TheoryFile = z.object({ claims: z.array(TheoryClaim).default([]) });
export const SpecFile = z.object({ requirements: z.array(Requirement).default([]) });
export const CriteriaFile = z.object({ criteria: z.array(Criterion).default([]), hooks: z.array(AssayHook).default([]) });
export const PurposeFile = z.object({ purposes: z.array(Purpose).default([]) });
