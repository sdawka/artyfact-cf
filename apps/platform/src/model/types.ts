/**
 * Serialisable shape of `@artyfact/model`'s `SystemModel` as it arrives in `ModelBundle.model`
 * (Maps already turned into arrays/objects, `index` dropped). Field names mirror
 * `packages/model/src/schema.ts`; replace with imports from `@artyfact/model` once the SPA
 * depends on it. Defaulted schema fields are optional here because the bundle is opaque on the
 * wire; `buildIndex` fills the defaults.
 */
import type { ModelBundle } from "../../shared/api";

export type Relation =
  | "contains" | "serves" | "invokes" | "governs" | "reads" | "writes" | "storedIn" | "refines" | "realizes"
  | "dependsOn" | "satisfies" | "measures" | "affects" | "inherits" | "triggers" | "references";

export type Certainty = "declared" | "assumed" | "hypothesis" | "proposed" | "observed" | "derived";

export type NodeKind =
  | "system" | "thing" | "section" | "screen" | "component" | "affordance" | "route" | "entity" | "field"
  | "operation" | "policy" | "binding" | "grouping" | "external" | "purpose" | "claim" | "requirement";

/** Every kind the UI can focus: ontology kinds plus the non-graph objects. */
export type AnyKind =
  | NodeKind
  | "feature" | "commitment" | "criterion" | "hook" | "journey" | "step" | "evolution" | "realization"
  | "artifact" | "template";

export interface Source { doc: string; section?: string; quote?: string }

export interface CrossLink {
  rel: Relation;
  to: string;
  direction?: "out" | "in";
  certainty?: Certainty;
  label?: string;
  source?: Source;
}

export interface Field { name: string; type: string; optional?: boolean }

export interface OntologyNode {
  id: string;
  kind: NodeKind;
  name: string;
  parent?: string;
  owningThing?: string;
  revision?: number;
  description?: string;
  source?: Source;
  refines?: string[];
  links?: CrossLink[];
  route?: string;
  cardinality?: string;
  states?: string[];
  roles?: string[];
  actor?: string;
  trigger?: string;
  preconditions?: string[];
  effects?: string[];
  failure?: string[];
  fields?: Field[];
  invariants?: string[];
  provisional?: boolean;
  mode?: string;
  fromTemplate?: string;
}

export interface External {
  id: string;
  kind: "person" | "group" | "context" | "service" | "device" | "event" | "organization" | "resource";
  name: string;
  modeled: string;
  external: string;
  links?: CrossLink[];
  source?: Source;
}

export interface Purpose {
  id: string;
  statement: string;
  beneficiaries: string[];
  intendedChange: string;
  successCriteria: string[];
  nonGoals?: string[];
  constraints?: string[];
  source?: Source;
}

export interface TheoryClaim {
  id: string;
  name: string;
  purpose: string;
  mechanism: string;
  beneficiaries: string[];
  activities?: string[];
  outcome: string;
  indicator: string;
  evaluationMethod: string;
  limitation: string;
  kind?: "hypothesis" | "invariant";
  status?: "unknown" | "supported" | "challenged" | "inconclusive";
  deferred?: boolean;
}

export interface GDFeature { id: string; name: string; summary: string; deferred?: boolean; source?: Source }
export interface Commitment { id: string; statement: string; features: string[]; coupledWith?: string[]; source?: Source }
export interface Description {
  narrative: string;
  features: GDFeature[];
  commitments: Commitment[];
  alternatives?: string[];
  openQuestions?: string[];
}

export interface Requirement {
  id: string;
  thing: string;
  title: string;
  text: string;
  refines?: string[];
  subjects?: string[];
  enabled?: boolean;
  source?: Source;
}

export interface ArtifactBinding {
  artifact: string;
  type: "worker-fullstack" | "model-kit" | "document" | "external";
  repo?: string;
  commit?: string;
  scope?: string[];
}

export interface Thing {
  id: string;
  name: string;
  templateRef: string | null;
  description: string;
  artifacts: ArtifactBinding[];
  sections?: string[];
  purposeRefs?: string[];
}

export type Gate = "submission" | "candidate" | "selection" | "promotion" | "deployment" | "outcome";
export type TargetKind = "model" | "artifact" | "runtime" | "observation";

export interface Criterion {
  id: string;
  version?: number;
  title: string;
  claim: string;
  ownerKind: "system" | "thing";
  ownerId: string;
  subjectKind: NodeKind;
  subjectId: string;
  targetKind: TargetKind;
  sourceRefs?: string[];
  refines?: string[];
  satisfies?: string[];
  severity?: "hard" | "soft" | "advisory";
  gates: Gate[];
  applicableWhen?: string;
  deferred?: boolean;
  hooks?: string[];
  fromTemplate?: string;
}

export interface AssayHook {
  id: string;
  version?: number;
  assay: string;
  criteria: string[];
  tier: "basic" | "execution" | "semantic";
  engine: string;
  targetKind: TargetKind;
  triggers: Gate[];
  inputs?: Record<string, string>;
  verdictMapping?: Record<string, string>;
  timeoutMs?: number;
  costTier?: "free" | "cheap" | "expensive";
  binding?: "defined" | "implementation-missing" | "bound";
  fromTemplate?: string;
}

export interface JourneyStep {
  id: string;
  actor: "user" | "system" | "external" | "counterpart";
  action: string;
  screen?: string;
  operation?: string;
  state?: string;
  external?: string;
  kind?: "action" | "reaction" | "wait" | "branch" | "failure" | "end";
  next?: { to: string; when?: string }[];
  requirementRefs?: string[];
  unresolved?: boolean;
}

export interface Journey {
  id: string;
  name: string;
  actorGoal: string;
  features: string[];
  requirements: string[];
  start: string;
  steps: JourneyStep[];
  deferred?: boolean;
  segments?: { name: string; steps: string[] }[];
}

export interface ModelEvolution {
  id: string;
  title: string;
  intent: string;
  state: string;
  baseRevision?: string;
  kind: "implementation" | "genome-amendment" | "mixed";
  affectedNodes: string[];
  affectedClaims?: string[];
  genomeDelta?: { op: "add" | "change" | "remove"; path: string; summary: string }[];
  acceptanceCriteria: string[];
  requiredEvidence?: string[];
  dependsOn?: string[];
  risk?: "low" | "medium" | "high";
  realizations?: string[];
  decision?: unknown;
}

export interface SystemFile {
  id: string;
  name: string;
  template: string | null;
  profile?: string;
  things: string[];
  phase?: string;
  head?: string;
  purposes: string[];
}

export interface Pin { id: string; version: string }
export interface KitsFile { kits?: Pin[]; rulePacks?: Pin[]; required?: string[] }

export interface ModelJson {
  revision?: string;
  system: SystemFile;
  purposes?: Purpose[];
  externals?: External[];
  /** Theory claims (`SystemModel.claims`). */
  claims?: TheoryClaim[];
  /** Accepted as an alias of `claims` for bundles that name the Theory list `theory`. */
  theory?: TheoryClaim[];
  description?: Description;
  kits?: KitsFile;
  things?: Thing[];
  nodes?: OntologyNode[];
  requirements?: Requirement[];
  criteria?: Criterion[];
  hooks?: AssayHook[];
  journeys?: Journey[];
  evolutions?: ModelEvolution[];
  templates?: unknown[];
  origin?: Record<string, string>;
}

/** Where the bundle came from; the TopBar shows a "fixture data" pill for `fixture`. */
export type BundleSource = "api" | "fixture";

/** `ModelBundle` as the SPA holds it: `model` typed, plus its source. */
export interface UiBundle extends Omit<ModelBundle, "model"> {
  model: ModelJson;
  source: BundleSource;
}
