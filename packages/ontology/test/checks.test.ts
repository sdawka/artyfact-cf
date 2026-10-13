import { describe, expect, it } from "vitest";
import {
  ARTYFACT_CHECKS, artyfactGenome, checkFacts, checkQuestions, checkTemplateForm, evaluate, evaluateAndJudge, fakeSystemOne, loadTemplate,
  memoryStore, NOT_APPLICABLE, withSemanticProbes, type Check, type Graph, type S1Questions, type SystemOne, type TemplateInput,
} from "../src/index.ts";
import { GIVEN_WHEN_THEN, PRODUCT_KIND_CHECKS, productSpec } from "../src/adapters/product/index.ts";

const GWT = "\\b[Gg]iven\\b[\\s\\S]*\\b[Ww]hen\\b[\\s\\S]*\\b[Tt]hen\\b";
const text = [{ name: "title", type: "string" }, { name: "description", type: "string" }] as const;

const app = (extra: Partial<TemplateInput> = {}, checks: Record<string, Check[]> = {}): TemplateInput => ({
  id: "template.test.app", version: 1, meta: 1,
  kinds: {
    app: { fields: [...text], checks: checks.app ?? [] },
    screen: {
      fields: [...text], parents: ["app"], criteria: { noun: "screen" },
      checks: checks.screen ?? [{ id: "signifiers", text: "States explicit signifiers, affordances and feedback for each control." }],
    },
    component: {
      fields: [...text, { name: "data", type: "string" }], parents: ["screen"],
      checks: checks.component ?? [
        { id: "emptyState", text: "Declares an empty state.", when: { pattern: "\\b([Ss]hows?|[Ll]ists?)\\b" } },
        { id: "loadingState", text: "Declares a loading state when it shows non-static data.", na: true, level: "info" },
      ],
    },
    usecase: {
      fields: [...text], parents: ["app"],
      checks: checks.usecase ?? [{ id: "gwt", text: "Is written as Given / When / Then.", pattern: GWT, level: "error" }],
    },
  },
  ...extra,
});

const graph = (): Graph => ({
  template: "template.test.app@1",
  nodes: [
    { id: "a", kind: "app", fields: { title: "App", description: "A contacts app." } },
    { id: "home", kind: "screen", parent: "a", fields: { title: "Home", description: "Lists contacts; each row highlights on hover." } },
    { id: "list", kind: "component", parent: "home", fields: { title: "List", description: "Lists contacts from the server." } },
    { id: "logo", kind: "component", parent: "home", fields: { title: "Logo", description: "The brand mark." } },
    { id: "u1", kind: "usecase", parent: "a", fields: { title: "Add", description: "Given a signed-in user, when they add a contact, then it appears first." } },
    { id: "u2", kind: "usecase", parent: "a", fields: { title: "Find", description: "The user searches for a contact by name." } },
    { id: "u3", kind: "usecase", parent: "a", fields: { title: "Blank", description: "   " } },
  ],
  links: [], declarations: [], evidence: [],
});

const rules = (fs: { rule: string; subject?: string }[], prefix: string) =>
  fs.filter((f) => f.rule.startsWith(prefix)).map((f) => `${f.rule} ${f.subject}`).sort();

describe("checks in meta@1", () => {
  it("accepts checks, keeps the hash when absent, and merges them across extends by id", () => {
    expect(checkTemplateForm(loadTemplate(app())).findings).toEqual([]);
    const bare = app();
    for (const k of Object.values(bare.kinds!)) delete (k as { checks?: unknown }).checks;
    const empty = loadTemplate(bare);
    expect(empty.kinds.screen).not.toHaveProperty("checks");
    expect(empty).not.toHaveProperty("rootChecks");
    expect(empty.hash).toBe(loadTemplate(JSON.parse(JSON.stringify(bare))).hash);
    expect(loadTemplate(app()).hash).not.toBe(empty.hash);

    const parent = app({ rootChecks: [{ id: "named", text: "Names the product." }] });
    const child: TemplateInput = {
      id: "template.test.child", version: 1, meta: 1, extends: "template.test.app@1",
      kinds: { component: { fields: [...text, { name: "data", type: "string" }], parents: ["screen"], checks: [
        { id: "emptyState", text: "Declares an empty state and a call to action.", level: "error" },
        { id: "errorState", text: "Declares an error state." },
      ] } },
      rootChecks: [{ id: "owner", text: "Names an owner." }],
    };
    const t = loadTemplate(child, memoryStore([parent]));
    expect(t.kinds.component!.checks!.map((c) => [c.id, c.text])).toEqual([
      ["loadingState", "Declares a loading state when it shows non-static data."],
      ["emptyState", "Declares an empty state and a call to action."],
      ["errorState", "Declares an error state."],
    ]);
    expect(t.kinds.screen!.checks!.map((c) => c.id)).toEqual(["signifiers"]);
    expect(t.rootChecks!.map((c) => c.id)).toEqual(["named", "owner"]);
  });

  it("reports duplicate ids, unknown defects and fields, invalid patterns and unknown levels", () => {
    const bad = loadTemplate(app({}, {
      screen: [
        { id: "x", text: "One." }, { id: "x", text: "Two." },
        { id: "d", text: "Defect.", defect: "instance.nope" },
        { id: "w", text: "When.", when: { field: "colour" } },
        { id: "p", text: "Pattern.", pattern: "([" },
        { id: "wp", text: "When pattern.", when: { pattern: "(" } },
        { id: "l", text: "Level.", level: "fatal" },
      ],
      app: [{ id: "kids", text: "Children.", scope: "children", when: { field: "data" } }],
    }));
    const form = checkTemplateForm(bad);
    expect(form.valid).toBe(false);
    expect(form.findings.map((f) => `${f.rule} ${f.subject}`).sort()).toEqual([
      "check.defectUnknown check:screen.d",
      "check.idDuplicate check:screen.x",
      "check.levelUnknown check:screen.l",
      "check.patternInvalid check:screen.p",
      "check.patternInvalid check:screen.wp",
      "check.whenFieldUnknown check:screen.w",
    ]);
  });
});

describe("checks@1", () => {
  it("emits a candidate per applicable node, a deterministic finding without a provider, and nothing for a blank field", () => {
    const r = evaluate(loadTemplate(app()), graph());
    expect(r.packs.map((p) => `${p.id}@${p.version}`)).toContain("checks@1");
    expect(rules(r.findings, "semantic:check:")).toEqual([
      "semantic:check:component.emptyState list",
      "semantic:check:component.loadingState list",
      "semantic:check:component.loadingState logo",
      "semantic:check:screen.signifiers home",
    ]);
    expect(rules(r.findings, "check:")).toEqual(["check:usecase.gwt u2"]);
    const gwt = r.findings.find((f) => f.rule === "check:usecase.gwt")!;
    expect(gwt).toMatchObject({ level: "error", pack: "checks@1" });
    expect(gwt.message).toBe("u2 does not meet a usecase check: Is written as Given / When / Then.");
    expect(r.actionable).toBe(false);
  });

  it("leaves evaluation unchanged for a template without checks", () => {
    const bare = app();
    for (const k of Object.values(bare.kinds!)) delete (k as { checks?: unknown }).checks;
    const r = evaluate(loadTemplate(bare), graph());
    expect(r.packs.map((p) => p.id)).toEqual(["metamodel", "completeness", "consistency", "text"]);
    expect(r.findings.some((f) => f.rule.includes("check:"))).toBe(false);
  });

  it("applies children and pair scope to the parent's matching children, and root checks to parentless nodes", () => {
    const t = loadTemplate(app({ rootChecks: [{ id: "purpose", text: "States who the product is for." }] }, {
      app: [
        { id: "flows", text: "Together cover sign-up to first contact.", scope: "children", when: { kind: "usecase" } },
        { id: "distinct", text: "Do not describe the same journey twice.", scope: "pair", when: { kind: "usecase" } },
        { id: "noScreensWithData", text: "Screens show data.", scope: "children", when: { kind: "screen", field: "data" } },
      ],
    }));
    const f = checkFacts(t, graph());
    expect(f.checkCandidate).toEqual([
      ["check:app.flows", "a", "A contacts app."],
      ["check:app.distinct", "u1|u2", "Given a signed-in user, when they add a contact, then it appears first."],
      ["check:screen.signifiers", "home", "Lists contacts; each row highlights on hover."],
      ["check:component.emptyState", "list", "Lists contacts from the server."],
      ["check:component.loadingState", "list", "Lists contacts from the server."],
      ["check:component.loadingState", "logo", "The brand mark."],
      ["check:root.purpose", "a", "A contacts app."],
    ]);
    expect(f.checkMiss).toEqual([["check:usecase.gwt", "u2", "hard"]]);
  });
});

describe("check questions", () => {
  const probed = () => loadTemplate(withSemanticProbes(app({ rootChecks: [{ id: "purpose", text: "States who the product is for.", scope: "children" }] })));

  it("asks one question per semantic check, worded with the kind's noun and the check", () => {
    const t = probed();
    const qs = t.questions.filter((q) => q.id.startsWith("check:"));
    expect(qs.map((q) => q.id)).toEqual(["check:screen.signifiers", "check:component.emptyState", "check:component.loadingState", "check:root.purpose"]);
    const sig = qs[0]!;
    expect(sig).toMatchObject({ answer: "yes-no", benign: "yes", defect: "instance" });
    expect(sig.text).toBe("Does state.subject, a screen, satisfy this criterion: States explicit signifiers, affordances and feedback for each control? "
      + "Its statement is state.candidate.text; state.parents give its context.");
    expect(sig.policy).toEqual([{ answer: "yes", level: "pass" }, { answer: "no", level: "warning", defect: "instance" }]);
    expect(sig.slice).toEqual(t.questions.find((q) => q.id === "node.kind")!.slice);
    const load = qs[2]!;
    expect(load).toMatchObject({ answer: "choice", benign: "yes", choices: ["yes", "no", NOT_APPLICABLE] });
    expect(load.policy).toEqual([{ answer: "yes", level: "pass" }, { answer: "no", level: "info", defect: "instance" }, { answer: NOT_APPLICABLE, level: "pass" }]);
    expect(qs[3]!.text).toContain("Do the members state.members of state.subject, a top-level item, together satisfy: States who the product is for?");
    expect(qs[3]!.defect).toBe("consistency");
    expect(checkQuestions(app()).map((q) => q.id)).not.toContain("check:usecase.gwt");
    expect(checkTemplateForm(t).valid).toBe(true);
  });

  it("judges check candidates through the funnel, batched with the stage-1 questions, into check findings", async () => {
    const g = graph();
    g.nodes.find((n) => n.id === "home")!.fields.description = "Lists contacts. #s1:check:screen.signifiers=no";
    g.nodes.find((n) => n.id === "logo")!.fields.description = "The brand mark. #s1:check:component.loadingState=notApplicable";
    const sent: S1Questions[] = [];
    const fake = fakeSystemOne();
    const s1: SystemOne = { ...fake, ask: (state, questions, o) => { sent.push(questions); return fake.ask(state, questions, o); } };
    const r = await evaluateAndJudge(probed(), g, s1);
    const of = (rule: string, subject: string) => r.findings.find((f) => f.rule === rule && f.subject === subject)!;
    expect(of("semantic:check:screen.signifiers", "home")).toMatchObject({
      level: "warning", judgment: { question: "check:screen.signifiers", check: "signifiers", answer: "no", defect: "instance", status: "confident" },
    });
    expect(of("semantic:check:component.loadingState", "logo")).toMatchObject({ level: "pass", judgment: { answer: NOT_APPLICABLE, check: "loadingState" } });
    expect(of("semantic:check:component.emptyState", "list")).toMatchObject({ level: "pass", judgment: { answer: "yes" } });
    expect(of("check:usecase.gwt", "u2").level).toBe("error");
    expect(sent.some((b) => b["check:screen.signifiers"] && b["node.kind"])).toBe(true);
  });
});

describe("checklists in the shipped templates", () => {
  it("puts the screen, component, use case and feature checks on their kinds, and both templates stay form-valid", () => {
    const art = loadTemplate(artyfactGenome);
    expect(Object.fromEntries(Object.entries(art.kinds).filter(([, k]) => k.checks).map(([k, x]) => [k, x.checks!.map((c) => c.id)])))
      .toEqual({ screen: ["signifiers"], component: ["emptyState", "loadingState"] });
    expect(ARTYFACT_CHECKS.component![1]).toMatchObject({ na: true });
    const prod = loadTemplate(productSpec);
    expect(Object.fromEntries(Object.entries(prod.kinds).filter(([, k]) => k.checks).map(([k, x]) => [k, x.checks!.map((c) => c.id)])))
      .toEqual({ usecase: ["givenWhenThen"], screen: ["signifiers"], feature: ["userAndTrigger"] });
    expect(PRODUCT_KIND_CHECKS.usecase![0]!.pattern).toBe(GIVEN_WHEN_THEN);
    for (const t of [art, prod]) expect(checkTemplateForm(t)).toMatchObject({ valid: true, findings: [] });
  });

  it("reads Given / When / Then in order, capitalised or not, as whole words", () => {
    const re = new RegExp(GIVEN_WHEN_THEN);
    expect(re.test("Given a user, when they save, then the row appears.")).toBe(true);
    expect(re.test("Given x\nWhen y\nThen z")).toBe(true);
    expect(re.test("When they save, then it appears, given a user.")).toBe(false);
    expect(re.test("Forgiven whenever thenceforth.")).toBe(false);
  });
});
