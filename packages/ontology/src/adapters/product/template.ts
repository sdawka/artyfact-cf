import type { Check, KindCriteria, RootCriteria, TemplateInput } from "../../meta/schema.ts";
import { productChecks, productNeeds } from "./packs.ts";

/** The synthetic root every loaded product node is contained in; it carries the spec-level cardinalities. */
export const SPEC_ROOT = "$spec";
export const NODE_STATUSES = ["committed", "draft", "proposed"] as const;
export const SOURCE_KINDS = ["said", "inferred"] as const;

type FieldType = "string" | "list";
type F = { name: string; type: FieldType; required?: boolean; enum?: string[] };
type P = string | [key: string, options: readonly string[]];

/** Fields every product node has: the uip/lfp `Node` shape with `source` flattened and `props` prefixed. */
const COMMON: F[] = [
  { name: "title", type: "string", required: true },
  { name: "description", type: "string" },
  { name: "status", type: "string", enum: [...NODE_STATUSES] },
  { name: "source.kind", type: "string", enum: [...SOURCE_KINDS] },
  { name: "source.statements", type: "list" },
  { name: "source.reason", type: "string" },
  { name: "source.note", type: "string" },
  { name: "props.codeRef", type: "string" },
];

const prop = (p: P): F => typeof p === "string" ? { name: `props.${p}`, type: "string" } : { name: `props.${p[0]}`, type: "string", enum: [...p[1]] };

/** Kinds and their `props` from uip `src/data/ontology.json` KINDS (same as lfp `src/kernel.ts`). */
export const PRODUCT_KIND_PROPS: Record<string, P[]> = {
  name: [], purpose: [], summary: [],
  audience: [], context: [], usecase: [], problem: [],
  outcome: ["metric", ["for", ["audience", "business"]]],
  goal: [["for", ["audience", "business"]]],
  hypothesis: [["verdict", ["open", "supported", "refuted"]]],
  assumption: [], metric: [],
  capability: [], feature: ["stages"],
  flow: ["group", ["scope", ["core", "stub", "later"]], "steps"],
  term: [], system: [], external: [], module: [],
  infra: [["role", ["client", "server", "store", "cache", "queue"]]],
  thing: [], rule: ["tests"],
  interface: [["style", ["rpc", "rest", "ui", "events"]], "in", "out"],
  event: [], protocol: ["cadence"],
  test: [["ladder", ["exists", "surface", "simulation"]], ["resultSource", ["code", "metric", "manual"]], "condition"],
  screen: [], "design-system": [],
  agent: [["status", ["core", "stub"]]],
  "ai-function": ["version", ["runtime", ["stub", "flue", "system1"]]],
  repository: [], codebase: [], infrastructure: [],
  practice: [["form", ["protocol", "process flow", "CI"]]],
  asset: ["form"],
  "test-result": [["status", ["pass", "fail", "missing"]], "value", "threshold", "confidence"],
  epic: [],
  task: [["status", ["queued", "running", "blocked", "done", "verified"]]],
  "metric-reading": ["value", "at"],
  "usage-event": [], feedback: [],
  evidence: [["verdict", ["supports", "refutes", "mixed"]]],
};
export const PRODUCT_KINDS = Object.keys(PRODUCT_KIND_PROPS);

/** Edge types from ontology.json EDGE_TYPES, endpoints verbatim. */
export const PRODUCT_EDGE_TYPES: Record<string, { from: string[]; to: string[]; description: string }> = {
  motivates: { from: ["problem", "purpose"], to: ["outcome"], description: "Is the reason the target exists." },
  serves: { from: ["capability", "feature"], to: ["audience", "goal", "outcome"], description: "Delivers value to an audience." },
  satisfies: { from: ["capability", "feature"], to: ["problem", "usecase"], description: "Meets a problem-space statement." },
  has: { from: ["audience", "capability", "feature", "problem", "usecase"], to: ["agent", "context", "flow", "problem", "usecase"], description: "Conceptual possession." },
  implements: { from: ["agent", "flow", "screen"], to: ["capability", "feature", "task"], description: "Realises a solution-space spec." },
  contains: {
    from: ["codebase", "epic", "module", "repository", "system"],
    to: ["ai-function", "asset", "codebase", "event", "infra", "module", "protocol", "rule", "task", "test", "thing"], description: "Composition.",
  },
  exposes: { from: ["module"], to: ["interface", "screen"], description: "Module exposes an interface." },
  emits: { from: ["interface"], to: ["event"], description: "Produces an event." },
  combines: { from: ["goal"], to: ["metric"], description: "Goal combines metrics." },
  measures: { from: ["feedback", "metric-reading", "usage-event"], to: ["flow", "metric", "screen"], description: "A reading measures a metric, flow or screen." },
  targets: { from: ["epic", "task"], to: ["test"], description: "Task or epic targets the tests it must turn green." },
  reports: { from: ["test-result"], to: ["test"], description: "Test result reports on a test." },
  realises: { from: ["codebase", "infrastructure", "practice"], to: ["infra", "module", "protocol", "system"], description: "Reality realises a solution-space item." },
  governs: { from: ["practice", "rule"], to: ["codebase", "thing"], description: "Rule governs a thing." },
  defines: { from: ["term"], to: ["event", "module", "thing"], description: "Glossary term defines a node." },
  uses: {
    from: ["ai-function", "audience", "codebase", "external", "flow", "infra", "interface", "module", "protocol", "screen", "system"],
    to: ["external", "infra", "infrastructure", "interface", "module", "screen", "system", "thing"], description: "Runtime dependency.",
  },
  references: {
    from: ["assumption", "capability", "event", "flow", "goal", "hypothesis", "screen"],
    to: ["capability", "flow", "hypothesis", "metric", "outcome", "problem", "test", "thing"], description: "Weak link of last resort.",
  },
  triggers: { from: ["event", "module"], to: ["event", "module"], description: "Causal succession." },
  verifies: { from: ["test"], to: ["rule"], description: "Test verifies a rule." },
  monitors: { from: ["metric"], to: ["outcome"], description: "Metric watches an outcome." },
  supports: { from: ["evidence"], to: ["hypothesis"], description: "Evidence supports a hypothesis." },
  refutes: { from: ["evidence"], to: ["hypothesis"], description: "Evidence refutes a hypothesis." },
  carries: { from: ["interface"], to: ["thing"], description: "Interface payload carries a thing." },
  hosts: { from: ["infra"], to: ["module"], description: "Infra hosts a module." },
};

type Completeness = { fields?: string[]; relations?: { rel: string; cardinality: string }[] };
/** Kind `needs` the constraint vocabulary expresses exactly: the relation's only target kind is the one produced. */
const COMPLETENESS: Record<string, Completeness> = {
  purpose: { relations: [{ rel: "motivates", cardinality: "1..*" }] },
  test: { relations: [{ rel: "verifies", cardinality: "1..*" }] },
  task: { relations: [{ rel: "targets", cardinality: "1..*" }] },
  term: { fields: ["description"] },
};

/**
 * The ontology's own criteria per kind: the wording the semantic questions carry. Kinds with `noun` or `instanceOf`
 * are the glossary the probe asks `node.kind` (and, unless `tangible: false`, `node.tangibility`) of; `testable`
 * words the measurability and falsifiability questions; `children`, `summary` and `pairs` word the set questions.
 */
export const PRODUCT_CRITERIA: Record<string, KindCriteria> = {
  purpose: {
    noun: "product purpose",
    instanceOf: "A purpose states the change the product exists to make, and for whom.",
    grounded: "It names who benefits and the change they would notice.",
    children: "Parts of one purpose must serve the same beneficiaries and the same change; none may widen or narrow what another assumes.",
    summary: "The purpose's description must name the beneficiaries and the change its parts elaborate, and nothing they contradict.",
  },
  summary: {
    noun: "summary",
    instanceOf: "A summary describes the product as a whole in a few sentences.",
    tangible: false,
    children: "Parts of one summary must describe one product: the same audience, scope and promise.",
    summary: "The summary's description must cover the purpose, audience and main features as its parts state them.",
  },
  outcome: {
    noun: "outcome",
    instanceOf: "An outcome is a change in the world or in users' behaviour that the product aims for, not something the team delivers.",
    grounded: "It names who changes, how, and how the change would be observed.",
    testable: "A testable outcome names an indicator, its baseline, its target, the horizon and the source of the measurement.",
  },
  goal: { testable: "A testable goal names the metric it combines and the level that counts as reaching it." },
  hypothesis: { testable: "A testable hypothesis names the evidence that would support it and the evidence that would refute it." },
  capability: {
    noun: "capability",
    instanceOf: "A capability is something the product enables users or the system to do, independent of a particular screen.",
    grounded: "It names the actor and the action it makes possible.",
    children: "Parts of one capability must enable the same actor to take the same action, without conflicting preconditions.",
    summary: "The capability's description must name the actor and the action its parts make possible.",
  },
  feature: {
    noun: "feature",
    instanceOf: "A feature is a user-facing piece of functionality the product provides.",
    grounded: "It names who uses it, the trigger and what the product does.",
    children: "Rules and flows of one feature apply to the same users and trigger; none may forbid or cap what another requires or permits.",
    summary: "The feature's description must state what its parts deliver together and claim no behaviour none of them provides.",
  },
  rule: {
    noun: "business rule",
    instanceOf: "A rule is a constraint or policy the product must always enforce.",
    grounded: "It names when it applies and what is allowed or forbidden.",
    testable: "A testable rule names when it applies and what a test would observe if it were broken.",
    children: "Sub-rules of one rule must be enforceable together: no case may be allowed by one and forbidden by another.",
    summary: "The rule's description must state the constraint its sub-rules refine, with no exception they do not state.",
  },
  test: { testable: "A test names its input or situation, the expected observable result and what counts as failure." },
  spec: {
    pairs: "Two sections of one spec are compatible when they describe the same product, audience and scope and use each term with one meaning.",
  },
};

/** Given, When and Then in that order, as whole words, capitalised or not: a scenario in the Given/When/Then format. Patterns compile without flags. */
export const GIVEN_WHEN_THEN = "\\b[Gg]iven\\b[\\s\\S]*\\b[Ww]hen\\b[\\s\\S]*\\b[Tt]hen\\b";

/**
 * The author's checklist per kind. A use case's format is fixed, so its check is a pattern and needs no model; a
 * screen's signifiers and a feature's user and trigger are judged, one question each.
 */
export const PRODUCT_KIND_CHECKS: Record<string, Check[]> = {
  usecase: [{ id: "givenWhenThen", text: "Is written as a Given / When / Then scenario.", pattern: GIVEN_WHEN_THEN, defect: "testability" }],
  screen: [{
    id: "signifiers",
    text: "States explicit signifiers, affordances and feedback for each control: what can be acted on, how it looks actionable, and what the person sees after acting.",
    defect: "specificity.underspecified",
  }],
  feature: [{ id: "userAndTrigger", text: "Names the user it serves and the trigger that starts it.", defect: "specificity.underspecified" }],
};

/** The criteria for the spec as a whole: how its sections fit together and how its terms are used. */
export const PRODUCT_ROOT_CRITERIA: RootCriteria = {
  sections: "The purpose motivates the outcomes, the features and capabilities serve those outcomes, and the rules constrain the features without contradicting the summary.",
  terms: "A term keeps one meaning in every section, and no section names the same thing with another word.",
};

/**
 * The uip/lfp product-spec vocabulary as a meta@1 template. Nodes hang off a synthetic `spec` root so the
 * singular kinds become child cardinalities. Status other than `committed` is a warning (`node.proposed`), not
 * the engine's `provisional` flag, so an uncommitted node keeps a spec actionable but not buildable.
 */
export const productSpec: TemplateInput = {
  id: "template.meta.product-spec",
  version: 1,
  meta: 1,
  kinds: {
    spec: {
      description: "The product spec as a whole; the loader adds it as the parent of every node.",
      fields: [{ name: "title", type: "string" }],
      completeness: {
        fields: [],
        children: [
          { kind: "name", cardinality: "1" },
          { kind: "purpose", cardinality: "1" },
          { kind: "summary", cardinality: "0..1" },
          { kind: "design-system", cardinality: "0..1" },
        ],
        relations: [],
      },
      criteria: PRODUCT_CRITERIA.spec,
    },
    ...Object.fromEntries(PRODUCT_KINDS.map((k) => [k, {
      fields: [...COMMON, ...PRODUCT_KIND_PROPS[k].map(prop)],
      completeness: { fields: COMPLETENESS[k]?.fields ?? [], children: [], relations: COMPLETENESS[k]?.relations ?? [] },
      ...(PRODUCT_CRITERIA[k] && { criteria: PRODUCT_CRITERIA[k] }),
      ...(PRODUCT_KIND_CHECKS[k] && { checks: PRODUCT_KIND_CHECKS[k] }),
    }])),
  },
  rootCriteria: PRODUCT_ROOT_CRITERIA,
  relations: Object.fromEntries(Object.entries(PRODUCT_EDGE_TYPES).map(([r, e]) => [r, {
    description: e.description, from: e.from, to: e.to,
    // rule needs >= 1 incoming verifies (rule is the only target kind of verifies); contains is composition.
    ...(r === "verifies" && { cardinality: { out: "0..*", in: "1..*" } }),
    ...(r === "contains" && { acyclic: true }),
  }])),
  constraints: {
    forbiddenCycles: [],
    incompatible: [],
    exclusive: [],
    exactlyOne: [{ id: "evidence.direction", kind: "evidence", of: [{ rel: "supports" }, { rel: "refutes" }] }],
    complete: [],
  },
  questions: [{
    id: "outcome.measurable",
    text: "Is this outcome stated so that it can be measured?",
    answer: "yes-no",
    slice: {
      parents: false, hops: 1, direction: "both",
      rels: ["motivates", "monitors", "references"], kinds: ["purpose", "problem", "metric", "hypothesis"],
      fields: ["title", "description", "props.metric", "props.for"],
    },
    benign: "yes",
    policy: [{ answer: "yes", level: "pass" }, { answer: "no", level: "warning" }],
  }],
  rules: [productNeeds, productChecks],
};
