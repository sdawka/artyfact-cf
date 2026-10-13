import { z } from "zod";

// The shapes `SystemModel` projects the Genome's node tree into (see genome.ts), and the platform's own records.

// `$` admits a template's `$thing` placeholder inside an id (`C.$thing.checks`), rebased per Thing.
const id = (p: string) => z.string().regex(new RegExp(`^${p.replace(".", "\\.")}[\\w.$-]+$`));
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
  part: id("part."),
  recipe: id("recipe."),
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

/** A link's relation: any relation the System's templates declare. */
export const Relation = z.string().min(1);
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

/** A node's kind: any kind the System's templates declare (the engine checks it). */
export const NodeKind = z.string().min(1);
export type NodeKind = z.infer<typeof NodeKind>;

/** The kinds of the artyfact base template that the projection gives a shape of their own (not ontology nodes). */
export const KNOWN_KINDS = [
  "system", "thing", "purpose", "external", "claim", "feature", "commitment", "requirement", "criterion", "hook",
  "journey", "step", "evolution", "template", "kit", "artifact",
] as const;

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
  /** Policy mode, e.g. "owner-only", "pair-consent" (policy nodes; emitted as policyMode/2). */
  mode: str.optional(),
  fromTemplate: Id.templateRef.optional(),
});
export type OntologyNode = z.infer<typeof OntologyNode>;

/** A template's prefilled node in the v1 template shape: may nest `children`. */
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
  /** The containment parent in the Genome tree (the System, or the node whose directory holds this one). */
  parent: AnyId.optional(),
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
  /** The containment parent in the Genome tree (the System, or the node whose directory holds this one). */
  parent: AnyId.optional(),
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
  /** The containment parent in the Genome tree (the System, or the node whose directory holds this one). */
  parent: AnyId.optional(),
  name: str,
  summary: str,
  deferred: z.boolean().default(false),
  source: Source.optional(),
});
export type GDFeature = z.infer<typeof GDFeature>;

export const Commitment = z.object({
  id: AnyId,
  /** The containment parent in the Genome tree (the System, or the node whose directory holds this one). */
  parent: AnyId.optional(),
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

/** Exact immutable package coordinate. Floating tags and version ranges are intentionally rejected. */
export const PartRef = z.object({
  id: Id.part,
  version: z.string().regex(/^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/),
});
export type PartRef = z.infer<typeof PartRef>;

export const PartInputValue = z.union([str, z.number(), z.boolean(), z.null()]);
export type PartInputValue = z.infer<typeof PartInputValue>;
export const PartPath = z.string().min(1).refine((path) =>
  !path.startsWith("/") && !path.startsWith("\\") && !/^[A-Za-z]:/.test(path) &&
  !path.includes("\\") && !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && segment !== "__proto__"),
{ message: "Part paths must be normalized relative paths without traversal" });
export const PartInputDefinition = z.object({
  name: z.string().regex(/^[A-Za-z][\w.-]*$/),
  description: str.optional(),
  required: z.boolean().default(false),
  default: PartInputValue.optional(),
});
export type PartInputDefinition = z.infer<typeof PartInputDefinition>;

export const PartContentKind = z.enum(["model", "file"]);
export type PartContentKind = z.infer<typeof PartContentKind>;
const PartEntries = z.unknown().superRefine((value, ctx) => {
  // Zod intentionally drops __proto__ record keys; reject rather than silently losing a file.
  if (value && typeof value === "object" && Object.hasOwn(value, "__proto__")) {
    ctx.addIssue({ code: "custom", message: "Part paths must not use __proto__" });
  }
}).pipe(z.record(PartPath, str));
export const PartPayload = z.object({
  model: PartEntries.default({}),
  files: PartEntries.default({}),
});
export type PartPayload = z.infer<typeof PartPayload>;
export const PartSelection = z.object({
  include: z.array(PartPath).optional(),
  rename: z.record(PartPath, PartPath).default({}),
});
export type PartSelection = z.infer<typeof PartSelection>;
export const PartMask = z.object({ model: z.array(PartPath).default([]), files: z.array(PartPath).default([]) });
export type PartMask = z.infer<typeof PartMask>;
export const PartReplacement = z.object({ kind: PartContentKind, path: PartPath, contribution: str });
export type PartReplacement = z.infer<typeof PartReplacement>;
export const PartCombination = z.object({
  kind: PartContentKind,
  path: PartPath,
  contribution: str,
  strategy: z.enum(["append", "prepend"]),
  separator: str.default("\n"),
});
export type PartCombination = z.infer<typeof PartCombination>;
export const PartCommand = z.object({
  id: z.string().regex(/^[A-Za-z][\w.-]*$/),
  run: str,
  purpose: str,
  cwd: str.optional(),
});
export type PartCommand = z.infer<typeof PartCommand>;

export const PartContribution = z.object({
  id: z.string().regex(/^[A-Za-z][\w.-]*$/),
  part: PartRef,
  inputs: z.record(z.string(), PartInputValue).default({}),
  model: PartSelection.optional(),
  files: PartSelection.optional(),
  mask: PartMask.default({ model: [], files: [] }),
  replacements: z.array(PartReplacement).default([]),
  combinations: z.array(PartCombination).default([]),
});
export type PartContribution = z.infer<typeof PartContribution>;
export const PartRecipe = z.object({
  id: Id.recipe,
  contributions: z.array(PartContribution),
  /** Explicit authoring commands; model composition returns these as inert data. */
  commands: z.array(PartCommand).default([]),
});
export type PartRecipe = z.infer<typeof PartRecipe>;

export const PartVisibility = z.enum(["shared", "system-private"]);
export type PartVisibility = z.infer<typeof PartVisibility>;
export const PartPackage = z.object({
  id: Id.part,
  version: PartRef.shape.version,
  name: str,
  description: str.optional(),
  visibility: PartVisibility,
  systemId: Id.system.optional(),
  published: z.boolean().default(false),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  inputs: z.array(PartInputDefinition).default([]),
  payload: PartPayload.default({ model: {}, files: {} }),
  recipe: PartRecipe.optional(),
  commands: z.array(PartCommand).default([]),
}).superRefine((value, ctx) => {
  if (value.visibility === "system-private" && value.systemId === undefined) {
    ctx.addIssue({ code: "custom", path: ["systemId"], message: "system-private Parts require systemId" });
  }
  if (value.visibility === "shared" && value.systemId !== undefined) {
    ctx.addIssue({ code: "custom", path: ["systemId"], message: "shared Parts cannot declare systemId" });
  }
  if (new Set(value.inputs.map((input) => input.name)).size !== value.inputs.length) {
    ctx.addIssue({ code: "custom", path: ["inputs"], message: "input names must be unique" });
  }
});
export type PartPackage = z.infer<typeof PartPackage>;

export const PartUse = z.object({
  contribution: z.string().regex(/^[A-Za-z][\w.-]*$/),
  part: PartRef,
  inputs: z.record(z.string(), PartInputValue).default({}),
});
export type PartUse = z.infer<typeof PartUse>;

export const PartOutputMapping = z.object({
  kind: PartContentKind,
  path: PartPath,
  /** Package/extraction origin. Command-created output has no package source path. */
  sourcePath: PartPath.optional(),
  contribution: str,
  part: PartRef.optional(),
  disposition: z.enum(["retained", "adapted", "replaced", "combined", "excluded"]),
  by: str.optional(),
  command: z.object({ id: PartCommand.shape.id, contribution: str, action: z.enum(["created", "changed", "deleted"]) }).optional(),
}).refine((mapping) => mapping.sourcePath !== undefined || mapping.command !== undefined, { message: "output needs a source path or explicit command origin" });
export type PartOutputMapping = z.infer<typeof PartOutputMapping>;
export const CompositionProvenance = z.object({
  recipe: Id.recipe,
  packages: z.array(z.object({ contribution: str, part: PartRef, digest: str.optional() })),
  inputs: z.array(z.object({ contribution: str, values: z.record(z.string(), PartInputValue) })),
  outputs: z.array(PartOutputMapping),
});
export type CompositionProvenance = z.infer<typeof CompositionProvenance>;
export const SavedPartCommand = PartCommand.extend({ contribution: str });
export type SavedPartCommand = z.infer<typeof SavedPartCommand>;
export const SavedComposition = z.object({
  version: z.literal(1),
  recipe: PartRecipe,
  model: z.record(PartPath, str),
  files: z.record(PartPath, str),
  provenance: CompositionProvenance,
  commands: z.array(SavedPartCommand),
});
export type SavedComposition = z.infer<typeof SavedComposition>;

export const Generalization = z.object({
  kind: PartContentKind,
  path: PartPath,
  value: str.min(1),
  input: z.string().regex(/^[A-Za-z][\w.-]*$/),
  default: PartInputValue.optional(),
});
export const ExtractionRequest = z.object({
  source: PartPayload.extend({ revision: str }),
  package: z.object({
    id: Id.part,
    version: PartRef.shape.version,
    name: str,
    description: str.optional(),
    visibility: PartVisibility,
    systemId: Id.system.optional(),
  }),
  select: z.object({ model: z.array(PartPath).optional(), files: z.array(PartPath).optional() }).default({}),
  mask: PartMask.default({ model: [], files: [] }),
  generalize: z.array(Generalization).default([]),
});
export type ExtractionRequest = z.infer<typeof ExtractionRequest>;
export const ExtractionResult = z.object({
  part: PartPackage,
  sourceRevision: str,
  provenance: z.object({ outputs: z.array(PartOutputMapping) }),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

export const UpgradeRequest = z.object({ baseline: PartPayload, current: PartPayload, next: PartPayload });
export type UpgradeRequest = z.infer<typeof UpgradeRequest>;
export const UpgradeConflict = z.object({
  kind: PartContentKind,
  path: PartPath,
  baseline: str.optional(),
  current: str.optional(),
  next: str.optional(),
});
export type UpgradeConflict = z.infer<typeof UpgradeConflict>;
export const UpgradeResult = z.object({ result: PartPayload, conflicts: z.array(UpgradeConflict) });
export type UpgradeResult = z.infer<typeof UpgradeResult>;

export const Thing = z.object({
  id: Id.thing,
  name: str,
  templateRef: str.nullable().default(null),
  description: str,
  artifacts: z.array(ArtifactBinding).default([]),
  parts: z.array(PartUse).default([]),
  /** Saved composition metadata. Loading a Thing never reruns the recipe or its commands. */
  composition: CompositionProvenance.optional(),
  /** Defaults to the template's `sections` when omitted (filled in by the loader). */
  sections: z.array(AnyId).optional(),
  purposeRefs: strs,
});
export type Thing = z.infer<typeof Thing>;
/** A Thing after loading: `sections` is always present. */
export type ResolvedThing = Thing & { sections: string[] };

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
  engine: z.enum(["manifest", "diff", "model-rules", "system-one", "vitest", "browser", "http", "llm"]),
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
  /** The containment parent in the Genome tree (the System, or the node whose directory holds this one). */
  parent: AnyId.optional(),
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
export const AgentRole = z.enum(["implementer", "assay-author", "verifier", "reviewer", "repairer", "author"]);

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
  /** Why an `error` execution failed (hooks contract). */
  error: str.optional(),
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

/** kits.yaml: pinned Kits, pinned Rule Packs (`packsFor(model.kits.rulePacks)`), and the Kit ids the System requires. */
export const Pin = z.object({ id: AnyId, version: str });
export type Pin = z.infer<typeof Pin>;
export const KitsFile = z.object({ kits: z.array(Pin).default([]), rulePacks: z.array(Pin).default([]), required: strs });
export type KitsFile = z.infer<typeof KitsFile>;

