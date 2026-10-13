import { describe, expect, it } from "vitest";
import {
  ARTYFACT_CRITERIA, artyfactGenome, checkTemplateForm, compileKinds, evaluateAndJudge, fakeSystemOne, kindGlossary, loadTemplate,
  memoryStore, SEMANTIC_CATALOGUE, toWire, WIRE_TOKENS, withSemanticProbes, type Graph, type Question, type S1Questions, type SystemOne,
  type TemplateInput,
} from "../src/index.ts";
import { PRODUCT_CRITERIA, productSpec } from "../src/adapters/product/index.ts";

const CHILDREN = "Steps of one goal must be doable by the same person in the same week.";
const SUMMARY = "The goal's description must name the result its steps reach together.";
const PAIRS = "Two steps of one goal are compatible when neither undoes the other.";
const TESTABLE = "A checkable step names the artefact it leaves behind.";
const INSTANCE = "A step is one action a person takes toward a goal.";
const SECTIONS = "Every goal serves the plan's single aim.";
const TERMS = "A term keeps one meaning across goals.";

const text = [{ name: "title", type: "string" }, { name: "description", type: "string" }] as const;
const plan = (extra: Partial<TemplateInput> = {}): TemplateInput => ({
  id: "template.test.plan", version: 1, meta: 1,
  kinds: {
    plan: { fields: [...text] },
    goal: { fields: [...text], parents: ["plan"], criteria: { children: CHILDREN, summary: SUMMARY, pairs: PAIRS } },
    step: { fields: [...text], parents: ["goal"], criteria: { noun: "step", instanceOf: INSTANCE, testable: TESTABLE, minScore: 2 } },
  },
  ...extra,
});
const probed = (extra: Partial<TemplateInput> = {}) =>
  loadTemplate(withSemanticProbes(plan(extra), { sets: ["goal"], sections: true, measurable: ["step"], fields: ["title", "description"] }));
const q = (t: ReturnType<typeof probed>, id: string): Question => t.questions.find((x) => x.id === id)!;

const graph = (): Graph => ({
  template: "template.test.plan@1",
  nodes: [
    { id: "p", kind: "plan", fields: { title: "Plan" } },
    { id: "g", kind: "goal", parent: "p", fields: { title: "Fit", description: "Run a 10k by June." } },
    { id: "s1", kind: "step", parent: "g", fields: { title: "Run", description: "Run three times a week." } },
    { id: "s2", kind: "step", parent: "g", fields: { title: "Rest", description: "Rest two days a week." } },
    { id: "h", kind: "goal", parent: "p", fields: { title: "Read", description: "Read twelve books this year." } },
  ],
  links: [], declarations: [], evidence: [],
});

describe("kind and root criteria in meta@1", () => {
  it("accepts criteria, keeps the hash when absent, and merges them across extends key by key", () => {
    expect(checkTemplateForm(loadTemplate(plan())).findings).toEqual([]);
    const bare = plan();
    for (const k of Object.values(bare.kinds!)) delete (k as { criteria?: unknown }).criteria;
    expect(loadTemplate(bare).kinds.goal).not.toHaveProperty("criteria");
    expect(loadTemplate(bare)).not.toHaveProperty("rootCriteria");
    expect(loadTemplate(bare).hash).toBe(loadTemplate(JSON.parse(JSON.stringify(bare))).hash);

    const parent = plan({ rootCriteria: { sections: SECTIONS, terms: TERMS } });
    const child: TemplateInput = {
      id: "template.test.child", version: 1, meta: 1, extends: "template.test.plan@1",
      kinds: { goal: { fields: [...text], criteria: { children: "Override." } } },
      rootCriteria: { terms: "Child terms." },
    };
    const t = loadTemplate(child, memoryStore([parent]));
    expect(t.kinds.goal!.criteria).toEqual({ children: "Override.", summary: SUMMARY, pairs: PAIRS });
    expect(t.kinds.step!.criteria?.instanceOf).toBe(INSTANCE);
    expect(t.rootCriteria).toEqual({ sections: SECTIONS, terms: "Child terms." });
  });

  it("the product, world and artyfact template criteria are well formed", () => {
    for (const t of [loadTemplate(productSpec), loadTemplate(artyfactGenome)]) {
      expect(checkTemplateForm(t).findings.filter((f) => f.rule.startsWith("criteria."))).toEqual([]);
    }
    expect(Object.keys(kindGlossary(productSpec.kinds)).sort()).toEqual(["capability", "feature", "outcome", "purpose", "rule", "summary"]);
    expect(kindGlossary(artyfactGenome.kinds).claim!.minScore).toBe(2);
    expect(PRODUCT_CRITERIA.goal!.noun).toBeUndefined();
    expect(ARTYFACT_CRITERIA.section!.tangible).toBe(false);
  });
});

describe("wire substitution of the criteria tokens", () => {
  const all = WIRE_TOKENS.map((k) => `{${k}}`).join(" ");
  const question = (byKind?: Record<string, string>): Question => ({
    id: "x", answer: "yes-no", text: `Start. ${all} End.`, benign: "yes",
    choices: ["Yes {pairs}", "No {children}"],
    slice: { parents: true, hops: 0, direction: "out", children: false, textCap: 600 },
    policy: [{ answer: "yes", level: "pass" }], ...(byKind && { byKind }),
  });
  const full = { noun: "N", instanceOf: "I.", grounded: "G.", testable: "T.", children: "C.", pairs: "P.", summary: "S." };

  it("fills every kind token from the subject kind's criteria", () => {
    const w = toWire(question({ k: JSON.stringify(full) }), "k");
    expect(w.instructions).toBe("Start. N I. G. T. C. P. S. End.");
    expect(w.type === "noul" && w.criteria).toEqual({ true: "Yes P.", false: "No C." });
  });

  it("blanks a token without a criterion and leaves no double space", () => {
    for (const w of [toWire(question(), "k"), toWire(question({ k: JSON.stringify({ noun: "N" }) }), "k")]) {
      expect(w.instructions).not.toMatch(/\{|\s{2}/);
      expect(w.instructions).toMatch(/^Start\. \w+ End\.$/);
    }
    expect(toWire(question({ k: JSON.stringify({ noun: "N", testable: "T." }) }), "k").instructions).toBe("Start. N T. End.");
  });
});

describe("compileKinds precedence", () => {
  const base: TemplateInput["kinds"] = {
    a: { fields: [], criteria: { noun: "alpha", instanceOf: "An alpha.", grounded: "Grounded alpha.", minScore: 2 } },
    b: { fields: [], criteria: { children: "B children.", pairs: "B pairs." } },
    c: { fields: [], parents: ["b"] },
  };
  const word = (r: ReturnType<typeof compileKinds>, k: string) => JSON.parse(r.byKind![k]!);

  it("takes the template criteria as the base", () => {
    const r = compileKinds(undefined, base);
    expect(word(r, "a")).toEqual({ noun: "alpha", instanceOf: "An alpha.", grounded: "Grounded alpha." });
    expect(word(r, "b")).toEqual({ noun: "b", children: "B children.", childPairs: "B pairs." });
    expect(word(r, "c")).toEqual({ noun: "c", pairs: "B pairs." });
    expect(r.passFrom).toEqual({ a: 2 });
    expect(Object.keys(kindGlossary(base))).toEqual(["a"]);
  });

  it("lets the legacy glossary override key by key and choose the probed kinds", () => {
    const r = compileKinds({ a: { noun: "Alpha", minScore: 3 }, b: { noun: "beta" } }, base);
    expect(word(r, "a")).toEqual({ noun: "Alpha", instanceOf: "An alpha.", grounded: "Grounded alpha." });
    expect(word(r, "b")).toEqual({ noun: "beta", children: "B children.", childPairs: "B pairs." });
    expect(r.passFrom).toEqual({ a: 3 });
    expect(Object.keys(kindGlossary(base, ["b"]))).toEqual(["b"]);
    expect(kindGlossary(base, ["a"]).a!.noun).toBe("alpha");
    expect(compileKinds({ a: { noun: "x" } })).toEqual({ byKind: { a: JSON.stringify({ noun: "x" }) } });
  });
});

describe("the catalogue asks with the ontology's criteria", () => {
  it("words the set, summary, pair, testability and node questions per kind, and root questions per template", () => {
    const t = probed({ rootCriteria: { sections: SECTIONS, terms: TERMS } });
    expect(toWire(q(t, "set.allHold"), "goal").instructions).toContain(CHILDREN);
    expect(toWire(q(t, "set.inconsistent"), "goal").instructions).toContain(CHILDREN);
    expect(toWire(q(t, "parent.summary"), "goal").instructions).toContain(SUMMARY);
    expect(toWire(q(t, "pair.relation"), "step").instructions).toContain(PAIRS);
    expect(toWire(q(t, "text.unmeasurable"), "step").instructions).toContain(TESTABLE);
    expect(toWire(q(t, "criterion.unfalsifiable"), "step").instructions).toContain(TESTABLE);
    expect(toWire(q(t, "node.kind"), "step").instructions).toContain(INSTANCE);
    expect(Object.keys(q(t, "node.kind").byKind!)).toEqual(["step"]);
    expect(q(t, "node.tangibility").passFrom).toEqual({ step: 2 });
    expect(q(t, "sections.allHold").text).toContain(SECTIONS);
    expect(q(t, "term.usage").text).toContain(TERMS);
  });

  it("keeps the generic stems when a kind or the template declares no criteria", () => {
    const t = probed();
    const generic = (id: string) => SEMANTIC_CATALOGUE.find((x) => x.id === id)!;
    for (const id of ["set.allHold", "set.inconsistent", "parent.summary", "pair.relation", "text.unmeasurable"]) {
      const plain = toWire({ ...q(t, id), byKind: undefined }, "plan").instructions;
      expect(plain, id).not.toMatch(/\{|\s{2}/);
      expect(toWire(q(t, id), "plan").instructions, id).toBe(plain);
    }
    expect(q(t, "sections.allHold").text).toBe(generic("sections.allHold").text!.replace(" {sections}", ""));
    expect(q(t, "term.usage").text).not.toContain("{terms}");
  });

  it("sends the parent's children criterion in the set question to System One", async () => {
    const sent: S1Questions[] = [];
    const fake = fakeSystemOne();
    const s1: SystemOne = { ...fake, ask: (state, questions, o) => { sent.push(questions); return fake.ask(state, questions, o); } };
    await evaluateAndJudge(probed(), graph(), s1);
    const set = sent.find((b) => b["set.allHold"]);
    expect(set?.["set.allHold"]?.instructions).toContain(CHILDREN);
    expect(set?.["parent.summary"]?.instructions).toContain(SUMMARY);
    expect(sent.some((b) => JSON.stringify(b["node.kind"]?.instructions ?? "").includes(INSTANCE))).toBe(true);
  });
});

describe("next minStatus", () => {
  it("is absent unless declared; absent reads confident, or review for a navigation question; declared wins", async () => {
    const { minStatusOf } = await import("../src/judge/funnel.ts");
    const t = loadTemplate({
      id: "t", version: 1, meta: 1, questions: [
        { id: "a", answer: "yes-no", benign: "no", policy: [{ answer: "no", level: "pass" }], next: [{ answer: "yes", ask: "b" }] },
        { id: "b", answer: "choice", choicesFrom: "members", choices: ["none"], benign: "none", policy: [{ answer: "*", level: "info" }],
          next: [{ ask: "a" }, { ask: "a", minStatus: "confident" }] },
      ],
    });
    const [a, b] = t.questions as [Question, Question];
    expect(a.next![0]).not.toHaveProperty("minStatus");
    expect(minStatusOf(a, a.next![0]!)).toBe("confident");
    expect(minStatusOf(b, b.next![0]!)).toBe("review");
    expect(minStatusOf(b, b.next![1]!)).toBe("confident");
  });
});

describe("next minStatus and the template hash", () => {
  const yesNo = { answer: "yes-no", benign: "no", policy: [{ answer: "no", level: "pass" }] };
  const pick = { answer: "choice", choicesFrom: "members", choices: ["none"], benign: "none", policy: [{ answer: "*", level: "info" }] };
  const tpl = (from: object, n: Record<string, unknown>) => ({
    id: "t", version: 1, meta: 1, questions: [{ id: "a", ...from, next: [{ ask: "b", ...n }] }, { id: "b", ...yesNo }],
  });

  it("an absent minStatus hashes as its effective value: confident on an ordinary question", () => {
    const absent = loadTemplate(tpl(yesNo, { answer: "yes" }));
    expect(absent.questions[0]!.next![0]).not.toHaveProperty("minStatus");
    expect(absent.hash).toBe(loadTemplate(tpl(yesNo, { answer: "yes", minStatus: "confident" })).hash);
    expect(absent.hash).not.toBe(loadTemplate(tpl(yesNo, { answer: "yes", minStatus: "review" })).hash);
  });

  it("and review on a navigation question, so a declared confident there hashes differently", () => {
    const absent = loadTemplate(tpl(pick, {}));
    expect(absent.hash).toBe(loadTemplate(tpl(pick, { minStatus: "review" })).hash);
    expect(absent.hash).not.toBe(loadTemplate(tpl(pick, { minStatus: "confident" })).hash);
  });
});
