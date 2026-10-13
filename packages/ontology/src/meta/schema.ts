import { z } from "zod";
import { isCardinality } from "./cardinality.ts";

const name = z.string().min(1);
const card = z.string().refine(isCardinality, { message: "expected cardinality N, N..M or N..*" });
const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const FIELD_TYPES = ["string", "number", "boolean", "ref", "refs", "list", "object"] as const;
export const SEVERITIES = ["hard", "soft", "advisory"] as const;
export const ANSWER_TYPES = ["yes-no", "choice", "score"] as const;

/**
 * Deterministic text-quality constraints on a string field. Negative bounds, an unknown `distinctFrom` field and a
 * `pattern` that does not compile are form errors in meta@1 rather than parse errors, so they carry a finding.
 */
export const TEXT_KEYS = ["minLength", "minWords", "placeholders", "distinctFrom", "pattern"] as const;
const textShape = {
  minLength: z.number().int().optional(),
  minWords: z.number().int().optional(),
  /** Case-insensitive tokens or short phrases; a value equal to one, or containing one as a whole word, is a placeholder. */
  placeholders: z.array(z.string().min(1)).optional(),
  /** Other field names of the same kind, or the literal `"id"`. */
  distinctFrom: z.array(name).optional(),
  /** A JavaScript regular expression source, compiled without flags and tested against the trimmed value. */
  pattern: z.string().optional(),
};
export const TextConstraintsSchema = z.strictObject(textShape);

/** Engine placeholder tokens, applied only when a template opts in with `textDefaults`. */
export const DEFAULT_PLACEHOLDERS: readonly string[] = [
  "tbd", "todo", "tba", "fixme", "xxx", "???", "lorem ipsum", "placeholder", "n/a", "none yet", "to be defined", "to be determined",
];
/** Field names `textDefaults` applies to. */
export const TEXT_DEFAULT_FIELDS: readonly string[] = ["description", "title"];

export const FieldSchema = z.strictObject({
  name,
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  enum: z.array(scalar).optional(),
  ...textShape,
});

/**
 * The ontology's own criteria for one kind, as sentences the semantic questions carry in their stem. `noun`,
 * `instanceOf`, `grounded`, `tangible` and `minScore` shape the node questions; `testable` the measurability and
 * falsifiability questions; `children` and `summary` the set questions asked of a node of this kind about its children;
 * `pairs` the relation question asked of two children of this kind. Absent keys leave the question's generic wording.
 */
export const KIND_CRITERIA_TEXT = ["noun", "instanceOf", "grounded", "testable", "children", "pairs", "summary"] as const;
export const KindCriteriaSchema = z.strictObject({
  /** What to call a node of this kind in a question. Default: the kind name. */
  noun: z.string().min(1).optional(),
  /** What makes a statement a genuine instance of this kind. */
  instanceOf: z.string().optional(),
  /** What a fully grounded statement of this kind names. */
  grounded: z.string().optional(),
  /** False for structural kinds (sections, summaries): not scored for tangibility. Default true. */
  tangible: z.boolean().optional(),
  /** Lowest passing tangibility score, 0 to 4; outside that range is a meta@1 error. */
  minScore: z.number().int().optional(),
  /** What makes a statement of this kind checkable. */
  testable: z.string().optional(),
  /** What must hold among the children of a node of this kind for them to be mutually consistent. */
  children: z.string().optional(),
  /** What a compatible pair of children of this kind looks like. */
  pairs: z.string().optional(),
  /** What the description of a node of this kind must say about its children. */
  summary: z.string().optional(),
});

/** The ontology's criteria for the whole: how its sections must fit together and how its terms must be used. */
export const ROOT_CRITERIA_TEXT = ["sections", "terms"] as const;
export const RootCriteriaSchema = z.strictObject({ sections: z.string().optional(), terms: z.string().optional() });

export const CHECK_SCOPES = ["node", "children", "pair"] as const;
export const CHECK_LEVELS = ["error", "warning", "info"] as const;

/**
 * One item of the author's checklist for a kind: a requirement every good node of the kind (`node`), the children of
 * every node of the kind together (`children`), or every pair of those children (`pair`) must meet. With `pattern`
 * it is deterministic: the node passes when `field` matches, and no model is asked. Otherwise the catalogue asks it
 * as its own question. `when` limits where it applies; `na` adds a benign "not applicable" answer.
 */
export const CheckSchema = z.strictObject({
  id: name,
  text: z.string().min(1),
  scope: z.enum(CHECK_SCOPES).optional(),
  answer: z.enum(ANSWER_TYPES).optional(),
  choices: z.array(z.string()).optional(),
  benign: scalar.optional(),
  /** Applies only where this holds: `kind` equals the node's kind (children and pair scope: filters the children); `pattern` matches `field` (default the check's field); `field` alone: that field is filled. */
  when: z.strictObject({ field: name.optional(), pattern: z.string().optional(), kind: name.optional() }).optional(),
  /** error, warning (default) or info; anything else is a meta@1 error, `check.levelUnknown`. */
  level: z.string().optional(),
  /** defects@1 id a failing answer stands for; default `instance` (node) or `consistency` (children, pair). */
  defect: name.optional(),
  /** A JavaScript regular expression, compiled without flags: the check is deterministic and passes when `field` matches. */
  pattern: z.string().optional(),
  /** The field the check reads; default `description`. */
  field: name.optional(),
  na: z.boolean().optional(),
});

export const KindSchema = z.strictObject({
  description: z.string().optional(),
  fields: z.array(FieldSchema).default([]),
  parents: z.array(name).optional(),
  completeness: z.strictObject({
    fields: z.array(name).default([]),
    children: z.array(z.strictObject({ kind: name, cardinality: card })).default([]),
    relations: z.array(z.strictObject({ rel: name, cardinality: card })).default([]),
  }).default({ fields: [], children: [], relations: [] }),
  criteria: KindCriteriaSchema.optional(),
  /** The author's checklist for nodes of this kind and for their children. */
  checks: z.array(CheckSchema).optional(),
});

export const RelationSchema = z.strictObject({
  description: z.string().optional(),
  from: z.array(name).min(1),
  to: z.array(name).min(1),
  cardinality: z.strictObject({ out: card.default("0..*"), in: card.default("0..*") }).default({ out: "0..*", in: "0..*" }),
  acyclic: z.boolean().optional(),
  inverse: name.optional(),
  certainty: name.optional(),
});

const id = name;
export const ConstraintsSchema = z.strictObject({
  forbiddenCycles: z.array(z.strictObject({ id, relations: z.array(name).min(1) })).default([]),
  incompatible: z.array(z.strictObject({ id, kind: name, when: z.array(z.strictObject({ field: name, value: scalar })).min(2) })).default([]),
  exclusive: z.array(z.strictObject({ id, relations: z.array(name).min(2) })).default([]),
  exactlyOne: z.array(z.strictObject({
    id, kind: name,
    of: z.array(z.union([z.strictObject({ field: name }), z.strictObject({ rel: name })])).min(2),
  })).default([]),
  complete: z.array(z.strictObject({ id, kind: name })).default([]),
});

export const CriterionSchema = z.strictObject({
  id,
  owner: name,
  subject: name,
  severity: z.enum(SEVERITIES),
  description: z.string().optional(),
  gates: z.array(name).default([]),
  hooks: z.array(name).default([]),
});

export const RulePackSchema = z.strictObject({ id, version: z.union([z.string(), z.number()]).transform(String), source: z.string() });

export const SLICE_DIRECTIONS = ["out", "in", "both"] as const;

/** The bounded state a question sees: the subject, optionally its parent chain, and nodes within `hops` links. */
export const SliceSchema = z.strictObject({
  parents: z.boolean().default(true),
  hops: z.number().int().nonnegative().default(0),
  direction: z.enum(SLICE_DIRECTIONS).default("out"),
  rels: z.array(name).optional(),
  kinds: z.array(name).optional(),
  fields: z.array(name).optional(),
  /** Direct children of the subject (and counterpart), filtered by `kinds`, shown as `members`; containment is `node.parent`. */
  children: z.boolean().default(false),
  /** String field values in the slice are cut to this many characters. */
  textCap: z.number().int().positive().default(600),
  /** Kinds whose nodes are always in `nodes`, however far from the subject (for example the purpose a node should serve). */
  anchors: z.array(name).optional(),
});

export const NEXT_STATUSES = ["confident", "review"] as const;
export const NEXT_OVER = ["self", "members", "pairs", "sections", "crossPairs"] as const;
export const DEFECT_LEVELS = ["error", "warning", "info"] as const;
export const CHOICES_FROM = ["members", "sections"] as const;

/**
 * A follow-up: when the answer matches `answer` (or a score is at most `maxScore`) with at least `minStatus`, ask
 * question `ask` over `over` (the same subject, its members, member pairs, sections or cross-section pairs).
 */
export const NextSchema = z.strictObject({
  answer: scalar.optional(),
  maxScore: z.number().int().optional(),
  /** Absent: `confident`, except `review` for a navigation question (`choicesFrom`); see `minStatusOf`. */
  minStatus: z.enum(NEXT_STATUSES).optional(),
  ask: name,
  over: z.enum(NEXT_OVER).default("self"),
});

/** `id` is the rule id of the semantic candidate the question resolves. `choices` are options for `choice` and levels for `score`. */
export const QuestionSchema = z.strictObject({
  id,
  text: z.string().optional(),
  answer: z.enum(ANSWER_TYPES),
  choices: z.array(z.string()).optional(),
  slice: SliceSchema.default({ parents: true, hops: 0, direction: "out", children: false, textCap: 600 }),
  benign: scalar,
  /** Answer `"*"` matches any answer no other entry names (for options resolved per subject). */
  policy: z.array(z.strictObject({ answer: scalar, level: name, defect: name.optional() })).min(1),
  /** The defect (defects@1 id) a harmful answer stands for; a policy entry's own `defect` wins. */
  defect: name.optional(),
  /**
   * Per subject kind: wording substituted for `{noun}`, `{instanceOf}` and `{grounded}` in the text and choices.
   * Either a plain noun or a JSON object `{"noun", "instanceOf"?, "grounded"?}`.
   */
  byKind: z.record(name, z.string()).optional(),
  /** Companion questions asked in the same call over the same slice; they raise no candidate of their own. */
  batchWith: z.array(name).optional(),
  next: z.array(NextSchema).optional(),
  /** Per-option criteria for a `choice` question, keyed by choice; an option without one sends its key as criterion. */
  criteria: z.record(z.string(), z.string()).optional(),
  /**
   * The options are resolved per subject instead of declared: the subject's slice `members` or the root's sections.
   * `toWire` takes the resolved options; declared `choices` (for example `none`) are appended after them.
   */
  choicesFrom: z.enum(CHOICES_FROM).optional(),
  /** For a `score` question: per subject kind, the lowest score that passes, overriding the policy's boundary. */
  passFrom: z.record(name, z.number().int()).optional(),
});

/** Template overrides of defects@1: `disable` drops defects with their subtrees, `levels` changes a defect's level. */
export const DefectsConfigSchema = z.strictObject({
  disable: z.array(name).default([]),
  levels: z.record(name, z.enum(DEFECT_LEVELS)).default({}),
});

export const TemplateNodeSchema = z.strictObject({
  id,
  kind: name,
  parent: name.optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
  provisional: z.boolean().optional(),
  /** Outgoing links of the prefilled node; `from` is the node itself. */
  links: z.array(z.strictObject({ rel: name, to: name, certainty: name.optional() })).optional(),
});

export const TemplateSourceSchema = z.strictObject({
  id,
  version: z.number().int().nonnegative(),
  meta: z.literal(1),
  extends: name.optional(),
  kinds: z.record(z.string(), KindSchema).default({}),
  relations: z.record(z.string(), RelationSchema).default({}),
  constraints: ConstraintsSchema.default({ forbiddenCycles: [], incompatible: [], exclusive: [], exactlyOne: [], complete: [] }),
  criteria: z.array(CriterionSchema).default([]),
  rules: z.array(RulePackSchema).default([]),
  questions: z.array(QuestionSchema).default([]),
  nodes: z.array(TemplateNodeSchema).default([]),
  /**
   * Opt-in text constraints for every declared string field named `description` or `title`. A field's own text
   * keys win key by key. `placeholders` defaults to `DEFAULT_PLACEHOLDERS`; `{}` opts in with only that.
   */
  textDefaults: TextConstraintsSchema.optional(),
  defects: DefectsConfigSchema.default({ disable: [], levels: {} }),
  /** Criteria for the root's sections and shared terms (template-level; per-kind criteria live on each kind). */
  rootCriteria: RootCriteriaSchema.optional(),
  /** Checks applied to the root nodes (nodes without a parent) and their children; rule `check:root.<id>`. */
  rootChecks: z.array(CheckSchema).optional(),
});

export type Field = z.infer<typeof FieldSchema>;
export type Kind = z.infer<typeof KindSchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type Constraints = z.infer<typeof ConstraintsSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type RulePack = z.infer<typeof RulePackSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Slice = z.infer<typeof SliceSchema>;
export type Next = z.infer<typeof NextSchema>;
export type DefectsConfig = z.infer<typeof DefectsConfigSchema>;
export type TextConstraints = z.infer<typeof TextConstraintsSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type KindCriteria = z.infer<typeof KindCriteriaSchema>;
export type RootCriteria = z.infer<typeof RootCriteriaSchema>;
export type TemplateNode = z.infer<typeof TemplateNodeSchema>;
export type TemplateSource = z.infer<typeof TemplateSourceSchema>;
export type TemplateInput = z.input<typeof TemplateSourceSchema>;
