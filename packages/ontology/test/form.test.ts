import { describe, expect, it } from "vitest";
import { checkTemplateForm, evaluate, loadTemplate, memoryStore, TemplateFormError } from "../src/index.ts";
import { base, board, clean, edbLeaves } from "./fixture.ts";

type Raw = ReturnType<typeof board> & Record<string, unknown>;
const store = memoryStore([base()]);
const form = (raw: unknown, s = store) => checkTemplateForm(loadTemplate(raw, s), s);
const edit = (f: (t: Raw) => void) => { const t = board() as Raw; f(t); return t; };

describe("template form", () => {
  it("accepts the fixture", () => {
    const r = form(board());
    expect(r.findings).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.hash).toBe(loadTemplate(board(), store).hash);
  });

  const cases: [rule: string, subject: string, raw: () => unknown, s?: ReturnType<typeof memoryStore>][] = [
    ["relation.endpointUnknown", "blocks", () => edit((t) => { t.relations.blocks.to = ["ticket"]; })],
    ["relation.inverseUnknown", "blocks", () => edit((t) => { Object.assign(t.relations.blocks, { inverse: "blockedBy" }); })],
    ["kind.parentUnknown", "card", () => edit((t) => { t.kinds.card.parents = ["lane"]; })],
    ["kind.fieldUnknown", "board", () => edit((t) => { Object.assign(t.kinds.board.completeness, { fields: ["deadline"] }); })],
    ["kind.childUnknown", "board", () => edit((t) => { t.kinds.board.completeness.children.push({ kind: "lane", cardinality: "0..*" }); })],
    ["kind.childUnsatisfiable", "card", () => edit((t) => { Object.assign(t.kinds.card.completeness, { children: [{ kind: "card", cardinality: "1" }] }); })],
    ["kind.relationUnknown", "card", () => edit((t) => { t.kinds.card.completeness.relations.push({ rel: "owns", cardinality: "0..1" }); })],
    ["kind.relationUnsatisfiable", "board", () => edit((t) => { Object.assign(t.kinds.board.completeness, { relations: [{ rel: "blocks", cardinality: "1" }] }); })],
    ["constraint.relationUnknown", "no-blocking-loop", () => edit((t) => { t.constraints.forbiddenCycles[0].relations = ["follows"]; })],
    ["constraint.kindUnknown", "boards-complete", () => edit((t) => { t.constraints.complete[0].kind = "lane"; })],
    ["constraint.fieldUnknown", "archived-open", () => edit((t) => { t.constraints.incompatible[0].when[0].field = "deleted"; })],
    ["template.extendsUnknown", "template.test.board@1", () => edit((t) => { t.extends = "template.test.missing@1"; })],
    ["template.extendsCycle", "template.test.base@1", () => board(),
      memoryStore([{ ...base(), extends: "template.test.board@1" }, board()])],
    ["rules.parse", "board@1", () => edit((t) => { t.rules[0].source += "\nwarning(\"x\",C) :- nowhere(C)."; })],
    ["rules.stratify", "board@1", () => edit((t) => { t.rules[0].source += "\n.decl p(X: sym)\np(X) :- node(X,_,_), not p(X)."; })],
    ["rules.unknownRelation", "board@1:violation", () => edit((t) => {
      t.rules[0].source += "\n.decl violation(Rule: sym, Subject: sym, Severity: sym)\nwarning(\"x\",S) :- violation(_,S,_).";
    })],
    ["criterion.subjectKindUnknown", "crit.card-titled", () => edit((t) => { t.criteria[0].subject = "ticket"; })],
    ["question.levelUnknown", "card.vague", () => edit((t) => { t.questions[0].policy[0].level = "fatal"; })],
    ["question.sliceKindUnknown", "card.vague", () => edit((t) => { Object.assign(t.questions[0].slice, { kinds: ["lane"] }); })],
    ["question.sliceRelationUnknown", "card.vague", () => edit((t) => { Object.assign(t.questions[0].slice, { rels: ["follows"] }); })],
    ["question.defectUnknown", "card.vague", () => edit((t) => { Object.assign(t.questions[0], { defect: "specificity.nope" }); })],
    ["policy.defectUnknown", "card.vague", () => edit((t) => { Object.assign(t.questions[0].policy[0], { defect: "nope" }); })],
    ["question.nextUnknown", "card.vague", () => edit((t) => { Object.assign(t.questions[0], { next: [{ answer: "yes", ask: "card.ghost" }] }); })],
    ["question.nextCycle", "card.vague", () => edit((t) => { Object.assign(t.questions[0], { next: [{ answer: "yes", ask: "card.vague" }] }); })],
    ["question.batchUnknown", "card.vague", () => edit((t) => { Object.assign(t.questions[0], { batchWith: ["card.ghost"] }); })],
    ["question.byKindUnknown", "card.vague", () => edit((t) => { Object.assign(t.questions[0], { byKind: { lane: "lane" } }); })],
    ["defect.disableUnknown", "coherence.nope", () => edit((t) => { Object.assign(t, { defects: { disable: ["coherence.nope"] } }); })],
    ["defect.levelUnknown", "nope", () => edit((t) => { Object.assign(t, { defects: { levels: { nope: "error" } } }); })],
    ["node.kindUnknown", "$self.inbox", () => edit((t) => { t.nodes[0].kind = "ticket"; })],
    ["node.relationUnknown", "$self.inbox", () => edit((t) => { Object.assign(t.nodes[0], { links: [{ rel: "mentions", to: "$self" }] }); })],
  ];

  for (const [rule, subject, raw, s] of cases) {
    it(`flags ${rule}`, () => {
      const r = form(raw(), s);
      expect(r.valid).toBe(false);
      const hits = r.findings.filter((f) => f.rule === rule);
      expect(hits.map((f) => f.subject)).toContain(subject);
      for (const f of r.findings) {
        expect(f.pack).toBe("meta@1");
        expect(edbLeaves(f.derivation)).toBe(true);
      }
    });
  }
});

describe("defect and follow-up form", () => {
  const q2 = (extra: Record<string, unknown> = {}) => ({
    id: "card.which", answer: "choice", choices: ["abstract", "none"], benign: "none",
    policy: [{ answer: "none", level: "pass" }, { answer: "abstract", level: "warning", defect: "specificity.abstract" }], ...extra,
  });

  it("accepts known defects, follow-ups, batches, kind wording and overrides", () => {
    const r = form(edit((t) => {
      Object.assign(t.questions[0], {
        defect: "specificity", byKind: { card: "card", board: JSON.stringify({ noun: "board" }) }, batchWith: ["card.which"],
        next: [{ answer: "yes", ask: "card.which" }],
      });
      (t.questions as unknown[]).push(q2({ defect: `instance.otherKind.card` }));
      Object.assign(t, { defects: { disable: ["coherence.termDrift"], levels: { "specificity.abstract": "error", "instance.otherKind.board": "info" } } });
    }));
    expect(r.findings).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("flags every question on a longer follow-up cycle and nothing off it", () => {
    const r = form(edit((t) => {
      Object.assign(t.questions[0], { next: [{ answer: "yes", ask: "card.which" }] });
      (t.questions as unknown[]).push(q2({ next: [{ answer: "abstract", ask: "card.vague" }] }), q2({ id: "card.tail" }));
    }));
    expect(r.findings.filter((f) => f.rule === "question.nextCycle").map((f) => f.subject).sort()).toEqual(["card.vague", "card.which"]);
  });
});

describe("evaluate refuses an invalid template", () => {
  it("throws TemplateFormError naming the rule and template hash", () => {
    const t = loadTemplate(edit((x) => { x.criteria[0].subject = "ticket"; }), store);
    let err: unknown;
    try { evaluate(t, clean()); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TemplateFormError);
    const e = err as TemplateFormError;
    expect(e.rule).toBe("criterion.subjectKindUnknown");
    expect(e.templateHash).toBe(t.hash);
    expect(e.message).toContain("criterion.subjectKindUnknown");
    expect(e.message).toContain(t.hash);
  });
});

describe("kind and root criteria form", () => {
  it("accepts criteria within bounds", () => {
    const r = form(edit((t) => {
      Object.assign(t.kinds.card, { criteria: { noun: "card", instanceOf: "A card is one piece of work.", minScore: 4, children: "x" } });
      Object.assign(t, { rootCriteria: { sections: "Lanes share one board." } });
    }));
    expect(r.findings).toEqual([]);
  });

  it("flags a minimum tangibility score outside 0 to 4 as an error", () => {
    for (const minScore of [-1, 5]) {
      const r = form(edit((t) => { Object.assign(t.kinds.card, { criteria: { minScore } }); }));
      expect(r.valid).toBe(false);
      expect(r.findings.filter((f) => f.rule === "criteria.minScoreRange").map((f) => f.subject)).toEqual(["card"]);
    }
  });

  it("warns about a kind or root criterion longer than 255 characters", () => {
    const long = "x".repeat(256);
    const r = form(edit((t) => {
      Object.assign(t.kinds.card, { criteria: { children: long } });
      Object.assign(t, { rootCriteria: { terms: long } });
    }));
    expect(r.valid).toBe(true);
    const hits = r.findings.filter((f) => f.rule === "criteria.tooLong");
    expect(hits.map((f) => f.subject).sort()).toEqual(["card", "template.test.board@1"]);
    expect(hits.every((f) => f.level === "warning")).toBe(true);
  });
});
