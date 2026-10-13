import { describe, expect, it } from "vitest";
import {
  compileKinds, DEFAULT_LIMITS, evaluate, evaluateAndJudge, fakeExplainer, fakeSystemOne, judge, loadTemplate, probeTextsOf, reconcileParents, S1Error, sortTotal,
  type Track,
  toWire, type Explainer, type Finding, type Graph, type Readiness, type S1Questions, type SystemOne,
} from "../../src/index.ts";

/** A tiny pack that raises stage-1 candidates only for the questions the template declares. */
const PACK = `
.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl question(Id: sym, Answer: sym)
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output
semanticCandidate("set.allHold",S,T) :- question("set.allHold",_), node(S,"section",_), field(S,"description",T), node(A,"rule",S), node(B,"rule",S), A < B.
semanticCandidate("sections.allHold",P,T) :- question("sections.allHold",_), node(P,"purpose",_), field(P,"description",T), node(A,"section",P), node(B,"section",P), A < B.
semanticCandidate("rule.vague",R,T) :- question("rule.vague",_), node(R,"rule",_), field(R,"description",T).
semanticCandidate("rule.strict",R,T) :- question("rule.strict",_), node(R,"rule",_), field(R,"description",T).
semanticCandidate("rule.clarity",R,T) :- question("rule.clarity",_), node(R,"rule",_), field(R,"description",T).
`;

type Q = Record<string, unknown>;
const members = { children: true, kinds: ["rule"] };
const yesNo = (id: string, benign: "yes" | "no", o: Q = {}): Q => ({
  id, answer: "yes-no", benign,
  policy: [{ answer: benign, level: "pass" }, { answer: benign === "yes" ? "no" : "yes", level: "warning" }], ...o,
});
const SET_ALL_HOLD = yesNo("set.allHold", "yes", {
  text: "Can all of state.members hold at once?", slice: members, defect: "consistency", batchWith: ["set.inconsistent"],
  next: [{ answer: "no", ask: "set.member" }],
});
const SET_INCONSISTENT = yesNo("set.inconsistent", "no", {
  text: "Is any member inconsistent with another?", slice: members, next: [{ answer: "yes", ask: "set.member" }],
});
const SET_SUMMARY: Q = {
  id: "set.summary", answer: "choice", choices: ["matches", "contradicts"], slice: members, benign: "matches", defect: "coherence.summaryMismatch",
  policy: [{ answer: "matches", level: "pass" }, { answer: "contradicts", level: "warning", defect: "coherence.summaryMismatch.contradicts" }],
};
const SET_MEMBER = (next: Q[] = [{ ask: "pair.relation", over: "pairs" }]): Q => ({
  id: "set.member", answer: "choice", choicesFrom: "members", choices: ["none"], slice: members, benign: "none",
  policy: [{ answer: "none", level: "pass" }, { answer: "*", level: "info" }], next,
});
const PAIR_RELATION: Q = {
  id: "pair.relation", answer: "choice", choices: ["compatible", "contradiction", "tension"], benign: "compatible",
  policy: [
    { answer: "compatible", level: "pass" },
    { answer: "contradiction", level: "error", defect: "consistency.contradiction" },
    { answer: "tension", level: "warning", defect: "consistency.tension" },
  ],
  next: [{ answer: "contradiction", ask: "which:consistency.contradiction" }],
};
const WHICH: Q = {
  id: "which:consistency.contradiction", answer: "choice", choices: ["modal", "quantity", "none"], benign: "none",
  policy: [
    { answer: "modal", level: "error", defect: "consistency.contradiction.modal" },
    { answer: "quantity", level: "error", defect: "consistency.contradiction.quantity" },
    { answer: "none", level: "pass" },
  ],
};
const SET_QUESTIONS = (member = SET_MEMBER()) => [SET_ALL_HOLD, SET_INCONSISTENT, member, PAIR_RELATION, WHICH];

const RULE_DETAIL = yesNo("rule.detail", "no", { text: "Does the rule leave out who, when or how much?" });
const RULE_VAGUE = yesNo("rule.vague", "no", { defect: "specificity", next: [{ answer: "yes", minStatus: "review", ask: "rule.detail" }] });
const RULE_STRICT = yesNo("rule.strict", "no", { defect: "specificity", next: [{ answer: "yes", ask: "rule.detail" }] });
const RULE_CLARITY: Q = {
  id: "rule.clarity", answer: "score", choices: ["opaque", "vague", "partial", "clear", "exact"], benign: 4, defect: "specificity",
  policy: [0, 1, 2].map((answer) => ({ answer, level: "warning" })).concat([3, 4].map((answer) => ({ answer, level: "pass" }))),
  next: [{ maxScore: 1, ask: "rule.detail" }],
};

const sectionsSlice = { children: true, kinds: ["section"] };
const WHOLE: Q[] = [
  yesNo("sections.allHold", "yes", { slice: sectionsSlice, defect: "consistency", batchWith: ["sections.inconsistent"], next: [{ answer: "no", ask: "sections.section" }] }),
  yesNo("sections.inconsistent", "no", { slice: sectionsSlice }),
  {
    id: "sections.section", answer: "choice", choicesFrom: "sections", choices: ["none"], slice: sectionsSlice, benign: "none",
    policy: [{ answer: "none", level: "pass" }, { answer: "*", level: "info" }], next: [{ ask: "sections.other" }],
  },
  {
    id: "sections.other", answer: "choice", choicesFrom: "sections", choices: ["none"], slice: sectionsSlice, benign: "none",
    policy: [{ answer: "none", level: "pass" }, { answer: "*", level: "info" }],
    next: [{ ask: "pair.relation", over: "sections" }, { ask: "pair.relation", over: "crossPairs" }],
  },
  {
    id: "term.usage", answer: "choice", choices: ["consistent", "drift"], slice: sectionsSlice, benign: "consistent",
    policy: [{ answer: "consistent", level: "pass" }, { answer: "drift", level: "warning", defect: "coherence.termDrift" }],
  },
];

const template = (questions: Q[]) => loadTemplate({
  id: "template.test.funnel", version: 1, meta: 1,
  kinds: {
    purpose: { fields: [{ name: "title", type: "string" }, { name: "description", type: "string" }] },
    section: { parents: ["purpose"], fields: [{ name: "title", type: "string" }, { name: "description", type: "string" }] },
    rule: { parents: ["section"], fields: [{ name: "title", type: "string" }, { name: "description", type: "string" }] },
  },
  rules: [{ id: "funnel", version: "1", source: PACK }],
  questions,
});

type Rules = Record<string, string>;
const graph = (sections: Record<string, { description: string; rules: Rules }>): Graph => ({
  template: "template.test.funnel@1",
  nodes: [
    { id: "p", kind: "purpose", fields: { title: "Exports", description: "Let admins export data safely." } },
    ...Object.entries(sections).flatMap(([s, { description, rules }]) => [
      { id: s, kind: "section", parent: "p", fields: { description } },
      ...Object.entries(rules).map(([id, d]) => ({ id, kind: "rule", parent: s, fields: { description: d } })),
    ]),
  ],
  links: [], declarations: [], evidence: [],
});

const FLAGGED = "Export approval rules. #s1:set.allHold=no #s1:set.inconsistent=yes";
const RULES: Rules = {
  r1: "Admins must always approve exports.",
  r2: "Admins must never approve exports. #s1:pair.relation=contradiction #s1:which:consistency.contradiction=modal",
  r3: "Exports are logged.",
};

/** The fake provider, recording the question ids and state of every call. */
const recording = (inner: SystemOne = fakeSystemOne()) => {
  const asks: string[][] = [];
  const states: Record<string, unknown>[] = [];
  const wires: S1Questions[] = [];
  const s1: SystemOne = {
    mode: inner.mode, model: inner.model,
    ask: (state, qs: S1Questions, o) => { asks.push(Object.keys(qs)); states.push(state as Record<string, unknown>); wires.push(qs); return inner.ask(state, qs, o); },
  };
  return { s1, asks, states, wires };
};
const spyExplainer = (inner: Explainer = fakeExplainer()) => {
  const calls: unknown[] = [];
  const e: Explainer = { mode: inner.mode, model: inner.model, explain: (state, req, o) => { calls.push(req); return inner.explain(state, req, o); } };
  return { e, calls };
};
const find = (r: Readiness, rule: string, subject: string): Finding => {
  const f = r.findings.find((x) => x.rule === `semantic:${rule}` && x.subject === subject);
  if (!f) throw new Error(`no ${rule} on ${subject}`);
  return f;
};

describe("funnel", () => {
  it("narrows a flagged set to a member pair and a contradiction leaf", async () => {
    const { s1, asks } = recording();
    const { e, calls } = spyExplainer();
    const g = graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } });
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), g, s1, { explainer: e });

    const leaf = find(r, "pair.relation", "r1|r2");
    expect(leaf).toMatchObject({
      level: "error",
      judgment: { question: "which:consistency.contradiction", status: "confident", answer: "modal", defect: "consistency.contradiction.modal" },
      provenance: { round: 4, stage: "self", explained: { provider: "fake", model: "fake" } },
    });
    expect(leaf.judgment!.path!.map((s) => [s.question, s.subject, s.answer])).toEqual([
      ["set.allHold", "s1", "no"], ["set.member", "s1", "r1"], ["pair.relation", "r1|r2", "contradiction"], ["which:consistency.contradiction", "r1|r2", "modal"],
    ]);
    expect(leaf.judgment!.explanation).toMatchObject({ text: expect.stringContaining("consistency.contradiction.modal"), provider: "fake" });
    expect(calls).toEqual([{ defect: "consistency.contradiction.modal", question: "which:consistency.contradiction", answer: "modal", subjects: ["r1", "r2"] }]);

    expect(find(r, "pair.relation", "r1|r3")).toMatchObject({ level: "pass", judgment: { status: "confident", answer: "compatible" } });
    const parent = find(r, "set.allHold", "s1");
    expect(parent).toMatchObject({
      level: "info", judgment: { question: "set.allHold", answer: "no", defect: "consistency", narrowedBy: ["consistency.contradiction.modal@r1|r2"] },
      provenance: { round: 1, stage: "entry", batch: { size: 2 } },
    });
    expect(parent.judgment!.path!.map((s) => s.question)).toEqual(["set.allHold", "set.member"]);

    expect(asks).toEqual([["set.allHold", "set.inconsistent"], ["set.member"], ["pair.relation"], ["pair.relation"], ["which:consistency.contradiction"]]);
    expect(r.judgments).toEqual({ confident: 3, review: 0, unknown: 0, calls: 5, rounds: 4, gated: 0, budget: "ok", explained: 1 });
    expect(r.buildable).toBe(false);
  });

  it("a flagged set whose pairs all pass ends in review, and nothing is explained", async () => {
    const { e, calls } = spyExplainer();
    const rules = { ...RULES, r2: "Admins must never approve exports." };
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules } }), fakeSystemOne(), { explainer: e });
    expect(find(r, "set.allHold", "s1")).toMatchObject({ level: "review", judgment: { status: "confident", answer: "no" } });
    expect(find(r, "pair.relation", "r1|r2")).toMatchObject({ level: "pass" });
    expect(find(r, "pair.relation", "r1|r3")).toMatchObject({ level: "pass" });
    expect(calls).toHaveLength(0);
    expect(r.judgments.explained).toBe(0);
  });

  it("a set the model clears passes without follow-ups", async () => {
    const { s1, asks } = recording();
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), graph({ s1: { description: "Export approval rules.", rules: RULES } }), s1);
    const f = find(r, "set.allHold", "s1");
    expect(f).toMatchObject({ level: "pass", judgment: { status: "confident", answer: "yes", path: [{ question: "set.allHold" }] } });
    // A passing answer stands for no defect, though the question declares one.
    expect(f.judgment!.defect).toBeUndefined();
    expect(f.judgment!.path![0]!.defect).toBeUndefined();
    expect(asks).toEqual([["set.allHold", "set.inconsistent"]]);
    expect(r.buildable).toBe(true);
  });

  it("follows a polarity partner's own next when the primary has none", async () => {
    const { s1, asks } = recording();
    const allHold = { ...SET_ALL_HOLD, next: undefined };
    const r = await evaluateAndJudge(template([allHold, SET_INCONSISTENT, SET_MEMBER(), PAIR_RELATION, WHICH]),
      graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } }), s1);
    expect(asks.filter((a) => a.includes("set.member"))).toEqual([["set.member"]]);
    const parent = find(r, "set.allHold", "s1");
    expect(parent.judgment!.path!.map((s) => s.question)).toEqual(["set.allHold", "set.member"]);
    expect(parent.judgment!.narrowedBy).toEqual(["consistency.contradiction.modal@r1|r2"]);
  });

  it("a non-polarity companion that does not pass becomes a finding of its own", async () => {
    const allHold = { ...SET_ALL_HOLD, batchWith: ["set.inconsistent", "set.summary"] };
    const questions = [allHold, SET_INCONSISTENT, SET_SUMMARY, SET_MEMBER(), PAIR_RELATION, WHICH];
    const { s1, asks } = recording();
    const r = await evaluateAndJudge(template(questions), graph({ s1: { description: "Export rules. #s1:set.summary=contradicts", rules: RULES } }), s1);
    expect(asks).toEqual([["set.allHold", "set.inconsistent", "set.summary"]]);
    expect(find(r, "set.summary", "s1")).toMatchObject({
      level: "warning",
      judgment: { question: "set.summary", status: "confident", answer: "contradicts", defect: "coherence.summaryMismatch.contradicts" },
      provenance: { stage: "companion", batch: { size: 3 } },
    });
    expect(find(r, "set.allHold", "s1").level).toBe("pass");
    const clean = await evaluateAndJudge(template(questions), graph({ s1: { description: "Export rules.", rules: RULES } }), fakeSystemOne());
    expect(clean.findings.some((f) => f.rule === "semantic:set.summary")).toBe(false);
    expect(clean.buildable).toBe(true);
  });

  it("parent.summary=contradicts settles as an error finding and walks its which: follow-up", async () => {
    const summary: Q = {
      id: "parent.summary", answer: "choice", choices: ["matches", "omits", "contradicts"], slice: members, benign: "matches",
      defect: "coherence.summaryMismatch",
      policy: [
        { answer: "matches", level: "pass" },
        { answer: "omits", level: "warning", defect: "coherence.summaryMismatch.omits" },
        { answer: "contradicts", level: "error", defect: "coherence.summaryMismatch.contradicts" },
      ],
      next: [{ ask: "which:coherence.summaryMismatch" }],
    };
    const which: Q = {
      id: "which:coherence.summaryMismatch", answer: "choice", choices: ["omits", "contradicts", "none"], benign: "none",
      policy: [
        { answer: "omits", level: "warning", defect: "coherence.summaryMismatch.omits" },
        { answer: "contradicts", level: "error", defect: "coherence.summaryMismatch.contradicts" },
        { answer: "none", level: "pass" },
      ],
    };
    const allHold = { ...SET_ALL_HOLD, batchWith: ["set.inconsistent", "parent.summary"] };
    const questions = [allHold, SET_INCONSISTENT, summary, which, SET_MEMBER(), PAIR_RELATION, WHICH];
    const { s1, asks } = recording();
    const { e, calls } = spyExplainer();
    const desc = "Exports need no approval. #s1:parent.summary=contradicts #s1:which:coherence.summaryMismatch=contradicts";
    const r = await evaluateAndJudge(template(questions), graph({ s1: { description: desc, rules: RULES } }), s1, { explainer: e });
    expect(asks).toEqual([["set.allHold", "set.inconsistent", "parent.summary"], ["which:coherence.summaryMismatch"]]);
    const f = find(r, "parent.summary", "s1");
    expect(f).toMatchObject({
      level: "error",
      judgment: { question: "which:coherence.summaryMismatch", status: "confident", answer: "contradicts", defect: "coherence.summaryMismatch.contradicts" },
      provenance: { round: 2, stage: "self" },
    });
    expect(f.judgment!.path!.map((s) => [s.question, s.answer])).toEqual([["parent.summary", "contradicts"], ["which:coherence.summaryMismatch", "contradicts"]]);
    expect(f.derivation).toEqual(find(r, "set.allHold", "s1").derivation);
    // The polarity partner feeds combine only; the set itself passes.
    expect(r.findings.some((x) => x.rule === "semantic:set.inconsistent")).toBe(false);
    expect(find(r, "set.allHold", "s1").level).toBe("pass");
    expect(calls).toEqual([expect.objectContaining({ defect: "coherence.summaryMismatch.contradicts", subjects: ["s1"] })]);
    expect(r.buildable).toBe(false);
  });

  it("maxCalls cuts the rest: unasked findings are unknown with provider budget", async () => {
    const g = graph({
      s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES },
      s2: { description: FLAGGED, rules: { r4: "Exports expire.", r5: "Exports never expire." } },
    });
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), g, fakeSystemOne(), { limits: { maxCalls: 1 } });
    expect(find(r, "set.allHold", "s2")).toMatchObject({
      level: "info", judgment: { question: "set.allHold", status: "unknown" },
      provenance: { provider: "budget", error: { name: "Budget", code: "budget" } },
    });
    // The asked set keeps its level when its follow-ups are cut.
    expect(find(r, "set.allHold", "s1")).toMatchObject({ level: "warning", judgment: { status: "confident" } });
    expect(r.judgments).toMatchObject({ calls: 1, budget: "exhausted", unknown: 1 });
    expect(r.buildable).toBe(false);
  });

  it("maxRounds stops the walk and marks the budget exhausted", async () => {
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } }),
      fakeSystemOne(), { limits: { maxRounds: 2 } });
    expect(r.judgments).toMatchObject({ rounds: 2, calls: 2, budget: "exhausted" });
    expect(find(r, "pair.relation", "r1|r2")).toMatchObject({ level: "info", provenance: { provider: "budget" } });
    expect(find(r, "set.allHold", "s1")).toMatchObject({ level: "warning" });
  });

  it("maxPairsPerSet caps pairs, keeping the pre-filter's best, and counts the rest as gated", async () => {
    const { s1, asks } = recording();
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } }),
      s1, { limits: { maxPairsPerSet: 1 } });
    expect(r.findings.filter((f) => f.rule === "semantic:pair.relation").map((f) => f.subject)).toEqual(["r1|r2"]);
    expect(r.judgments.gated).toBe(1);
    expect(asks.filter((a) => a.includes("pair.relation"))).toHaveLength(1);
  });

  it("splits a batch the provider cannot answer as a whole and still combines the pair", async () => {
    const fake = fakeSystemOne();
    const { s1, asks } = recording({
      mode: "http", model: "m",
      ask: async (state, qs, o) => {
        if (Object.keys(qs).length > 1) throw new S1Error("cannot read a multi-question reply", "bad-response");
        return fake.ask(state, qs, o);
      },
    });
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), graph({ s1: { description: FLAGGED, rules: RULES } }), s1);
    expect(asks.slice(0, 3)).toEqual([["set.allHold", "set.inconsistent"], ["set.allHold"], ["set.inconsistent"]]);
    // No member is picked, so the pre-filtered member pairs find the contradiction and narrow the parent.
    expect(find(r, "set.allHold", "s1")).toMatchObject({
      level: "info", judgment: { status: "confident", answer: "no" }, provenance: { provider: "fake", batch: { size: 1, split: true } },
    });
    expect(find(r, "set.allHold", "s1").judgment!.narrowedBy).toEqual(["consistency.contradiction.modal@r1|r2", "consistency.contradiction.modal@r2|r3"]);
  });

  it("a multi-question batch that fails otherwise leaves its items unknown with provider error", async () => {
    const s1: SystemOne = { mode: "http", model: "m", ask: async () => { throw new S1Error("down", "network"); } };
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), graph({ s1: { description: FLAGGED, rules: RULES } }), s1);
    expect(find(r, "set.allHold", "s1")).toMatchObject({ level: "info", judgment: { status: "unknown" }, provenance: { provider: "error", error: { code: "network" } } });
  });

  it("memo asks a doubly reachable pair once", async () => {
    const { s1, asks } = recording();
    const member = SET_MEMBER([{ ask: "pair.relation", over: "pairs" }, { answer: "r1", ask: "pair.relation", over: "pairs" }]);
    const r = await evaluateAndJudge(template(SET_QUESTIONS(member)), graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } }), s1);
    expect(asks.filter((a) => a.includes("pair.relation"))).toHaveLength(2);
    expect(r.findings.filter((f) => f.rule === "semantic:pair.relation").map((f) => f.subject)).toEqual(["r1|r2", "r1|r3"]);
  });

  it("a throwing or erroring explainer leaves levels unchanged", async () => {
    const g = graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } });
    const throwing: Explainer = { mode: "http", model: "x", explain: async () => { throw new Error("explainer down"); } };
    const erroring: Explainer = { mode: "http", model: "x", explain: async () => ({ provider: "error", model: "x", error: "http 500" }) };
    for (const e of [throwing, erroring]) {
      const r = await evaluateAndJudge(template(SET_QUESTIONS()), g, fakeSystemOne(), { explainer: e });
      expect(find(r, "pair.relation", "r1|r2")).toMatchObject({ level: "error", judgment: { status: "confident" }, provenance: { explained: { provider: "error" } } });
      expect(find(r, "set.allHold", "s1").level).toBe("info");
      expect(r.judgments.explained).toBe(0);
    }
  });

  it("maxExplanations caps the explainer", async () => {
    const { e, calls } = spyExplainer();
    const g = graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } });
    const r = await evaluateAndJudge(template(SET_QUESTIONS()), g, fakeSystemOne(), { explainer: e, limits: { maxExplanations: 0 } });
    expect(calls).toHaveLength(0);
    expect(find(r, "pair.relation", "r1|r2").judgment!.explanation).toBeUndefined();
  });

  it("minStatus review lets a follow-up fire on a review answer; the default does not", async () => {
    const { s1, asks } = recording();
    const g = graph({ s1: { description: "Rules.", rules: { r1: "Exports are fast. #s1:rule.vague=yes #s1low:rule.vague #s1:rule.strict=yes #s1low:rule.strict" } } });
    const r = await evaluateAndJudge(template([RULE_VAGUE, RULE_STRICT, RULE_DETAIL]), g, s1);
    expect(asks).toEqual([["rule.strict", "rule.vague"], ["rule.detail"]]);
    const vague = find(r, "rule.vague", "r1");
    expect(vague).toMatchObject({ level: "review", judgment: { question: "rule.vague", status: "review", answer: "yes" } });
    expect(vague.judgment!.path!.map((s) => [s.question, s.status])).toEqual([["rule.vague", "review"], ["rule.detail", "confident"]]);
    expect(find(r, "rule.strict", "r1").judgment!.path).toHaveLength(1);
  });

  it("a maxScore follow-up fires on low scores only and records the banded confidence", async () => {
    const { s1, asks } = recording();
    const g = graph({ s1: { description: "Rules.", rules: { r1: "Fast. #s1:rule.clarity=1", r2: "Quick. #s1:rule.clarity=2", r3: "Exports finish within 5 s." } } });
    const r = await evaluateAndJudge(template([RULE_CLARITY, RULE_DETAIL]), g, s1);
    expect(asks.filter((a) => a.includes("rule.detail"))).toHaveLength(1);
    const low = find(r, "rule.clarity", "r1");
    expect(low).toMatchObject({ level: "warning", judgment: { question: "rule.clarity", answer: "1", defect: "specificity" } });
    expect(low.judgment!.path!.map((s) => s.question)).toEqual(["rule.clarity", "rule.detail"]);
    expect(low.judgment!.bandedConfidence).toBeCloseTo(0.975);
    expect(find(r, "rule.clarity", "r2")).toMatchObject({ level: "warning", judgment: { path: [{ question: "rule.clarity" }] } });
    expect(find(r, "rule.clarity", "r3")).toMatchObject({ level: "pass" });
    expect(find(r, "rule.clarity", "r3").judgment!.defect).toBeUndefined();
  });

  it("a maxScore follow-up needs a confident score", async () => {
    const { s1, asks } = recording();
    const g = graph({ s1: { description: "Rules.", rules: { r1: "Fast. #s1:rule.clarity=1 #s1low:rule.clarity", r2: "Quick." } } });
    const r = await evaluateAndJudge(template([RULE_CLARITY, RULE_DETAIL]), g, s1);
    expect(asks.filter((a) => a.includes("rule.detail"))).toHaveLength(0);
    expect(find(r, "rule.clarity", "r1")).toMatchObject({ level: "info", judgment: { status: "unknown", answer: "1" } });
  });

  it("a template without next or batchWith asks one question per candidate", async () => {
    const { s1, asks } = recording();
    const g = graph({ s1: { description: "Rules.", rules: { r1: "Exports are fast. #s1:rule.strict=yes", r2: "Exports finish within 5 s." } } });
    const plain = { ...RULE_STRICT, next: undefined };
    const r = await evaluateAndJudge(template([plain]), g, s1);
    expect(asks).toEqual([["rule.strict"], ["rule.strict"]]);
    expect(find(r, "rule.strict", "r1")).toMatchObject({
      level: "warning", judgment: { question: "rule.strict", status: "confident", answer: "yes", confidence: 0.95, defect: "specificity" },
      provenance: { provider: "fake", round: 1, stage: "entry", batch: { size: 1 } },
    });
    expect(find(r, "rule.strict", "r2")).toMatchObject({ level: "pass" });
    expect(r.judgments).toEqual({ confident: 2, review: 0, unknown: 0, calls: 2, rounds: 1, gated: 0, budget: "ok", explained: 0 });
  });

  it("over members asks each member once", async () => {
    const { s1, asks } = recording();
    const allHold = { ...SET_ALL_HOLD, next: [{ answer: "no", ask: "rule.detail", over: "members" }] };
    const r = await evaluateAndJudge(template([allHold, { ...SET_INCONSISTENT, next: undefined }, RULE_DETAIL]), graph({ s1: { description: FLAGGED, rules: RULES } }), s1);
    expect(r.findings.filter((f) => f.rule === "semantic:rule.detail").map((f) => [f.subject, f.level])).toEqual([["r1", "pass"], ["r2", "pass"], ["r3", "pass"]]);
    expect(find(r, "set.allHold", "s1").level).toBe("review");
    expect(asks.filter((a) => a.includes("rule.detail"))).toHaveLength(3);
  });

  it("walks sections to a section pair and capped cross-section pairs, and asks about shared terms", async () => {
    const { s1, asks, states } = recording();
    const g = graph({
      s1: { description: "Approval.", rules: { r1: "Admins approve Exports.", r2: "Exports are logged." } },
      s2: { description: "Retention.", rules: { r4: "Exports expire after a day.", r5: "Admins never delete Exports." } },
    });
    g.nodes[0]!.fields.description = "Export data. #s1:sections.allHold=no #s1:sections.inconsistent=yes #s1:sections.section=s1 #s1:sections.other=s2";
    const r = await evaluateAndJudge(template([...WHOLE, PAIR_RELATION, WHICH]), g, s1, { limits: { maxCrossPairs: 3 } });
    const root = find(r, "sections.allHold", "p");
    expect(root.judgment!.path!.map((s) => [s.question, s.answer])).toEqual([["sections.allHold", "no"], ["sections.section", "s1"], ["sections.other", "s2"]]);
    expect(root.level).toBe("review");
    const pairs = r.findings.filter((f) => f.rule === "semantic:pair.relation").map((f) => f.subject).sort();
    expect(pairs).toHaveLength(4);
    expect(pairs).toContain("s1|s2");
    // The section pair is compared through its members although pair.relation's own slice has no children.
    const sectionPair = states.find((s) => (s.subject as { id: string }).id === "s1" && (s.counterpart as { id: string } | undefined)?.id === "s2");
    expect((sectionPair?.members as { id: string }[]).map((m) => m.id)).toEqual(["r1", "r2", "r4", "r5"]);
    expect(r.judgments.gated).toBe(1);
    const terms = r.findings.filter((f) => f.rule === "semantic:term.usage");
    expect(terms.map((f) => f.subject)).toEqual(terms.map(() => "p"));
    expect(terms.map((f) => f.message)).toEqual(['Term "admins" is used across sections of p.', 'Term "exports" is used across sections of p.']);
    expect(asks[0]).toEqual(expect.arrayContaining(["sections.allHold", "sections.inconsistent"]));
  });

  describe("sections", () => {
    const WALK = "#s1:sections.allHold=no #s1:sections.inconsistent=yes";
    const TOPICS = ["Billing", "Search", "Onboarding", "Alerts", "Themes", "Uploads", "Sharing", "Calendar", "Comments", "Tags", "Archive", "Reports", "Mobile", "Approval", "Retention"];
    /** A root with sections `a00`… (distinct topics, so only planted text clashes): `described` of them with a description, the rest with a title only. */
    const wide = (count: number, described: number, extra: Record<string, string> = {}): Graph => ({
      template: "template.test.funnel@1",
      nodes: [
        { id: "p", kind: "purpose", fields: { title: "Exports", description: `Export data. ${WALK}` } },
        ...Array.from({ length: count }, (_, i) => {
          const id = `a${String(i).padStart(2, "0")}`;
          const word = TOPICS[i]!;
          return { id, kind: "section", parent: "p", fields: i < described ? { title: word, description: extra[id] ?? `${word} handling.` } : { title: word } };
        }),
      ],
      links: [], declarations: [], evidence: [],
    });
    const optionsOf = (wires: S1Questions[], id: string) => wires.filter((w) => w[id]).map((w) => Object.keys((w[id] as { criteria: Record<string, string> }).criteria));

    it("counts only nodes with a probe statement field as sections; a title alone does not", async () => {
      const { s1, wires } = recording();
      const r = await evaluateAndJudge(template([...WHOLE, PAIR_RELATION, WHICH]), wide(15, 12), s1);
      const [options] = optionsOf(wires, "sections.section");
      expect(options).toHaveLength(13);
      expect(options).not.toContain("a12");
      expect(options).not.toContain("a14");
      expect(options).toContain("none");
      // No section is picked, so the fallback pairs the 12 texted sections (66 pairs) and keeps maxCrossPairs of them.
      expect(r.judgments.gated).toBe(66 - DEFAULT_LIMITS.maxCrossPairs);
    });

    it("ranks more than maxSections sections by pre-filter relevance and gates the rest once", async () => {
      const { s1, wires } = recording();
      const g = wide(15, 15, { a13: "Admins must always approve every export.", a14: "Admins must never approve any export." });
      g.nodes[0]!.fields.description = `Export data. ${WALK} #s1:sections.section=a14 #s1:sections.other=a13`;
      const r = await evaluateAndJudge(template([...WHOLE, PAIR_RELATION, WHICH]), g, s1, { limits: { maxCrossPairs: 0 } });
      const [section] = optionsOf(wires, "sections.section");
      expect(section!.slice(0, 2)).toEqual(["a13", "a14"]);
      expect(section).toHaveLength(13);
      const [other] = optionsOf(wires, "sections.other");
      expect(other).toEqual(section!.filter((id) => id !== "a14"));
      expect(find(r, "pair.relation", "a13|a14")).toBeDefined();
      // Three sections over maxSections, plus the leaf-section cross pair a13|a14 under maxCrossPairs 0.
      expect(r.judgments.gated).toBe(4);
    });

    it("reads statement fields from the template's semantic.probe pack, or from opts.texts", async () => {
      expect(probeTextsOf([{ id: "semantic.probe", source: 'probeText("statement").\nprobeText("").\nprobeText("description").' }])).toEqual(["statement", "description"]);
      expect(probeTextsOf([])).toBeUndefined();
      const { s1, wires } = recording();
      await evaluateAndJudge(template([...WHOLE, PAIR_RELATION, WHICH]), wide(15, 12), s1, { texts: ["title"] });
      expect(optionsOf(wires, "sections.section")[0]).toHaveLength(13);
    });
  });

  describe("review fixes", () => {
    it("a maxScore follow-up does not fire on a score that passes under the kind's passFrom", async () => {
      const { s1, asks } = recording();
      const clarity = { ...RULE_CLARITY, passFrom: { rule: 2 }, next: [{ maxScore: 2, ask: "rule.detail" }] };
      const g = graph({ s1: { description: "Rules.", rules: { r1: "Fast. #s1:rule.clarity=2", r2: "Quick. #s1:rule.clarity=1" } } });
      const r = await evaluateAndJudge(template([clarity, RULE_DETAIL]), g, s1);
      expect(find(r, "rule.clarity", "r1")).toMatchObject({ level: "pass", judgment: { answer: "2", path: [{ question: "rule.clarity" }] } });
      expect(find(r, "rule.clarity", "r2").judgment!.path!.map((x) => x.question)).toEqual(["rule.clarity", "rule.detail"]);
      expect(asks.filter((a) => a.includes("rule.detail"))).toHaveLength(1);
    });

    it("a duplicate candidate is asked once and both findings settle alike", async () => {
      const { s1, asks } = recording();
      const t = template([RULE_STRICT, RULE_DETAIL]);
      const g = graph({ s1: { description: "Rules.", rules: { r1: "Exports are fast. #s1:rule.strict=yes" } } });
      const r0 = evaluate(t, g);
      const dup = r0.findings.find((f) => f.rule === "semantic:rule.strict")!;
      const r = await judge({ ...r0, findings: [...r0.findings, { ...dup }] }, t, g, s1);
      const both = r.findings.filter((f) => f.rule === "semantic:rule.strict");
      expect(both).toHaveLength(2);
      for (const f of both) expect(f).toMatchObject({ level: "warning", judgment: { status: "confident", path: [{ question: "rule.strict" }, { question: "rule.detail" }] } });
      expect(asks).toEqual([["rule.strict"], ["rule.detail"]]);
      expect(r.judgments).toMatchObject({ budget: "ok", unknown: 0 });
    });

    it("an explainer that resolves undefined is recorded as an error and judge does not throw", async () => {
      const empty = { mode: "http", model: "x", explain: async () => undefined } as unknown as Explainer;
      const r = await evaluateAndJudge(template(SET_QUESTIONS()), graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } }), fakeSystemOne(), { explainer: empty });
      expect(find(r, "pair.relation", "r1|r2")).toMatchObject({ level: "error", provenance: { explained: { provider: "error", error: "explainer returned no result" } } });
      expect(r.judgments.explained).toBe(0);
    });

    it("reconciles a child linked to a parent created after it", () => {
      const mk = (): Track => ({ children: [], parents: [], steps: [], prefix: [] } as unknown as Track);
      const early = mk(), child = mk(), late = mk();
      early.children.push(child); late.children.push(child); child.parents.push(early, late);
      const f = (level: Finding["level"], subject: string): Finding =>
        ({ level, rule: "semantic:q", subject, message: "", facts: [], derivation: {} as Finding["derivation"], judgment: { question: "q", status: "confident", defect: "consistency.contradiction" } });
      const findings = new Map<Track, Finding>([[early, f("warning", "s1")], [child, f("error", "a|b")], [late, f("warning", "s2")]]);
      reconcileParents([early, child, late], findings);
      for (const parent of [early, late]) expect(findings.get(parent)).toMatchObject({ level: "info", judgment: { narrowedBy: ["consistency.contradiction@a|b"] } });
    });

    it("a finding whose follow-up the budget cut is marked truncated; defaults are 6 rounds and 500 calls", async () => {
      expect(DEFAULT_LIMITS).toMatchObject({ maxRounds: 6, maxCalls: 500 });
      const r = await evaluateAndJudge(template(SET_QUESTIONS()), graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } }),
        fakeSystemOne(), { limits: { maxRounds: 3 } });
      expect(find(r, "pair.relation", "r1|r2")).toMatchObject({ level: "error", judgment: { question: "pair.relation" }, provenance: { truncated: true } });
      expect(find(r, "pair.relation", "r1|r3").provenance!.truncated).toBeUndefined();
      expect(r.judgments.budget).toBe("exhausted");
    });

    it("a confident unclear pair is a review finding: no which: follow-up, and the flagged parent keeps its level", async () => {
      const relation = {
        ...PAIR_RELATION, choices: ["compatible", "contradiction", "tension", "unclear"],
        policy: [...(PAIR_RELATION.policy as Q[]), { answer: "unclear", level: "review" }],
      };
      const { s1, asks } = recording();
      const rules = { ...RULES, r2: "Admins must never approve exports. #s1:pair.relation=unclear" };
      const r = await evaluateAndJudge(template([SET_ALL_HOLD, SET_INCONSISTENT, SET_MEMBER(), relation, WHICH]),
        graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules } }), s1);
      const unclear = find(r, "pair.relation", "r1|r2");
      expect(unclear).toMatchObject({ level: "review", judgment: { status: "confident", answer: "unclear" } });
      expect(unclear.judgment!.defect).toBeUndefined();
      expect(asks.some((a) => a.includes("which:consistency.contradiction"))).toBe(false);
      const parent = find(r, "set.allHold", "s1");
      expect(parent.level).toBe("warning");
      expect(parent.judgment!.narrowedBy).toBeUndefined();
      expect(r.buildable).toBe(false);
    });

    it("members without statement text are neither offered nor paired", async () => {
      const { s1, wires } = recording();
      const g = graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } });
      g.nodes.push({ id: "r9", kind: "rule", parent: "s1", fields: { title: "Untitled rule" } });
      const r = await evaluateAndJudge(template(SET_QUESTIONS()), g, s1);
      expect(Object.keys((wires.find((w) => w["set.member"])!["set.member"] as { criteria: object }).criteria)).toEqual(["r1", "r2", "r3", "none"]);
      expect(r.findings.filter((f) => f.rule === "semantic:pair.relation").map((f) => f.subject)).toEqual(["r1|r2", "r1|r3"]);
    });

    it("output order does not depend on reply timing", async () => {
      const allHold = { ...SET_ALL_HOLD, batchWith: ["set.inconsistent", "set.summary"] };
      const t = template([allHold, SET_INCONSISTENT, SET_SUMMARY, SET_MEMBER(), PAIR_RELATION, WHICH]);
      const g = graph({
        s1: { description: "A. #s1:set.summary=contradicts", rules: RULES },
        s2: { description: "B. #s1:set.summary=contradicts", rules: { r4: "Exports expire.", r5: "Exports are kept." } },
      });
      const fake = fakeSystemOne();
      const delayed = (order: number[]): SystemOne => {
        let n = 0;
        return { mode: "fake", model: "fake", ask: async (state, qs, o) => { const d = order[n++ % order.length]!; await new Promise((res) => setTimeout(res, d)); return fake.ask(state, qs, o); } };
      };
      const a = JSON.stringify(await evaluateAndJudge(t, g, delayed([0, 15])));
      const b = JSON.stringify(await evaluateAndJudge(t, g, delayed([15, 0])));
      expect(a).toBe(b);
      const r = JSON.parse(a) as Readiness;
      expect(sortTotal([...r.findings].reverse())).toEqual(r.findings);
    });
  });

  describe("live-run fixes", () => {
    /** The fake provider with the confidence of chosen questions rescaled, keeping each answer's side. */
    const tuned = (confidence: Record<string, number>): SystemOne => {
      const fake = fakeSystemOne();
      return {
        mode: "fake", model: "fake",
        ask: async (state, qs, o) => {
          const reply = await fake.ask(state, qs, o);
          const answers = { ...reply.answers };
          for (const [id, c] of Object.entries(confidence)) {
            const a = answers[id];
            if (!a) continue;
            if (a.type === "noul") answers[id] = { type: "noul", noul: a.noul >= 0.5 ? c : 1 - c };
            else {
              const keys = Object.keys(a.probabilities);
              const pick = a.type === "choice" ? a.choice : String(a.score);
              const probabilities = Object.fromEntries(keys.map((k) => [k, k === pick ? c : (1 - c) / Math.max(1, keys.length - 1)]));
              answers[id] = { ...a, confidence: c, probabilities };
            }
          }
          return { ...reply, answers };
        },
      };
    };
    const pairsOf = (r: Readiness) => r.findings.filter((f) => f.rule === "semantic:pair.relation").map((f) => f.subject);
    const flagged = (pick = "#s1:set.member=r1") => graph({ s1: { description: `${FLAGGED} ${pick}`, rules: RULES } });

    it("a member pick at 0.85 (review) still spawns its pairs", async () => {
      const r = await evaluateAndJudge(template(SET_QUESTIONS()), flagged(), tuned({ "set.member": 0.85 }));
      const parent = find(r, "set.allHold", "s1");
      expect(parent.judgment!.path![1]).toMatchObject({ question: "set.member", answer: "r1", status: "review" });
      expect(pairsOf(r)).toEqual(["r1|r2", "r1|r3"]);
      expect(find(r, "pair.relation", "r1|r2")).toMatchObject({ level: "error", judgment: { defect: "consistency.contradiction.modal" } });
      expect(parent.judgment!.narrowedBy).toEqual(["consistency.contradiction.modal@r1|r2"]);
    });

    it("a member pick below review falls back to pre-filtered member pairs, capped", async () => {
      const { s1, asks } = recording(tuned({ "set.member": 0.3 }));
      const r = await evaluateAndJudge(template(SET_QUESTIONS()), flagged(), s1, { limits: { maxPairsPerSet: 2 } });
      expect(find(r, "set.allHold", "s1").judgment!.path![1]).toMatchObject({ question: "set.member", status: "unknown" });
      // All three member pairs are candidates; the modal clash ranks first and one pair is gated.
      expect(pairsOf(r)[0]).toBe("r1|r2");
      expect(pairsOf(r)).toHaveLength(2);
      expect(r.judgments.gated).toBe(1);
      expect(asks.filter((a) => a.includes("pair.relation"))).toHaveLength(2);
      expect(find(r, "pair.relation", "r1|r2").level).toBe("error");
    });

    it("a confident `none` pick on a flagged set also falls back to pre-filtered pairs", async () => {
      const r = await evaluateAndJudge(template(SET_QUESTIONS()), flagged("#s1:set.member=none"), fakeSystemOne());
      expect(pairsOf(r).sort()).toEqual(["r1|r2", "r1|r3", "r2|r3"]);
      expect(find(r, "set.allHold", "s1").judgment!.narrowedBy).toEqual(["consistency.contradiction.modal@r1|r2", "consistency.contradiction.modal@r2|r3"]);
    });

    it("a benign pair answer at 0.7 is a review finding carrying the family defect", async () => {
      const rules = { ...RULES, r2: "Admins must never approve exports." };
      const g = graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules } });
      const r = await evaluateAndJudge(template(SET_QUESTIONS()), g, tuned({ "pair.relation": 0.7 }));
      expect(find(r, "pair.relation", "r1|r2")).toMatchObject({
        level: "review", judgment: { question: "pair.relation", status: "review", answer: "compatible", defect: "consistency" },
      });
      // A review child is not a pass, so the flagged parent keeps its level.
      expect(find(r, "set.allHold", "s1").level).toBe("warning");
    });

    it("a benign yes-no answer in review carries the question's defect; a confident pass carries none", async () => {
      const g = graph({ s1: { description: "Rules.", rules: { r1: "Exports are fast.", r2: "Exports finish within 5 s." } } });
      const plain = { ...RULE_STRICT, next: undefined };
      const review = await evaluateAndJudge(template([plain]), g, tuned({ "rule.strict": 0.72 }));
      expect(find(review, "rule.strict", "r1")).toMatchObject({ level: "review", judgment: { status: "review", answer: "no", defect: "specificity" } });
      const pass = await evaluateAndJudge(template([plain]), g, fakeSystemOne());
      expect(find(pass, "rule.strict", "r1").judgment!.defect).toBeUndefined();
    });

    it("a failed section pick falls back to pre-filtered cross-section pairs", async () => {
      const g = graph({
        s1: { description: "Approval.", rules: { r1: "Admins must always approve exports.", r2: "Exports are logged." } },
        s2: { description: "Retention.", rules: { r4: "Admins must never approve exports.", r5: "Backups run nightly." } },
      });
      g.nodes[0]!.fields.description = "Export data. #s1:sections.allHold=no #s1:sections.inconsistent=yes #s1:sections.section=none";
      const { s1, asks } = recording();
      const r = await evaluateAndJudge(template([...WHOLE.filter((q) => q.id !== "term.usage"), PAIR_RELATION, WHICH]), g, s1, { limits: { maxCrossPairs: 2 } });
      expect(asks.some((a) => a.includes("sections.other"))).toBe(false);
      const pairs = pairsOf(r);
      expect(pairs).toHaveLength(2);
      expect(pairs[0]).toBe("r1|r4");
      expect(r.judgments.gated).toBe(2);
    });
  });

  describe("pair wording by the parent kind", () => {
    const SET_PAIRS = "Two rules of one section must not grant and forbid the same action.";
    const ROOT_PAIRS = "Two statements from different sections must agree on who approves what.";
    const text = [{ name: "title", type: "string" }, { name: "description", type: "string" }] as const;
    const kinds = {
      purpose: { fields: [...text], criteria: { pairs: ROOT_PAIRS } },
      section: { parents: ["purpose"], fields: [...text], criteria: { pairs: SET_PAIRS } },
      rule: { parents: ["section"], fields: [...text] },
    };
    const worded = (questions: Q[]) => {
      const { byKind } = compileKinds(undefined, kinds);
      const pair = { ...PAIR_RELATION, text: "How do state.subject and state.counterpart relate? {pairs}", byKind };
      return loadTemplate({
        id: "template.test.funnel", version: 1, meta: 1, kinds,
        rules: [{ id: "funnel", version: "1", source: PACK }],
        questions: questions.map((q) => (q.id === "pair.relation" ? pair : q)),
      });
    };
    const pairTexts = (wires: S1Questions[]) => wires.flatMap((w) => (w["pair.relation"] ? [w["pair.relation"].instructions] : []));

    it("words member pairs with the set's kind", async () => {
      const { s1, wires } = recording();
      await evaluateAndJudge(worded(SET_QUESTIONS()), graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } }), s1);
      const texts = pairTexts(wires);
      expect(texts).toHaveLength(2);
      for (const t of texts) expect(t).toBe(`How do state.subject and state.counterpart relate? ${SET_PAIRS}`);
    });

    it("words cross-section pairs with the root's kind, not the members' inherited wording", async () => {
      const g = graph({
        s1: { description: "Approval.", rules: { r1: "Admins must always approve exports.", r2: "Exports are logged." } },
        s2: { description: "Retention.", rules: { r4: "Admins must never approve exports.", r5: "Backups run nightly." } },
      });
      g.nodes[0]!.fields.description = "Export data. #s1:sections.allHold=no #s1:sections.inconsistent=yes #s1:sections.section=none";
      const { s1, wires } = recording();
      await evaluateAndJudge(worded([...WHOLE.filter((q) => q.id !== "term.usage"), PAIR_RELATION, WHICH]), g, s1, { limits: { maxCrossPairs: 2 } });
      const texts = pairTexts(wires);
      expect(texts).toHaveLength(2);
      for (const t of texts) { expect(t).toContain(ROOT_PAIRS); expect(t).not.toContain(SET_PAIRS); }
    });

    it("words an entry pair by its first subject's kind, which inherits its parent's pairs", () => {
      const q = worded([PAIR_RELATION]).questions.find((x) => x.id === "pair.relation")!;
      expect(toWire(q, "rule").instructions).toContain(SET_PAIRS);
      expect(toWire(q, "rule", undefined, "purpose").instructions).toContain(ROOT_PAIRS);
      // A parent kind without its own pairs criterion leaves the subject's wording.
      expect(toWire(q, "rule", undefined, "rule").instructions).toContain(SET_PAIRS);
    });
  });

  it("is deterministic", async () => {
    const g = graph({ s1: { description: `${FLAGGED} #s1:set.member=r1`, rules: RULES } });
    const run = async () => JSON.stringify(await evaluateAndJudge(template(SET_QUESTIONS()), g, fakeSystemOne(), { explainer: fakeExplainer() }));
    expect(await run()).toBe(await run());
  });
});
