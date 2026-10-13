import { describe, expect, it } from "vitest";
import {
  ANY_ANSWER, checkTemplateForm, decide, DEFAULT_THRESHOLDS, DEFECTS, defectChildren, defectIndex, generatedQuestions, loadTemplate, NONE,
  OTHER_KIND, otherKindDefects, passFromOf, SEMANTIC_CATALOGUE_V1, SEMANTIC_RULES, SEMANTIC_RULES_V1, toWire, whichOf, withSemanticProbes,
  type Answer, type Question, type Template,
} from "../../src/index.ts";
import { productSpec } from "../../src/adapters/product/index.ts";
import { SETTINGS, VOCABULARIES } from "../semantic/vocabularies.ts";

const glossary = ["purpose", "feature", "rule"];
const generated = loadTemplate({ id: "t", version: 1, meta: 1, questions: generatedQuestions(DEFECTS, { kinds: glossary }) }).questions;
const byId = new Map(generated.map((q) => [q.id, q]));
const tree = [...DEFECTS, ...otherKindDefects(glossary)];
const idx = defectIndex(tree);
const isParent = (id: string) => tree.some((d) => d.parent === id);

describe("generatedQuestions", () => {
  it("asks one which: question per non-leaf, non-deterministic defect, including the generated otherKind family", () => {
    const expected = tree.filter((d) => isParent(d.id) && !d.deterministic).map((d) => whichOf(d.id)).sort();
    expect(generated.map((q) => q.id).sort()).toEqual(expected);
    expect(byId.has(whichOf(OTHER_KIND))).toBe(true);
    expect(byId.has(whichOf("instance.placeholder"))).toBe(false);
  });

  it("offers the children plus none, maps each child to its level and id, and descends into non-leaf children", () => {
    for (const q of generated) {
      const d = q.id.slice("which:".length);
      const kids = tree.filter((x) => x.parent === d);
      expect(q).toMatchObject({ answer: "choice", benign: NONE, defect: d });
      expect(q.choices).toEqual([...kids.map((k) => k.label), NONE]);
      expect(q.policy).toEqual([{ answer: NONE, level: "pass" }, ...kids.map((k) => ({ answer: k.label, level: k.level, defect: k.id }))]);
      const descend = kids.filter((k) => isParent(k.id) && !k.deterministic).map((k) => ({ answer: k.label, ask: whichOf(k.id) }));
      expect((q.next ?? []).map((n) => ({ answer: n.answer, ask: n.ask }))).toEqual(descend);
    }
  });

  it("slices by scope: node, set with members, pair one hop, whole without parents", () => {
    expect(byId.get(whichOf("specificity"))!.slice).toMatchObject({ parents: true, hops: 0, children: false });
    expect(byId.get(whichOf("coherence.summaryMismatch"))!.slice).toMatchObject({ parents: true, children: true });
    expect(byId.get(whichOf("consistency.contradiction"))!.slice).toMatchObject({ parents: true, hops: 1 });
    expect(byId.get(whichOf("coherence.termDrift"))!.slice).toMatchObject({ parents: false, children: true });
    const withRels = generatedQuestions(DEFECTS, { probePairs: ["governs"] }).find((q) => q.id === whichOf("consistency.duplicate"))!;
    expect(withRels.slice).toMatchObject({ hops: 1, rels: ["governs"] });
  });

  it("sends each child's criterion on the wire, at most 255 characters", () => {
    for (const q of generated) {
      const w = toWire(q);
      expect(w.type).toBe("choice");
      const criteria = w.criteria as Record<string, string>;
      expect(Object.keys(criteria)).toEqual(q.choices);
      for (const [k, c] of Object.entries(criteria)) {
        expect(c.length).toBeLessThanOrEqual(255);
        if (k !== NONE) expect(c).toBe(idx.get(`${q.defect}.${k}`)!.criterion.slice(0, 255));
      }
    }
  });
});

describe("the v2 catalogue in each vocabulary", () => {
  describe.each(VOCABULARIES.map((make) => [make().name, make] as const))("%s", (_name, make) => {
    const t: Template = make().template;
    const ids = new Set(t.questions.map((q) => q.id));
    const known = new Set([...DEFECTS, ...otherKindDefects(Object.keys(t.kinds))].map((d) => d.id));

    it("passes meta@1 with zero findings", () => {
      const form = checkTemplateForm(t);
      expect(form.valid).toBe(true);
      expect(form.findings.filter((f) => f.level !== "pass")).toEqual([]);
    });

    it("every next target, batch companion and policy defect exists", () => {
      for (const q of t.questions) {
        for (const n of q.next ?? []) expect(ids.has(n.ask), `${q.id} -> ${n.ask}`).toBe(true);
        for (const b of q.batchWith ?? []) expect(ids.has(b), `${q.id} + ${b}`).toBe(true);
        for (const p of q.policy) if (p.defect) expect(known.has(p.defect), `${q.id} ${p.defect}`).toBe(true);
        if (q.defect) expect(known.has(q.defect), `${q.id} ${q.defect}`).toBe(true);
      }
    });

    it("covers every non-leaf, non-deterministic defect with a which: question", () => {
      for (const d of DEFECTS) if (defectChildren(d.id).length && !d.deterministic) expect(ids.has(whichOf(d.id)), d.id).toBe(true);
    });

    it("includes the hand-written v2 entries but not the v1-only ones", () => {
      for (const r of SEMANTIC_RULES) if (r !== "node.purpose" || _name === "product") expect(ids.has(r), r).toBe(true);
      expect(ids.has("text.vague")).toBe(false);
      expect(ids.has("pair.contradiction")).toBe(false);
    });

    it("every choice criterion on the wire is at most 255 characters for every glossary kind", () => {
      const kinds = [undefined, ...Object.keys(t.questions.find((q) => q.id === "node.kind")?.byKind ?? {})];
      for (const q of t.questions) for (const k of kinds) {
        const w = toWire(q, k, q.choicesFrom ? ["a", "b"] : undefined);
        const criteria = Array.isArray(w.criteria) ? w.criteria : Object.values(w.criteria);
        for (const c of criteria) expect(c.length, `${q.id} ${k}`).toBeLessThanOrEqual(255);
      }
    });
  });
});

describe("hand-written entries", () => {
  const t = loadTemplate(withSemanticProbes(productSpec, SETTINGS.product));
  const q = (id: string): Question => t.questions.find((x) => x.id === id)!;

  it("node.kind and node.tangibility carry the glossary wording per kind, so their wire text differs per kind", () => {
    expect(Object.keys(q("node.kind").byKind!).sort()).toEqual(Object.keys(SETTINGS.product.kinds).sort());
    const outcome = toWire(q("node.kind"), "outcome");
    const feature = toWire(q("node.kind"), "feature");
    expect(outcome.instructions).toContain("a genuine outcome?");
    expect(outcome.instructions).toContain(SETTINGS.product.kinds.outcome.instanceOf);
    expect(outcome).not.toEqual(feature);
    const score = toWire(q("node.tangibility"), "rule");
    expect(score.type).toBe("score");
    expect((score.criteria as string[])[4]).toContain(SETTINGS.product.kinds.rule.grounded);
    expect((toWire(q("node.tangibility")).criteria as string[])[4]).not.toContain("{grounded}");
  });

  it("node.tangibility: 0-2 warn as specificity, 3-4 pass, and score <= 2 descends into which:specificity", () => {
    const n = q("node.tangibility");
    expect(n.benign).toBe(4);
    expect(n.policy.map((p) => [p.answer, p.level, p.defect])).toEqual([
      ["0", "warning", "specificity"], ["1", "warning", "specificity"], ["2", "warning", "specificity"], ["3", "pass", undefined], ["4", "pass", undefined],
    ]);
    expect(n.next).toEqual([{ maxScore: 2, ask: whichOf("specificity"), over: "self" }]);
  });

  it("minScore lowers the pass boundary for that kind only", () => {
    const art = VOCABULARIES[0]!().template.questions.find((x) => x.id === "node.tangibility")!;
    expect(art.passFrom).toEqual({ claim: 2 });
    expect(passFromOf(art, "claim")).toBe(2);
    expect(passFromOf(art, "requirement")).toBe(3);
    expect(passFromOf(art)).toBe(3);
    const at = (score: number, kind?: string) => {
      const a: Answer = { type: "score", score, confidence: 0.95, probabilities: { [score]: 0.95 } };
      return decide(art, a, DEFAULT_THRESHOLDS, kind);
    };
    expect(at(2, "claim")).toMatchObject({ level: "pass", status: "confident" });
    expect(at(1, "claim")).toMatchObject({ level: "warning", defect: "specificity" });
    expect(at(2, "requirement")).toMatchObject({ level: "warning", defect: "specificity" });
    expect(at(2)).toMatchObject({ level: "warning" });
    const strict = { ...art, passFrom: { claim: 4 } };
    expect(decide(strict, { type: "score", score: 3, confidence: 0.95, probabilities: { 3: 0.95 } }, DEFAULT_THRESHOLDS, "claim")).toMatchObject({ level: "warning", defect: "specificity" });
  });

  it("set.allHold batches its companions and hands off to set.member; set.member picks over members and pairs them", () => {
    expect(q("set.allHold")).toMatchObject({ benign: "yes", batchWith: ["set.inconsistent", "parent.summary"], slice: { parents: true, children: true } });
    expect(q("set.allHold").next).toEqual([{ answer: "no", ask: "set.member", over: "self" }]);
    expect(q("set.inconsistent")).toMatchObject({ benign: "no", next: [{ answer: "yes", ask: "set.member" }] });
    const m = q("set.member");
    expect(m).toMatchObject({ choicesFrom: "members", benign: NONE, next: [{ ask: "pair.relation", over: "pairs" }] });
    const w = toWire(m, undefined, { a: "Remind weekly.", b: "Never remind." });
    expect(w.criteria).toEqual({ a: "Remind weekly.", b: "Never remind.", [NONE]: m.criteria![NONE] });
    expect(toWire(m, undefined, ["a", "b"]).criteria).toEqual({ a: "a", b: "b", [NONE]: m.criteria![NONE] });
    expect(decide(m, { type: "choice", choice: "a", confidence: 0.95, probabilities: { a: 0.95 } }, DEFAULT_THRESHOLDS)).toMatchObject({ status: "confident", level: "info" });
    expect(m.policy.some((p) => p.answer === ANY_ANSWER)).toBe(true);
  });

  it("pair.relation maps each non-benign relation to its consistency defect and leaf question; unclear goes to review", () => {
    const p = q("pair.relation");
    expect(p.choices).toEqual(["compatible", "contradiction", "tension", "duplicate", "circular", "scopeClash", "unclear"]);
    expect(p.policy.find((x) => x.answer === "contradiction")).toEqual({ answer: "contradiction", level: "error", defect: "consistency.contradiction" });
    expect(p.policy.find((x) => x.answer === "unclear")).toEqual({ answer: "unclear", level: "review" });
    expect(p.next!.map((n) => n.ask)).toEqual(["contradiction", "tension", "duplicate", "circular", "scopeClash"].map((k) => whichOf(`consistency.${k}`)));
    const unclear = decide(p, { type: "choice", choice: "unclear", confidence: 0.99, probabilities: { unclear: 0.99 } }, DEFAULT_THRESHOLDS);
    expect(unclear).toMatchObject({ status: "confident", level: "review" });
    expect(q("term.usage").policy.find((x) => x.answer === "unclear")).toEqual({ answer: "unclear", level: "review" });
    const w = toWire(p);
    expect((w.criteria as Record<string, string>).contradiction).toBe(defectIndex().get("consistency.contradiction")!.criterion);
  });

  it("parent.summary, sections.which and term.usage name defects under coherence and consistency", () => {
    expect(q("parent.summary").policy.find((x) => x.answer === "contradicts")).toMatchObject({ level: "error", defect: "coherence.summaryMismatch.contradicts" });
    const which = q("sections.which");
    expect(which.choices).toEqual([...defectChildren("consistency"), ...defectChildren("coherence")].map((d) => d.label).concat(NONE));
    expect(q("sections.section")).toMatchObject({ choicesFrom: "sections", next: [{ ask: "sections.other" }] });
    expect(q("sections.other")).toMatchObject({ choicesFrom: "sections", next: [{ ask: "pair.relation", over: "sections" }] });
    expect(q("term.usage").next).toEqual([{ answer: "drift", ask: whichOf("coherence.termDrift"), over: "self" }]);
  });

  it("v2 versions of text.unmeasurable and criterion.unfalsifiable descend into testability", () => {
    expect(q("text.unmeasurable")).toMatchObject({ defect: "testability.unmeasurable", next: [{ answer: "no", ask: whichOf("testability.unmeasurable") }] });
    expect(q("criterion.unfalsifiable")).toMatchObject({ defect: "testability.unfalsifiable", next: [{ answer: "yes", ask: whichOf("testability.unfalsifiable") }] });
    const v1 = loadTemplate({ id: "t", version: 1, meta: 1, questions: SEMANTIC_CATALOGUE_V1 }).questions;
    expect(v1.map((x) => x.id)).toEqual([...SEMANTIC_RULES_V1]);
    expect(v1.every((x) => x.next === undefined && x.defect === undefined)).toBe(true);
  });
});

describe("defects option", () => {
  it("which:instance.otherKind offers exactly the glossary kinds, and disabling one leaf or the family removes it", () => {
    const kinds = Object.keys(SETTINGS.product.kinds);
    const q = (o: object) => loadTemplate(withSemanticProbes(productSpec, { ...SETTINGS.product, ...o })).questions.find((x) => x.id === whichOf(OTHER_KIND));
    expect(q({})!.choices).toEqual([...kinds, NONE]);
    expect(q({ defects: { disable: [`${OTHER_KIND}.rule`] } })!.choices).toEqual([...kinds.filter((k) => k !== "rule"), NONE]);
    expect(q({ defects: { disable: [OTHER_KIND] } })).toBeUndefined();
    const parent = loadTemplate(withSemanticProbes(productSpec, { ...SETTINGS.product, defects: { disable: [OTHER_KIND] } })).questions.find((x) => x.id === whichOf("instance"))!;
    expect(parent.choices).not.toContain("otherKind");
  });

  it("a levels override applies to the named id only", () => {
    const t = loadTemplate(withSemanticProbes(productSpec, { ...SETTINGS.product, defects: { levels: { "consistency.duplicate": "error" } } }));
    const dup = t.questions.find((x) => x.id === whichOf("consistency"))?.policy ?? t.questions.find((x) => x.id === "pair.relation")!.policy;
    expect(dup.find((p) => p.answer === "duplicate")!.level).toBe("error");
    expect(t.questions.find((x) => x.id === whichOf("consistency.duplicate"))!.policy.filter((p) => p.answer !== NONE).every((p) => p.level === "warning")).toBe(true);
  });

  it("disabling a family drops its questions and prunes dangling follow-ups and policy defects", () => {
    const t = loadTemplate(withSemanticProbes(productSpec, { ...SETTINGS.product, defects: { disable: ["specificity", "consistency.tension"] } }));
    const ids = new Set(t.questions.map((q) => q.id));
    expect(ids.has("node.tangibility")).toBe(false);
    expect(ids.has(whichOf("specificity"))).toBe(false);
    expect(ids.has(whichOf("consistency.tension"))).toBe(false);
    const p = t.questions.find((q) => q.id === "pair.relation")!;
    expect(p.policy.find((x) => x.answer === "tension")).toEqual({ answer: "tension", level: "pass" });
    expect(p.next!.some((n) => n.ask === whichOf("consistency.tension"))).toBe(false);
    expect([...(t.defects?.disable ?? [])].sort()).toEqual(["consistency.tension", "specificity"]);
    const form = checkTemplateForm(t);
    expect(form.findings.filter((f) => f.level !== "pass")).toEqual([]);
  });

  it("level overrides reach the policies, and an unknown id is a form finding", () => {
    const t = loadTemplate(withSemanticProbes(productSpec, { ...SETTINGS.product, defects: { levels: { "consistency.tension": "error", nope: "info" } } }));
    expect(t.questions.find((q) => q.id === "pair.relation")!.policy.find((x) => x.answer === "tension")!.level).toBe("error");
    expect(checkTemplateForm(t).findings.map((f) => f.rule)).toContain("defect.levelUnknown");
  });

  it("a criterion for an undeclared option and a pass boundary for an unknown kind are form findings", () => {
    const t = loadTemplate({
      ...productSpec,
      questions: [
        { id: "x", answer: "choice", choices: ["a"], criteria: { b: "B" }, benign: "a", policy: [{ answer: "a", level: "pass" }] },
        { id: "y", answer: "score", choices: ["0", "1"], benign: 1, passFrom: { nope: 1 }, policy: [{ answer: 1, level: "pass" }] },
      ],
    });
    const rules = checkTemplateForm(t).findings.filter((f) => f.level !== "pass").map((f) => `${f.rule} ${f.subject}`);
    expect(rules).toEqual(expect.arrayContaining(["question.criterionUnknown x", "question.passFromUnknown y"]));
  });
});

describe("meta@1 checks on answers", () => {
  const form = (questions: object[]) =>
    checkTemplateForm(loadTemplate({ ...productSpec, questions } as Parameters<typeof loadTemplate>[0])).findings
      .filter((f) => f.level !== "pass").map((f) => `${f.level} ${f.rule} ${f.subject}`);
  const pol = (...answers: (string | number)[]) => answers.map((answer) => ({ answer, level: "pass" }));

  it("question.choiceUnmapped warns on a declared choice with no policy entry, unless the policy has \"*\"", () => {
    expect(form([{ id: "c", answer: "choice", choices: ["a", "b"], benign: "a", policy: pol("a") }])).toEqual(["warning question.choiceUnmapped c"]);
    expect(form([{ id: "c", answer: "choice", choices: ["a", "b"], benign: "a", policy: [...pol("a"), { answer: "*", level: "info" }] }])).toEqual([]);
    expect(form([{ id: "c", answer: "choice", choices: ["a", "b"], benign: "a", policy: pol("a", "b") }])).toEqual([]);
    expect(form([{ id: "y", answer: "yes-no", choices: ["Yes text", "No text"], benign: "no", policy: pol("no") }])).toEqual([]);
  });

  it("question.benignInvalid rejects a benign answer the question cannot give", () => {
    const bad = (q: object) => expect(form([q]), JSON.stringify(q)).toContain(`error question.benignInvalid ${(q as { id: string }).id}`);
    const ok = (q: object) => expect(form([q]).filter((x) => x.includes("benignInvalid")), JSON.stringify(q)).toEqual([]);
    bad({ id: "y", answer: "yes-no", benign: "maybe", policy: pol("yes") });
    bad({ id: "y", answer: "yes-no", benign: 1, policy: pol("yes") });
    ok({ id: "y", answer: "yes-no", benign: "no", policy: pol("no") });
    ok({ id: "y", answer: "yes-no", benign: true, policy: pol("yes") });
    bad({ id: "s", answer: "score", choices: ["0", "1", "2"], benign: 3, policy: pol(0) });
    bad({ id: "s", answer: "score", choices: ["0", "1"], benign: 0.5, policy: pol(0) });
    bad({ id: "s", answer: "score", benign: "high", policy: pol(0) });
    ok({ id: "s", answer: "score", choices: ["0", "1", "2"], benign: 2, policy: pol(2) });
    bad({ id: "c", answer: "choice", choices: ["a", "b"], benign: "z", policy: pol("a", "b") });
    ok({ id: "c", answer: "choice", choices: ["a", "b"], benign: "b", policy: pol("a", "b") });
    ok({ id: "c", answer: "choice", choicesFrom: "members", choices: ["none"], benign: "none", policy: [...pol("none"), { answer: "*", level: "info" }] });
  });

  it("a policy may map an answer to review", () => {
    expect(form([{ id: "c", answer: "choice", choices: ["a", "b"], benign: "a", policy: [...pol("a"), { answer: "b", level: "review" }] }])).toEqual([]);
  });
});
