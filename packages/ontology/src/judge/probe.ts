import type { RulePack } from "../meta/schema.ts";

/**
 * A rule whose id starts with `pair.` judges two nodes. The dialect cannot build strings, so the pack emits
 * `semanticCandidate(Rule, A, B)` with the second node id in the text column and `A < B`; `judge` joins them into
 * the subject `A|B` and `buildSlice` resolves both.
 */
export const PAIR_PREFIX = "pair.";
export const PAIR_SEPARATOR = "|";

/** Glossary wording for one kind: what to call it, what a genuine instance is, and what a grounded one looks like. */
export interface KindSetting {
  noun: string;
  instanceOf?: string;
  grounded?: string;
  /** False for section-like kinds: no `node.tangibility` candidate. Default true. */
  tangible?: boolean;
  /** Lowest passing `node.tangibility` score for this kind (default: the policy's, 3). */
  minScore?: number;
  /** What makes a statement of this kind checkable (see the meta@1 kind `criteria`). */
  testable?: string;
  /** What the children of a node of this kind must jointly satisfy. */
  children?: string;
  /** What a compatible pair of children of this kind looks like. */
  pairs?: string;
  /** What the description of a node of this kind must say about its children. */
  summary?: string;
}

export interface ProbeOptions {
  /** `"1"` is the v1 pack (vague, unmeasurable, unfalsifiable, sibling and relation contradiction); default `"2"`. */
  version?: "1" | "2";
  /** v2: the glossary. Nodes of these kinds are asked `node.kind`, and `node.tangibility` unless `tangible: false`. */
  kinds?: Record<string, KindSetting> | string[];
  /** v2: kinds whose nodes with at least two texted children are asked `set.allHold`; `["*"]` is every kind. Default none. */
  sets?: string[];
  /** v2: a root with at least two children is asked `sections.allHold` (and is then not also a set). Default false. */
  sections?: boolean;
  /** v2: kinds asked `node.purpose`. Default none. */
  purposeKinds?: string[];
  /** Fields whose values are statements to probe; each list element is its own statement. Default `["description"]`. */
  texts?: string[];
  /** Kinds asked `text.unmeasurable`. Default outcome, claim and criterion. */
  measurable?: string[];
  /** Kinds asked `criterion.unfalsifiable`. Default criterion. */
  criteria?: string[];
  /** Relations whose two ends are asked `pair.contradiction` (v1) or `pair.relation` (v2). Default none. */
  probePairs?: string[];
  /** v1: kinds whose children of one parent are paired; `["*"]` is every kind. Default every kind. */
  siblings?: string[];
}

const str = (s: string) => JSON.stringify(s);
/** An empty option still emits `""`, which names no field, kind or relation, so `meta@1` sees the relation emitted. */
const facts = (rel: string, xs: readonly string[]) => (xs.length ? xs : [""]).map((x) => `${rel}(${str(x)}).`).join("\n");

/** The generic part of `semantic.probe@1`; the options become facts appended to it. */
export const PROBE_SOURCE = `
% semantic.probe@1 - emits candidates for the reusable semantic questions. A rule fires only when the template
% declares the question, so a template enables rules through its questions.
.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl question(Id: sym, Answer: sym)
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output

.decl probeText(Field: sym)
.decl probeMeasurable(Kind: sym)
.decl probeCriterion(Kind: sym)
.decl probePair(Rel: sym)
.decl probeSibling(Kind: sym)
.decl probeStatement(Node: sym, Text: sym)
.decl probeTexted(Node: sym)
.decl probeSiblingKind(Kind: sym)
.decl probePaired(A: sym, B: sym)

.message "text.vague" "{1} may be too vague to act on or verify: {2}"
.message "text.unmeasurable" "{1} may not be measurable as stated: {2}"
.message "criterion.unfalsifiable" "Criterion {1} may be unfalsifiable: {2}"
.message "pair.contradiction" "{1} and {2} may contradict each other."

probeStatement(N,T) :- probeText(F), field(N,F,T), T != "".
probeTexted(N) :- probeStatement(N,_).

semanticCandidate("text.vague",N,T) :- question("text.vague",_), probeStatement(N,T).
semanticCandidate("text.unmeasurable",N,T) :- question("text.unmeasurable",_), probeStatement(N,T), node(N,K,_), probeMeasurable(K).
semanticCandidate("criterion.unfalsifiable",N,T) :- question("criterion.unfalsifiable",_), probeStatement(N,T), node(N,K,_), probeCriterion(K).

probeSiblingKind(K) :- probeSibling("*"), node(_,K,_).
probeSiblingKind(K) :- probeSibling(K).
probePaired(A,B) :- probePair(R), link(A,R,B,_), A != B, probeTexted(A), probeTexted(B).
probePaired(A,B) :- probeTexted(A), node(A,KA,P), P != "", probeSiblingKind(KA), probeTexted(B), node(B,KB,P), probeSiblingKind(KB), A != B.

semanticCandidate("pair.contradiction",A,B) :- question("pair.contradiction",_), probePaired(A,B), A < B.
semanticCandidate("pair.contradiction",B,A) :- question("pair.contradiction",_), probePaired(A,B), B < A.
`;

/** The stage-1 entry questions: the only rules `semantic.probe@2` emits candidates for; the funnel asks the rest. */
export const PROBE_RULES_V2 = [
  "node.kind", "node.tangibility", "text.unmeasurable", "criterion.unfalsifiable", "node.purpose", "set.allHold", "sections.allHold", "pair.relation",
] as const;

/**
 * `semantic.probe@2`: stage-1 candidates only. Node questions get one candidate per statement; a set is a parent of a
 * `probeSetKind` with at least two texted children; the sections root is a root with at least two children when
 * `probeSections("on")`, and is then not also a set; pairs are the two ends of a `probePair` relation, smaller id first.
 * Companion questions (`batchWith`) and follow-ups (`next`) raise no candidate here.
 */
export const PROBE_SOURCE_V2 = `
% semantic.probe@2 - emits stage-1 candidates for the judgment funnel. A rule fires only when the template declares
% the question, so a template enables rules through its questions.
.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl question(Id: sym, Answer: sym)
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output

.decl probeText(Field: sym)
.decl probeKind(Kind: sym)
.decl probeTangible(Kind: sym)
.decl probeMeasurable(Kind: sym)
.decl probeCriterion(Kind: sym)
.decl probePurpose(Kind: sym)
.decl probeSetKind(Kind: sym)
.decl probeSections(On: sym)
.decl probePair(Rel: sym)
.decl probeStatement(Node: sym, Text: sym)
.decl probeTexted(Node: sym)
.decl probeSetKindOf(Kind: sym)
.decl probeMember(Parent: sym, Child: sym)
.decl probeSectionRoot(Root: sym)
.decl probeSet(Parent: sym)
.decl probePaired(A: sym, B: sym)

.message "node.kind" "{1} may not be a genuine instance of its kind: {2}"
.message "node.tangibility" "{1} may be too abstract to act on: {2}"
.message "text.unmeasurable" "{1} may not be measurable as stated: {2}"
.message "criterion.unfalsifiable" "Criterion {1} may be unfalsifiable: {2}"
.message "node.purpose" "{1} may not serve the stated purpose: {2}"
.message "set.allHold" "The parts of {1} may not all hold at once."
.message "sections.allHold" "The sections of {1} may not all hold at once."
.message "pair.relation" "{1} and {2} may conflict, repeat or depend on each other."

probeStatement(N,T) :- probeText(F), field(N,F,T), T != "".
probeTexted(N) :- probeStatement(N,_).

semanticCandidate("node.kind",N,T) :- question("node.kind",_), probeStatement(N,T), node(N,K,_), probeKind(K).
semanticCandidate("node.tangibility",N,T) :- question("node.tangibility",_), probeStatement(N,T), node(N,K,_), probeTangible(K).
semanticCandidate("text.unmeasurable",N,T) :- question("text.unmeasurable",_), probeStatement(N,T), node(N,K,_), probeMeasurable(K).
semanticCandidate("criterion.unfalsifiable",N,T) :- question("criterion.unfalsifiable",_), probeStatement(N,T), node(N,K,_), probeCriterion(K).
semanticCandidate("node.purpose",N,T) :- question("node.purpose",_), probeStatement(N,T), node(N,K,_), probePurpose(K).

probeSectionRoot(R) :- probeSections("on"), node(R,_,""), N = count : node(_,_,R), N >= 2.
probeSetKindOf(K) :- probeSetKind("*"), node(_,K,_).
probeSetKindOf(K) :- probeSetKind(K).
probeMember(P,C) :- node(C,_,P), P != "", probeTexted(C).
probeSet(P) :- node(P,K,_), probeSetKindOf(K), not probeSectionRoot(P), N = count : probeMember(P,_), N >= 2.
semanticCandidate("set.allHold",P,"") :- question("set.allHold",_), probeSet(P).
semanticCandidate("sections.allHold",R,"") :- question("sections.allHold",_), probeSectionRoot(R).

probePaired(A,B) :- probePair(R), link(A,R,B,_), A != B, probeTexted(A), probeTexted(B).
semanticCandidate("pair.relation",A,B) :- question("pair.relation",_), probePaired(A,B), A < B.
semanticCandidate("pair.relation",B,A) :- question("pair.relation",_), probePaired(A,B), B < A.
`;

type V1Options = Required<Pick<ProbeOptions, "texts" | "measurable" | "criteria" | "probePairs" | "siblings">>;

export const PROBE_DEFAULTS: V1Options = {
  texts: ["description"],
  measurable: ["outcome", "claim", "criterion"],
  criteria: ["criterion"],
  probePairs: [],
  siblings: ["*"],
};

/** The glossary as `[kind, setting]` pairs; a plain list names kinds whose noun is the kind itself. */
export const kindSettings = (kinds: ProbeOptions["kinds"] = {}): [string, KindSetting][] =>
  Array.isArray(kinds) ? kinds.map((k) => [k, { noun: k }]) : Object.entries(kinds);

/** `semantic.probe@2` (default) or `@1` (`version: "1"`) configured for one vocabulary. */
export function semanticProbe(o: ProbeOptions = {}): RulePack {
  if (o.version === "1") return semanticProbeV1(o);
  const glossary = kindSettings(o.kinds);
  const options = [
    "% options",
    facts("probeText", o.texts ?? PROBE_DEFAULTS.texts),
    facts("probeKind", glossary.map(([k]) => k)),
    facts("probeTangible", glossary.filter(([, s]) => s.tangible !== false).map(([k]) => k)),
    facts("probeMeasurable", o.measurable ?? PROBE_DEFAULTS.measurable),
    facts("probeCriterion", o.criteria ?? PROBE_DEFAULTS.criteria),
    facts("probePurpose", o.purposeKinds ?? []),
    facts("probeSetKind", o.sets ?? []),
    facts("probeSections", [o.sections ? "on" : ""]),
    facts("probePair", o.probePairs ?? PROBE_DEFAULTS.probePairs),
  ].join("\n");
  return { id: "semantic.probe", version: "2", source: `${PROBE_SOURCE_V2}\n${options}\n` };
}

/** `semantic.probe@1` configured for one vocabulary. */
export function semanticProbeV1(o: ProbeOptions = {}): RulePack {
  const c: V1Options = {
    texts: o.texts ?? PROBE_DEFAULTS.texts,
    measurable: o.measurable ?? PROBE_DEFAULTS.measurable,
    criteria: o.criteria ?? PROBE_DEFAULTS.criteria,
    probePairs: o.probePairs ?? PROBE_DEFAULTS.probePairs,
    siblings: o.siblings ?? PROBE_DEFAULTS.siblings,
  };
  const options = [
    "% options",
    facts("probeText", c.texts), facts("probeMeasurable", c.measurable), facts("probeCriterion", c.criteria),
    facts("probePair", c.probePairs), facts("probeSibling", c.siblings),
  ].join("\n");
  return { id: "semantic.probe", version: "1", source: `${PROBE_SOURCE}\n${options}\n` };
}
