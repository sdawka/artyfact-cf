import { checkField, checkRule, checkScope, isDeterministic, ROOT_OWNER } from "../evaluate/checks.ts";
import { CHECK_LEVELS, type Check, type DefectsConfig, type KindCriteria, type RootCriteria, type TemplateInput } from "../meta/schema.ts";
import { DEFECTS, defectChildren, defectIndex, mergeDefects, OTHER_KIND, otherKindDefects, type Defect, type DefectScope } from "./defects.ts";
import { ANY_ANSWER } from "./policy.ts";
import { kindSettings, semanticProbe, type KindSetting, type ProbeOptions } from "./probe.ts";

type QuestionInput = NonNullable<TemplateInput["questions"]>[number];
type SliceInput = NonNullable<QuestionInput["slice"]>;

/** Rule ids of the v1 semantic questions. A `pair.` rule carries two subjects (see `PAIR_PREFIX`). */
export const SEMANTIC_RULES_V1 = ["text.vague", "text.unmeasurable", "pair.contradiction", "criterion.unfalsifiable"] as const;
export type SemanticRuleV1 = (typeof SEMANTIC_RULES_V1)[number];

/**
 * The hand-written v2 questions: the stage-1 entries the probe raises candidates for, their batch companions, and the
 * funnel's pickers. The generated `which:<defect>` questions are added by `generatedQuestions`.
 */
export const SEMANTIC_RULES = [
  "node.kind", "node.tangibility", "text.unmeasurable", "criterion.unfalsifiable", "node.purpose",
  "set.allHold", "set.inconsistent", "parent.summary", "set.member", "pair.relation",
  "sections.allHold", "sections.inconsistent", "sections.which", "sections.section", "sections.other", "term.usage",
] as const;
export type SemanticRuleV2 = (typeof SEMANTIC_RULES)[number];
export type SemanticRule = SemanticRuleV1 | SemanticRuleV2;

/** Prefix of the generated questions: `which:<defect id>` asks which child of that defect applies. */
export const WHICH_PREFIX = "which:";
export const whichOf = (defect: string) => `${WHICH_PREFIX}${defect}`;
/** The option every generated or picker question offers when nothing applies. */
export const NONE = "none";

/** Fields a slice keeps when the template does not say; the product and artyfact vocabularies name their text this way. */
export const DEFAULT_SLICE_FIELDS = ["title", "name", "description"];

export interface CatalogueOptions {
  /** Fields every slice node keeps: the statement fields plus whatever labels the node (title, name). */
  fields?: string[];
  /** Which hand-written rules to include; default all of `SEMANTIC_RULES` (v2) or `SEMANTIC_RULES_V1` (v1). */
  rules?: readonly SemanticRule[];
  /** v2: the glossary, compiled into `byKind` on `node.kind` and `node.tangibility` and `passFrom` from `minScore`. */
  kinds?: ProbeOptions["kinds"];
  /** v2: relations `pair.relation` follows one hop from both ends; default every relation. */
  probePairs?: string[];
  /** v2: kinds always shown to `node.purpose` (the purpose it is judged against). Default `["purpose"]`. */
  purposeAnchors?: string[];
  /** v2: the (merged) defect tree the policies read levels and criteria from. Default `DEFECTS`. */
  tree?: readonly Defect[];
  /** v2: the template's kinds; their `criteria` are the base wording that `kinds` overrides (see `compileKinds`). */
  base?: TemplateInput["kinds"];
  /** v2: the template's root criteria, filled into `{sections}` and `{terms}`. */
  root?: RootCriteria;
}

/**
 * The questions, modelled on sys1's `ambiguity_detection`, `criteria_fulfillment` and `consistency_check` categories.
 * For yes-no questions, `choices` holds the `true` and `false` criteria sent on the wire, in that order.
 */
const V1: Record<SemanticRuleV1, (fields: string[]) => QuestionInput> = {
  "text.vague": (fields) => ({
    id: "text.vague",
    answer: "yes-no",
    text: "Is this statement too vague to act on or verify? The statement is state.candidate.text; it belongs to state.subject, "
      + "and state.parents give its context. Vague means two competent engineers could implement or check it in materially "
      + "different ways, or could not tell when it is done: it rests on an undefined subjective quality, has no threshold or "
      + "stop condition, or names no concrete behaviour. Length does not matter, and a short statement that pins down one "
      + "behaviour, quantity or rule is not vague.",
    choices: [
      "Vague: competent readers could build or check it in materially different ways, or could not tell when it is done.",
      "Concrete: competent readers would arrive at the same behaviour and the same done-test.",
    ],
    slice: { parents: true, hops: 0, fields },
    benign: "no",
    policy: [{ answer: "no", level: "pass" }, { answer: "yes", level: "warning" }],
  }),
  "text.unmeasurable": (fields) => ({
    id: "text.unmeasurable",
    answer: "yes-no",
    text: "Can this outcome, claim or criterion be measured or tested as stated? The statement is state.candidate.text and "
      + "belongs to state.subject. Measurable means it names an observable quantity, event or condition, so that a test, "
      + "count or recorded observation could show whether it holds. Feelings, impressions or improvements with no stated "
      + "observable, threshold or method are not measurable as stated.",
    choices: [
      "Measurable: an observation, count or test could show whether the statement holds.",
      "Not measurable: no observation, count or test named or implied by the statement could show whether it holds.",
    ],
    slice: { parents: true, hops: 0, fields },
    benign: "yes",
    policy: [{ answer: "yes", level: "pass" }, { answer: "no", level: "warning" }],
  }),
  "pair.contradiction": (fields) => ({
    id: "pair.contradiction",
    answer: "yes-no",
    text: "Do these two statements contradict each other? Compare state.subject with state.counterpart, two nodes of one "
      + "specification; state.parents give context. They contradict when both cannot hold of the same system at the same "
      + "time: one requires, permits or bounds what the other forbids or exceeds. Statements about different things, or "
      + "one that merely adds detail to the other, do not contradict.",
    choices: [
      "Contradict: the two statements cannot both hold of the same system.",
      "Consistent: both statements can hold of the same system at once.",
    ],
    slice: { parents: true, hops: 0, fields },
    benign: "no",
    policy: [{ answer: "no", level: "pass" }, { answer: "yes", level: "error" }],
  }),
  "criterion.unfalsifiable": (fields) => ({
    id: "criterion.unfalsifiable",
    answer: "yes-no",
    text: "Is this acceptance criterion unfalsifiable? The criterion is state.candidate.text and belongs to state.subject. "
      + "Unfalsifiable means no test, fixture or observation could ever show that it is not met, because it hedges, rests on "
      + "opinion, or names no condition that could fail. A criterion naming a concrete input and an expected result is falsifiable.",
    choices: [
      "Unfalsifiable: no test or observation could show the criterion is not met.",
      "Falsifiable: some test or observation could show the criterion is not met.",
    ],
    slice: { parents: true, hops: 0, fields },
    benign: "no",
    policy: [{ answer: "no", level: "pass" }, { answer: "yes", level: "warning" }],
  }),
};


const cap = (s: string, n = 255) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** `byKind` words every kind with criteria; `nodeByKind` only the glossary kinds the node questions are asked of. */
interface Ctx { fields: string[]; defects: Map<string, Defect>; byKind?: Record<string, string>; nodeByKind?: Record<string, string>; root?: RootCriteria; passFrom?: Record<string, number>; rels?: string[]; anchors: string[] }

/** A policy entry for answer `a` standing for defect `id`, at that defect's (possibly overridden) level. */
const harm = (c: Ctx, answer: string, id: string) => ({ answer, level: c.defects.get(id)?.level ?? "warning", defect: id });
const criterionOf = (c: Ctx, id: string, fallback: string) => cap(c.defects.get(id)?.criterion ?? fallback);

/** The kind wording a question substitutes into its `WIRE_TOKENS`; absent wording leaves the generic stem. */
const worded = (c: Ctx) => (c.byKind ? { byKind: c.byKind } : {});

const nodeSlice = (c: Ctx): SliceInput => ({ parents: true, hops: 0, fields: c.fields });
const setSlice = (c: Ctx): SliceInput => ({ parents: true, children: true, fields: c.fields });
const pairSlice = (c: Ctx): SliceInput => ({ parents: true, hops: 1, ...(c.rels?.length && { rels: c.rels }), fields: c.fields });
const wholeSlice = (c: Ctx): SliceInput => ({ parents: false, children: true, fields: c.fields });
const SLICES: Record<DefectScope, (c: Ctx) => SliceInput> = { node: nodeSlice, set: setSlice, pair: pairSlice, whole: wholeSlice };

const RELATIONS = ["contradiction", "tension", "duplicate", "circular", "scopeClash"] as const;
const SUMMARY = ["omits", "contradicts", "overclaims", "stale"] as const;
const SECTION_DEFECTS = (c: Ctx) => [...c.defects.values()].filter((d) => d.parent === "consistency" || d.parent === "coherence");

/**
 * The hand-written v2 entries. Yes-no `choices` are the `true` and `false` criteria; choice `criteria` are per option.
 * `next` without `answer` or `maxScore` fires on any answer other than the benign one.
 */
const V2: Record<SemanticRuleV2, (c: Ctx) => QuestionInput> = {
  "node.kind": (c) => ({
    id: "node.kind",
    answer: "yes-no",
    text: "Is state.subject a genuine {noun}? Its statement is state.candidate.text; state.parents give its context. {instanceOf} "
      + "Judge what the statement is, not how well it is written: a vague but genuine {noun} is still one.",
    choices: [
      "Genuine: the statement is a {noun} as described, whatever its quality.",
      "Not genuine: it is a placeholder, another kind of item, not a statement at all, several items in one, or pitched at the wrong level.",
    ],
    slice: nodeSlice(c),
    benign: "yes",
    defect: "instance",
    policy: [{ answer: "yes", level: "pass" }, harm(c, "no", "instance")],
    next: [{ answer: "no", ask: whichOf("instance") }],
    ...(c.nodeByKind && { byKind: c.nodeByKind }),
  }),
  "node.tangibility": (c) => ({
    id: "node.tangibility",
    answer: "score",
    text: "How concrete is state.candidate.text, the statement of state.subject, as a {noun}? state.parents give its context. "
      + "Score whether competent builders could act on it and check it the same way as written; length and style do not matter.",
    choices: [
      "Empty: a slogan, aspiration or filler; there is nothing to build or check.",
      "Abstract: names an intent or a quality but no behaviour, actor, object or threshold.",
      "Partly concrete: names the behaviour or object but leaves actor, trigger, threshold or scope open, so builders would differ.",
      "Concrete: one behaviour or condition competent builders would build and check the same way; minor details are open.",
      "Grounded: every actor, trigger, object and threshold needed to build and check it is stated. {grounded}",
    ],
    slice: nodeSlice(c),
    benign: 4,
    defect: "specificity",
    policy: [harm(c, "0", "specificity"), harm(c, "1", "specificity"), harm(c, "2", "specificity"), { answer: "3", level: "pass" }, { answer: "4", level: "pass" }],
    next: [{ maxScore: 2, ask: whichOf("specificity") }],
    ...(c.nodeByKind && { byKind: c.nodeByKind }),
    ...(c.passFrom && Object.keys(c.passFrom).length && { passFrom: c.passFrom }),
  }),
  "text.unmeasurable": (c) => ({
    ...V1["text.unmeasurable"](c.fields),
    text: `${V1["text.unmeasurable"](c.fields).text} {testable}`,
    ...worded(c),
    defect: "testability.unmeasurable",
    policy: [{ answer: "yes", level: "pass" }, harm(c, "no", "testability.unmeasurable")],
    next: [{ answer: "no", ask: whichOf("testability.unmeasurable") }],
  }),
  "criterion.unfalsifiable": (c) => ({
    ...V1["criterion.unfalsifiable"](c.fields),
    text: `${V1["criterion.unfalsifiable"](c.fields).text} {testable}`,
    ...worded(c),
    defect: "testability.unfalsifiable",
    policy: [{ answer: "no", level: "pass" }, harm(c, "yes", "testability.unfalsifiable")],
    next: [{ answer: "yes", ask: whichOf("testability.unfalsifiable") }],
  }),
  "node.purpose": (c) => ({
    id: "node.purpose",
    answer: "choice",
    text: "Does state.subject serve the stated purpose? Its statement is state.candidate.text; the purpose is in state.nodes "
      + "or state.parents. Judge whether it advances that purpose for its intended beneficiaries, not whether it is well written.",
    choices: ["on-purpose", "implied", "off-purpose"],
    criteria: {
      "on-purpose": "It directly advances the stated purpose for the intended beneficiaries.",
      implied: "It supports the purpose indirectly, as a reasonable enabler or safeguard of something that does.",
      "off-purpose": "It serves another goal or beneficiary, or goes beyond the purpose's stated scope.",
    },
    slice: { ...nodeSlice(c), ...(c.anchors.length && { anchors: c.anchors }) },
    benign: "on-purpose",
    defect: "coherence.purposeDrift",
    policy: [{ answer: "on-purpose", level: "pass" }, { answer: "implied", level: "pass" }, harm(c, "off-purpose", "coherence.purposeDrift")],
    next: [{ answer: "off-purpose", ask: whichOf("coherence.purposeDrift") }],
  }),
  "set.allHold": (c) => ({
    id: "set.allHold",
    answer: "yes-no",
    text: "Can all of state.members, the parts of state.subject, hold at once for the same system? {children} state.parents give context. "
      + "They cannot when one requires, permits or bounds what another forbids or exceeds, or when they compete for something only one can have.",
    choices: [
      "All hold: every member can be true of the same system at the same time.",
      "Not all hold: at least two members cannot both be true of the same system at once.",
    ],
    slice: setSlice(c),
    ...worded(c),
    benign: "yes",
    defect: "consistency",
    policy: [{ answer: "yes", level: "pass" }, harm(c, "no", "consistency")],
    batchWith: ["set.inconsistent", "parent.summary"],
    next: [{ answer: "no", ask: "set.member", over: "self" }],
  }),
  "set.inconsistent": (c) => ({
    id: "set.inconsistent",
    answer: "yes-no",
    text: "Is any member of state.members, the parts of state.subject, inconsistent with another member: contradicting it, "
      + "in tension with it, repeating it, depending on it in a circle, or clashing with its scope? {children}",
    choices: [
      "Inconsistent: at least one member conflicts with, repeats or circularly depends on another.",
      "Consistent: the members fit together without conflict, repetition or circularity.",
    ],
    slice: setSlice(c),
    ...worded(c),
    benign: "no",
    defect: "consistency",
    policy: [{ answer: "no", level: "pass" }, harm(c, "yes", "consistency")],
    next: [{ answer: "yes", ask: "set.member", over: "self" }],
  }),
  "parent.summary": (c) => ({
    id: "parent.summary",
    answer: "choice",
    text: "Does the description of state.subject summarise its parts, state.members, faithfully? {summary}",
    choices: ["matches", ...SUMMARY],
    criteria: {
      matches: "The description agrees with the members: it covers what they say and claims nothing they do not.",
      ...Object.fromEntries(SUMMARY.map((k) => [k, criterionOf(c, `coherence.summaryMismatch.${k}`, k)])),
    },
    slice: setSlice(c),
    ...worded(c),
    benign: "matches",
    defect: "coherence.summaryMismatch",
    policy: [{ answer: "matches", level: "pass" }, ...SUMMARY.map((k) => harm(c, k, `coherence.summaryMismatch.${k}`))],
  }),
  "set.member": (c) => ({
    id: "set.member",
    answer: "choice",
    text: "The parts of state.subject, state.members, do not all hold together. Which member is most involved in the problem?",
    choicesFrom: "members",
    choices: [NONE],
    criteria: { [NONE]: "No single member is involved; the members all hold together." },
    slice: setSlice(c),
    benign: NONE,
    defect: "consistency",
    policy: [{ answer: NONE, level: "pass" }, { answer: ANY_ANSWER, level: "info" }],
    next: [{ ask: "pair.relation", over: "pairs", minStatus: "review" }],
  }),
  "pair.relation": (c) => ({
    id: "pair.relation",
    answer: "choice",
    text: "How do state.subject and state.counterpart relate? {pairs} They are two parts of one specification; state.parents and state.nodes "
      + "give context. Pick the strongest problem that applies, compatible when there is none, unclear when the statements do not say enough.",
    choices: ["compatible", ...RELATIONS, "unclear"],
    criteria: {
      compatible: "Both statements can hold of the same system at once, and neither repeats the other.",
      ...Object.fromEntries(RELATIONS.map((k) => [k, criterionOf(c, `consistency.${k}`, k)])),
      unclear: "The statements do not say enough to tell how they relate.",
    },
    slice: pairSlice(c),
    ...worded(c),
    benign: "compatible",
    defect: "consistency",
    policy: [{ answer: "compatible", level: "pass" }, ...RELATIONS.map((k) => harm(c, k, `consistency.${k}`)), { answer: "unclear", level: "review" }],
    next: RELATIONS.map((k) => ({ answer: k, ask: whichOf(`consistency.${k}`) })),
  }),
  "sections.allHold": (c) => ({
    id: "sections.allHold",
    answer: "yes-no",
    text: "Can all the sections of state.subject, shown in state.members, hold at once for the same product? {sections} "
      + "They cannot when one requires, permits or bounds what another forbids or exceeds.",
    choices: [
      "All hold: every section can be true of the same product at the same time.",
      "Not all hold: at least two sections cannot both be true of the same product at once.",
    ],
    slice: wholeSlice(c),
    benign: "yes",
    defect: "consistency",
    policy: [{ answer: "yes", level: "pass" }, harm(c, "no", "consistency")],
    batchWith: ["sections.inconsistent", "sections.which"],
    next: [{ answer: "no", ask: "sections.section", over: "self" }],
  }),
  "sections.inconsistent": (c) => ({
    id: "sections.inconsistent",
    answer: "yes-no",
    text: "Is any section of state.subject, shown in state.members, inconsistent with another: contradicting it, repeating it, "
      + "using its terms differently, or drifting from the purpose they share? {sections}",
    choices: [
      "Inconsistent: at least one section conflicts with, repeats or drifts from another.",
      "Consistent: the sections fit together as one specification.",
    ],
    slice: wholeSlice(c),
    benign: "no",
    defect: "consistency",
    policy: [{ answer: "no", level: "pass" }, harm(c, "yes", "consistency")],
    next: [{ answer: "yes", ask: "sections.section", over: "self" }],
  }),
  "sections.which": (c) => {
    const ds = SECTION_DEFECTS(c);
    return {
      id: "sections.which",
      answer: "choice",
      text: "Which problem best describes how the sections of state.subject, shown in state.members, fit together? Choose none when none applies.",
      choices: [...ds.map((d) => d.label), NONE],
      criteria: { ...Object.fromEntries(ds.map((d) => [d.label, cap(d.criterion)])), [NONE]: "None of the listed problems applies." },
      slice: wholeSlice(c),
      benign: NONE,
      defect: "coherence",
      policy: [{ answer: NONE, level: "pass" }, ...ds.map((d) => harm(c, d.label, d.id))],
      next: [{ ask: "sections.section", over: "self" }],
    };
  },
  "sections.section": (c) => ({
    id: "sections.section",
    answer: "choice",
    text: "The sections of state.subject, shown in state.members, do not fit together. Which section is most involved in the problem?",
    choicesFrom: "sections",
    choices: [NONE],
    criteria: { [NONE]: "No single section is involved; the sections fit together." },
    slice: wholeSlice(c),
    benign: NONE,
    defect: "consistency",
    policy: [{ answer: NONE, level: "pass" }, { answer: ANY_ANSWER, level: "info" }],
    next: [{ ask: "sections.other", over: "self", minStatus: "review" }],
  }),
  "sections.other": (c) => ({
    id: "sections.other",
    answer: "choice",
    text: "Section state.candidate.from.answer of state.subject is involved in a problem across sections. Which other section in "
      + "state.members does it conflict with, repeat or drift from most?",
    choicesFrom: "sections",
    choices: [NONE],
    criteria: { [NONE]: "No other section is involved." },
    slice: wholeSlice(c),
    benign: NONE,
    defect: "consistency",
    policy: [{ answer: NONE, level: "pass" }, { answer: ANY_ANSWER, level: "info" }],
    next: [{ ask: "pair.relation", over: "sections", minStatus: "review" }],
  }),
  "term.usage": (c) => ({
    id: "term.usage",
    answer: "choice",
    text: "Is the term state.candidate.text used with one meaning across state.members, the sections of state.subject that mention it? {terms}",
    choices: ["consistent", "drift", "unclear"],
    criteria: {
      consistent: "Every use of the term means the same thing, and no other word names that thing.",
      drift: "The term means different things in different places, or different words name the same thing.",
      unclear: "The sections do not say enough to tell what the term means.",
    },
    slice: wholeSlice(c),
    benign: "consistent",
    defect: "coherence.termDrift",
    policy: [{ answer: "consistent", level: "pass" }, harm(c, "drift", "coherence.termDrift"), { answer: "unclear", level: "review" }],
    next: [{ answer: "drift", ask: whichOf("coherence.termDrift") }],
  }),
};

const WHICH_TEXT: Record<DefectScope, string> = {
  node: "Which of these problems best describes state.candidate.text, the statement of state.subject? state.parents give its context.",
  set: "Which of these problems best describes how state.members, the parts of state.subject, fit together?",
  pair: "Which of these problems best describes how state.subject and state.counterpart relate? state.parents and state.nodes give context.",
  whole: "Which of these problems best describes how state.members, the sections of state.subject, fit together?",
};

export interface GeneratedOptions {
  /** Fields every slice node keeps. Default `DEFAULT_SLICE_FIELDS`. */
  fields?: string[];
  /** Glossary kinds: each becomes a leaf under `instance.otherKind` before generation. */
  kinds?: ProbeOptions["kinds"];
  /** Relations a pair-scope slice follows one hop; default every relation. */
  probePairs?: string[];
}

/**
 * One `which:<id>` choice question per non-leaf defect: options are the children's labels plus `none`, each with the
 * child's criterion; the policy maps a child to its level and id; `next` descends into non-leaf children. Defects with
 * a deterministic rule are not asked. Glossary kinds are added as `instance.otherKind` leaves unless already present.
 */
export function generatedQuestions(defects: readonly Defect[] = DEFECTS, o: GeneratedOptions = {}): QuestionInput[] {
  const glossary = kindSettings(o.kinds);
  const all = [...defects];
  if (glossary.length && all.some((d) => d.id === OTHER_KIND)) {
    const have = new Set(all.map((d) => d.id));
    all.push(...otherKindDefects(Object.fromEntries(glossary.map(([k, s]) => [k, s.noun]))).filter((d) => !have.has(d.id)));
  }
  const c: Ctx = { fields: o.fields ?? DEFAULT_SLICE_FIELDS, defects: defectIndex(all), ...(o.probePairs?.length && { rels: o.probePairs }), anchors: [] };
  const isParent = (id: string) => all.some((d) => d.parent === id);
  return all.filter((d) => !d.deterministic && isParent(d.id)).map((d) => {
    const kids = defectChildren(d.id, all);
    return {
      id: whichOf(d.id),
      answer: "choice",
      text: `${WHICH_TEXT[d.scope]} It may have this problem: ${d.criterion} Choose the listed problem that fits best, or none.`,
      choices: [...kids.map((k) => k.label), NONE],
      criteria: { ...Object.fromEntries(kids.map((k) => [k.label, cap(k.criterion)])), [NONE]: "None of the listed problems applies." },
      slice: SLICES[d.scope](c),
      benign: NONE,
      defect: d.id,
      policy: [{ answer: NONE, level: "pass" }, ...kids.map((k) => ({ answer: k.label, level: k.level, defect: k.id }))],
      ...(kids.some((k) => !k.deterministic && isParent(k.id))
        && { next: kids.filter((k) => !k.deterministic && isParent(k.id)).map((k) => ({ answer: k.label, ask: whichOf(k.id) })) }),
    };
  });
}

type KindsInput = NonNullable<TemplateInput["kinds"]>;
const SETTING_KEYS = ["noun", "instanceOf", "grounded", "tangible", "minScore", "testable", "children", "pairs", "summary"] as const;
const WORDING_KEYS = ["instanceOf", "grounded", "testable", "children", "pairs", "summary"] as const;
const settingOf = (c: KindCriteria | Partial<KindSetting> | undefined): Partial<KindSetting> =>
  Object.fromEntries(SETTING_KEYS.filter((k) => c?.[k] !== undefined).map((k) => [k, c![k]]));

/**
 * The glossary the probe and catalogue use: per kind, the template's `criteria` (base) overridden key by key by the
 * legacy `ProbeOptions.kinds` entry. Membership (which kinds get `node.kind` and `node.tangibility`) is `override`'s
 * kinds when it is given, else every template kind whose criteria declare `noun` or `instanceOf`. A kind with only
 * set, pair or testability criteria words those questions without being probed as a glossary kind.
 */
export function kindGlossary(base: KindsInput = {}, override?: ProbeOptions["kinds"]): Record<string, KindSetting> {
  const of = (k: string, o?: Partial<KindSetting>): KindSetting => {
    const w = { ...settingOf(base[k]?.criteria), ...settingOf(o) };
    return { noun: w.noun ?? k, ...w };
  };
  if (override === undefined) {
    return Object.fromEntries(Object.entries(base)
      .filter(([, x]) => x.criteria?.noun !== undefined || x.criteria?.instanceOf !== undefined).map(([k]) => [k, of(k)]));
  }
  return Object.fromEntries(Array.isArray(override) ? override.map((k) => [k, of(k)]) : Object.entries(override).map(([k, s]) => [k, of(k, s)]));
}

/**
 * `byKind` JSON wording and `passFrom` boundaries. `base` is the template's kinds: their `criteria` are the source of
 * truth, and `kinds` (the legacy glossary) overrides them key by key. Every kind with a glossary entry or any wording
 * criterion gets a `byKind` entry. A parent kind's `pairs` is worded onto its child kinds (declared through `parents`
 * or required `completeness.children`), which words an entry pair by its first subject's kind. The parent keeps its
 * own `pairs` as `childPairs`, which words the pairs the funnel draws under it (see `toWire`'s `parentKind`).
 */
export function compileKinds(kinds?: ProbeOptions["kinds"], base: KindsInput = {}): { byKind?: Record<string, string>; passFrom?: Record<string, number> } {
  const glossary = kindGlossary(base, kinds);
  const wording = (k: string): Partial<KindSetting> => glossary[k] ?? settingOf(base[k]?.criteria);
  const pairs = new Map<string, string[]>();
  for (const [p, kind] of Object.entries(base)) {
    const text = wording(p).pairs;
    if (!text) continue;
    const kids = [...(kind.completeness?.children ?? []).map((c) => c.kind), ...Object.keys(base).filter((c) => base[c]?.parents?.includes(p))];
    for (const c of new Set(kids)) { const l = pairs.get(c) ?? []; if (!l.includes(text)) l.push(text); pairs.set(c, l); }
  }
  const worded = Object.keys(base).filter((k) => WORDING_KEYS.some((x) => x !== "pairs" && wording(k)[x] !== undefined));
  const parentsWithPairs = Object.keys(base).filter((k) => wording(k).pairs);
  const keys = [...new Set([...Object.keys(glossary), ...worded, ...pairs.keys(), ...parentsWithPairs])];
  if (!keys.length) return {};
  const word = (k: string) => {
    const w = { ...wording(k), ...(pairs.has(k) ? { pairs: pairs.get(k)!.join(" ") } : { pairs: undefined }) };
    const own = wording(k).pairs;
    return JSON.stringify({
      noun: w.noun ?? k, ...Object.fromEntries(WORDING_KEYS.filter((x) => w[x] !== undefined && w[x] !== "").map((x) => [x, w[x]])),
      ...(own && { childPairs: own }),
    });
  };
  const passFrom = Object.fromEntries(Object.entries(glossary).filter(([, s]) => s.minScore !== undefined).map(([k, s]) => [k, s.minScore!]));
  return { byKind: Object.fromEntries(keys.map((k) => [k, word(k)])), ...(Object.keys(passFrom).length && { passFrom }) };
}

/** Not-applicable option a check with `na` adds; it passes. */
export const NOT_APPLICABLE = "notApplicable";

const asked = (text: string) => text.trim().replace(/[.?!;:]+$/u, "");

/**
 * One question per non-deterministic check of the template (`kinds.<k>.checks` and `rootChecks`), id
 * `check:<owner>.<id>`, asked of the candidates checks@1 emits. The stem names the kind's noun and states the check;
 * the benign answer passes, a `notApplicable` option (with `na`) passes, and every other answer maps to the check's
 * level and defect. Node checks share the node questions' slice and children checks the set questions' slice, so the
 * funnel batches them per subject with the stage-1 questions. Deterministic checks (`pattern`) are not asked.
 */
export function checkQuestions(t: Pick<TemplateInput, "kinds" | "rootChecks">, o: { fields?: string[] } = {}): QuestionInput[] {
  const fields = o.fields ?? DEFAULT_SLICE_FIELDS;
  const owned: [string, Check][] = [
    ...Object.entries(t.kinds ?? {}).flatMap(([k, kind]) => (kind.checks ?? []).map((c): [string, Check] => [k, c])),
    ...(t.rootChecks ?? []).map((c): [string, Check] => [ROOT_OWNER, c]),
  ];
  return owned.filter(([, c]) => !isDeterministic(c)).map(([owner, c]) => {
    const noun = owner === ROOT_OWNER ? "top-level item" : t.kinds?.[owner]?.criteria?.noun ?? owner;
    const scope = checkScope(c);
    const level = (CHECK_LEVELS as readonly string[]).includes(c.level ?? "warning") ? c.level ?? "warning" : "warning";
    const defect = c.defect ?? (scope === "node" ? "instance" : "consistency");
    const sliceFields = [...new Set([...fields, checkField(c)])];
    const ctx: Ctx = { fields: sliceFields, defects: new Map(), anchors: [] };
    const slice = scope === "node" ? nodeSlice(ctx) : scope === "children" ? setSlice(ctx) : pairSlice(ctx);
    const criterion = asked(c.text);
    const stem = scope === "node"
      ? `Does state.subject, a ${noun}, satisfy this criterion: ${criterion}? Its statement is state.candidate.text; state.parents give its context.`
      : scope === "children"
        ? `Do the members state.members of state.subject, a ${noun}, together satisfy: ${criterion}? state.parents give context.`
        : `Do state.subject and state.counterpart, two parts of a ${noun}, together satisfy: ${criterion}? state.parents and state.nodes give context.`;
    const na = c.na ? ` Answer ${NOT_APPLICABLE} when the criterion does not apply to ${scope === "node" ? "it" : "them"}.` : "";
    const harmful = (answer: string) => ({ answer, level, defect });
    const naPolicy = c.na ? [{ answer: NOT_APPLICABLE, level: "pass" }] : [];
    const naCriterion: Record<string, string> = c.na ? { [NOT_APPLICABLE]: "The criterion does not apply here." } : {};
    const id = checkRule(owner, c.id);
    const answer = c.answer ?? "yes-no";
    if (answer === "score") {
      const choices = c.choices?.length ? c.choices : ["Not at all.", "Partly.", "Fully."];
      const benign = Number(c.benign ?? choices.length - 1);
      return {
        id, answer, text: `${stem} Score how fully it does.${na}`, choices, slice, benign, defect,
        policy: choices.map((_, i) => (i >= benign ? { answer: String(i), level: "pass" } : harmful(String(i)))),
      };
    }
    if (answer === "choice" || c.na) {
      const choices = answer === "choice" && c.choices?.length ? c.choices : ["yes", "no"];
      const benign = String(c.benign ?? choices[0]);
      return {
        id, answer: "choice", text: `${stem}${na}`, choices: [...choices, ...(c.na ? [NOT_APPLICABLE] : [])],
        criteria: <Record<string, string>>{
          ...(answer === "choice" ? {} : { yes: `It satisfies the criterion: ${cap(criterion, 200)}.`, no: `It does not satisfy the criterion: ${cap(criterion, 200)}.` }),
          ...naCriterion,
        },
        slice, benign, defect,
        policy: [...choices.map((x) => (x === benign ? { answer: x, level: "pass" } : harmful(x))), ...naPolicy],
      };
    }
    const benign = c.benign ?? "yes";
    return {
      id, answer, text: stem,
      choices: [cap(`Satisfies: ${criterion}.`), cap(`Does not satisfy: ${criterion}.`)],
      slice, benign, defect,
      policy: [{ answer: String(benign), level: "pass" }, harmful(benign === "yes" || benign === true ? "no" : "yes")],
    };
  });
}

const ROOT_TOKEN = /\{(sections|terms)\}/g;
/** Fills the root tokens from the template's root criteria; an absent criterion leaves the generic stem unchanged. */
const fillRoot = (q: QuestionInput, r?: RootCriteria): QuestionInput =>
  !q.text || !new RegExp(ROOT_TOKEN.source).test(q.text) ? q
    : { ...q, text: q.text.replace(ROOT_TOKEN, (_, k: keyof RootCriteria) => r?.[k] ?? "").replace(/[ \t]{2,}/g, " ").trim() };

/** The catalogue entries to add to a template's `questions`: v2 hand-written entries, or v1 with `version: "1"`. */
export function semanticCatalogue(o: CatalogueOptions & { version?: "1" | "2" } = {}): QuestionInput[] {
  const fields = o.fields ?? DEFAULT_SLICE_FIELDS;
  if (o.version === "1") return ((o.rules ?? SEMANTIC_RULES_V1) as readonly string[]).filter((r): r is SemanticRuleV1 => r in V1).map((r) => V1[r](fields));
  const compiled = compileKinds(o.kinds, o.base);
  const members = new Set(Object.keys(kindGlossary(o.base, o.kinds)));
  const nodeByKind = compiled.byKind && Object.fromEntries(Object.entries(compiled.byKind).filter(([k]) => members.has(k)));
  const c: Ctx = {
    fields, defects: defectIndex(o.tree ?? DEFECTS), ...compiled, ...(nodeByKind && Object.keys(nodeByKind).length && { nodeByKind }),
    ...(o.root && { root: o.root }),
    ...(o.probePairs?.length && { rels: o.probePairs }), anchors: o.purposeAnchors ?? ["purpose"],
  };
  return ((o.rules ?? SEMANTIC_RULES) as readonly string[]).filter((r): r is SemanticRuleV2 => r in V2).map((r) => fillRoot(V2[r](c), c.root));
}

export const SEMANTIC_CATALOGUE: QuestionInput[] = semanticCatalogue();
export const SEMANTIC_CATALOGUE_V1: QuestionInput[] = semanticCatalogue({ version: "1" });

export type SemanticProbeOptions = ProbeOptions & CatalogueOptions & {
  /** v2: template overrides of defects@1, merged with the template's own `defects` (these win per id). */
  defects?: Partial<DefectsConfig>;
};

/**
 * Adds the catalogue and the configured `semantic.probe` pack to a template source. Questions and packs the template
 * already declares under the same id win, so a template can override one entry.
 *
 * v2 (default) also merges `defects` into the template's, appends `generatedQuestions` for the merged tree with the
 * glossary's `instance.otherKind` leaves, and prunes what a disabled defect leaves dangling: a question whose own
 * defect is disabled is dropped, a policy entry for a disabled defect passes, and `next`/`batchWith` references to
 * dropped questions are removed. `node.purpose` is left out when no `purposeKinds` are set.
 */
export function withSemanticProbes(t: TemplateInput, given: SemanticProbeOptions = {}): TemplateInput {
  const own = new Set((t.questions ?? []).map((q) => q.id));
  // v2 reads the ontology's own criteria: the template's kinds are the glossary base, the options' glossary overrides.
  const glossary = given.version === "1" ? undefined : kindGlossary(t.kinds, given.kinds);
  const o: SemanticProbeOptions = glossary === undefined ? given
    : { ...given, ...(Object.keys(glossary).length || given.kinds !== undefined ? { kinds: glossary } : {}), base: t.kinds ?? {}, ...(t.rootCriteria && { root: t.rootCriteria }) };
  const pack = semanticProbe(o);
  const rules = (t.rules ?? []).some((r) => r.id === pack.id) ? t.rules : [...(t.rules ?? []), pack];
  if (o.version === "1") {
    const v1 = [...semanticCatalogue({ ...o, version: "1" }), ...checkQuestions(t, { ...(o.fields && { fields: o.fields }) })];
    return { ...t, questions: [...(t.questions ?? []), ...v1.filter((q) => !own.has(q.id))], rules };
  }

  const cfg: DefectsConfig = {
    disable: [...new Set([...(t.defects?.disable ?? []), ...(o.defects?.disable ?? [])])],
    levels: { ...(t.defects?.levels ?? {}), ...(o.defects?.levels ?? {}) },
  };
  const base = [...DEFECTS, ...otherKindDefects(Object.fromEntries(kindSettings(o.kinds).map(([k, s]) => [k, s.noun])))];
  const { defects } = mergeDefects(base, cfg);
  const live = new Set(defects.map((d) => d.id));
  const known = new Set(base.map((d) => d.id));
  const off = (id: string | undefined) => id !== undefined && known.has(id) && !live.has(id);

  const fields = o.fields ?? DEFAULT_SLICE_FIELDS;
  const rulesWanted = (o.rules ?? SEMANTIC_RULES).filter((r) => r !== "node.purpose" || (o.purposeKinds ?? []).length > 0);
  const hand = semanticCatalogue({ ...o, rules: rulesWanted, tree: defects, version: "2" });
  const gen = generatedQuestions(defects, { fields, ...(o.probePairs && { probePairs: o.probePairs }) });
  const added = [...hand, ...gen, ...checkQuestions(t, { fields })].filter((q) => !own.has(q.id) && !off(q.defect));
  const ids = new Set([...own, ...added.map((q) => q.id)]);
  const pruned = added.map((q) => {
    const next = q.next?.filter((n) => ids.has(n.ask));
    const batchWith = q.batchWith?.filter((b) => ids.has(b));
    return {
      ...q,
      policy: q.policy.map((p) => (off(p.defect) ? { answer: p.answer, level: "pass" } : p)),
      ...(q.next && { next }),
      ...(q.batchWith && { batchWith }),
    };
  });
  return { ...t, questions: [...(t.questions ?? []), ...pruned], rules, defects: cfg };
}
