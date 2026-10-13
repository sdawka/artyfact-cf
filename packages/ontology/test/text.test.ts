/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARTYFACT_GENOME, artyfactGenome, canon, checkTemplateForm, DEFAULT_PLACEHOLDERS, evaluate, isPlaceholder, loadArtyfactSystem,
  loadTemplate, memoryStore, normaliseText, TemplateFormError, TemplateSourceSchema, textWords, type Finding, type Graph, type GraphNode,
  type Readiness, type TemplateInput,
} from "../src/index.ts";
import { productGraphToGraph, productSpec } from "../src/adapters/product/index.ts";
import { systemFiles, templateFiles } from "./artyfact-reference.ts";
import { edbLeaves } from "./fixture.ts";
import { PEOPLING, TIDEPOOL } from "./fixtures/text/degrade.mjs";

const TEXT_RULES = ["text.empty", "text.short", "text.placeholder", "text.sameAsId", "text.sameAsField", "text.pattern"];
const textish = (f: Finding) => f.rule.startsWith("text.") || f.rule === "field.required";
const pairs = (r: Readiness, keep: (f: Finding) => boolean = textish) =>
  r.findings.filter(keep).map((f) => `${f.level} ${f.rule} ${f.subject ?? ""}`).sort();

/** A small template exercising every text key on one kind. */
const doc = (extra: Partial<TemplateInput> = {}): TemplateInput => ({
  id: "template.test.text",
  version: 1,
  meta: 1,
  kinds: {
    doc: {
      fields: [
        { name: "title", type: "string", required: true, minLength: 5, placeholders: ["tbd"], distinctFrom: ["id", "summary"] },
        { name: "summary", type: "string", minWords: 3 },
        { name: "code", type: "string", pattern: "^[A-Z]{3}-\\d+$" },
        { name: "description", type: "string" },
      ],
    },
  },
  ...extra,
});

const graphOf = (fields: Record<string, unknown>, id = "doc.alpha"): Graph => ({
  template: "template.test.text@1",
  nodes: [{ id, kind: "doc", fields: { title: "Quarterly plan", summary: "What we will ship", code: "ABC-12", ...fields } }],
  links: [], declarations: [], evidence: [],
});

const run = (fields: Record<string, unknown>, extra: Partial<TemplateInput> = {}) => evaluate(loadTemplate(doc(extra)), graphOf(fields));
const only = (r: Readiness) => pairs(r);

describe("text@1 rules", () => {
  it("is silent on good content", () => {
    expect(only(run({}))).toEqual([]);
  });

  it.each([
    ["text.empty", "missing", { title: "   " }],
    ["text.short", "missing", { title: "Plan" }],
    ["text.short", "missing", { summary: "Ship it" }],
    ["text.placeholder", "missing", { title: "TBD" }],
    ["text.placeholder", "missing", { title: "Plan: tbd later" }],
    ["text.sameAsId", "warning", { title: "Doc  Alpha!" }],
    ["text.sameAsField", "warning", { title: "What we will ship", summary: "what  we will SHIP." }],
    ["text.pattern", "error", { code: "abc-12" }],
  ] as const)("%s fires as %s", (rule, level, fields) => {
    const r = run(fields);
    expect(only(r)).toEqual([`${level} ${rule} doc.alpha`]);
    const f = r.findings.find((x) => x.rule === rule)!;
    expect(f.pack).toBe("text@1");
    expect(edbLeaves(f.derivation)).toBe(true);
  });

  it("one blank field gives exactly one finding: field.required for an empty string, text.empty for whitespace", () => {
    expect(pairs(run({ title: "" }), () => true)).toEqual(["missing field.required doc.alpha"]);
    expect(pairs(run({ title: " \t " }), () => true)).toEqual(["missing text.empty doc.alpha"]);
  });

  it("a blank optional field is silent, like an absent one", () => {
    expect(only(run({ summary: "   ", code: " " }))).toEqual([]);
    expect(only(run({ summary: "", code: "" }))).toEqual([]);
  });

  it("a placeholder is not also reported as short", () => {
    expect(only(run({ title: "tbd" }))).toEqual(["missing text.placeholder doc.alpha"]);
  });

  it("findings name the node; the field and measurement are derivation leaves", () => {
    const f = run({ title: "Plan" }).findings.find((x) => x.rule === "text.short")!;
    expect(f.facts).toContainEqual(["fieldLen", "doc.alpha", "title", 4]);
    expect(f.facts).toContainEqual(["textMinLen", "doc", "title", 5]);
    for (const x of f.facts) expect(typeof x[0]).toBe("string");
  });

  it("is deterministic", () => {
    const a = run({ title: "TBD", summary: "Ship", code: "x" }), b = run({ title: "TBD", summary: "Ship", code: "x" });
    expect(canon(a)).toBe(canon(b));
    expect(pairs(a)).toEqual(["error text.pattern doc.alpha", "missing text.placeholder doc.alpha", "missing text.short doc.alpha"]);
  });

  it("text.empty applies to every required field, also without any text constraint", () => {
    const t = loadTemplate({ id: "template.test.plain", version: 1, meta: 1, kinds: { k: { fields: [{ name: "label", type: "string", required: true }] } } });
    const g = (label: string): Graph => ({ template: t.ref, nodes: [{ id: "n", kind: "k", fields: { label } }], links: [], declarations: [], evidence: [] });
    expect(pairs(evaluate(t, g("  ")), () => true)).toEqual(["missing text.empty n"]);
    expect(pairs(evaluate(t, g("TBD")), () => true)).toEqual([]);
  });
});

describe("textDefaults", () => {
  const plain = (extra: Partial<TemplateInput> = {}) => run({ description: "TBD" }, extra);

  it("is off unless the template opts in", () => {
    expect(only(plain())).toEqual([]);
    expect(only(plain({ textDefaults: {} }))).toEqual(["missing text.placeholder doc.alpha"]);
  });

  it("uses the engine tokens only when no placeholders are given", () => {
    expect(DEFAULT_PLACEHOLDERS).toContain("to be determined");
    expect(only(plain({ textDefaults: { placeholders: ["wip"] } }))).toEqual([]);
    expect(only(run({ description: "WIP" }, { textDefaults: { placeholders: ["wip"] } }))).toEqual(["missing text.placeholder doc.alpha"]);
  });

  it("applies to title too, and a field's own keys win key by key", () => {
    // title declares placeholders ["tbd"]; the default list does not reach it, the default minWords does.
    expect(only(run({ title: "Lorem ipsum" }, { textDefaults: { minWords: 3 } }))).toEqual(["missing text.short doc.alpha"]);
    expect(only(run({ title: "Lorem ipsum sit amet" }, { textDefaults: {} }))).toEqual([]);
  });

  it("a default distinctFrom keeps only id and fields the kind declares", () => {
    expect(only(run({ description: "doc.alpha" }, { textDefaults: { distinctFrom: ["id", "summary"] } }))).toEqual(["warning text.sameAsId doc.alpha"]);
    expect(only(run({ description: "What we will ship" }, { textDefaults: { distinctFrom: ["summary"] } }))).toEqual(["warning text.sameAsField doc.alpha"]);
  });

  it("is inherited through extends, and a child's textDefaults wins wholesale", () => {
    const parent = { ...doc({ textDefaults: { placeholders: ["wip"] } }), id: "template.test.parent" };
    const store = memoryStore([parent]);
    const child = (extra: object = {}) => loadTemplate({ id: "template.test.text", version: 1, meta: 1, extends: "template.test.parent@1", ...extra }, store);
    expect(child().textDefaults).toEqual({ placeholders: ["wip"] });
    expect(only(evaluate(child(), graphOf({ description: "wip" })))).toEqual(["missing text.placeholder doc.alpha"]);
    expect(only(evaluate(child({ textDefaults: {} }), graphOf({ description: "wip" })))).toEqual([]);
  });

  it("leaves a template without text keys hashed as before", () => {
    const t = loadTemplate(doc());
    expect("textDefaults" in t).toBe(false);
  });
});

describe("meta@1 text form checks", () => {
  const formRules = (extra: Partial<TemplateInput> = {}, fields?: unknown[]) => {
    const src = doc(extra) as { kinds: Record<string, { fields: unknown[] }> };
    if (fields) src.kinds.doc!.fields = fields;
    return checkTemplateForm(loadTemplate(src)).findings.map((f) => `${f.rule} ${f.subject}`);
  };

  it("accepts the valid template", () => {
    expect(formRules()).toEqual([]);
  });

  it.each([
    ["kind.textDistinctUnknown doc", [{ name: "title", type: "string", distinctFrom: ["subtitle"] }]],
    ["kind.textDistinctSelf doc", [{ name: "title", type: "string", distinctFrom: ["title"] }]],
    ["kind.textPatternInvalid doc", [{ name: "title", type: "string", pattern: "([a-z" }]],
    ["kind.textBoundNegative doc", [{ name: "title", type: "string", minLength: -1 }]],
    ["kind.textBoundNegative doc", [{ name: "title", type: "string", minWords: -2 }]],
  ])("%s", (expected, fields) => {
    expect(formRules({}, fields)).toEqual([expected]);
  });

  it.each([
    ["template.textBoundNegative template.test.text@1", { minWords: -1 }],
    ["template.textPatternInvalid template.test.text@1", { pattern: "*" }],
    ["template.textDistinctUnknown template.test.text@1", { distinctFrom: ["subtitle"] }],
  ])("%s", (expected, textDefaults) => {
    expect(formRules({ textDefaults })).toEqual([expected]);
  });

  it("an invalid template cannot be evaluated", () => {
    expect(() => run({}, { textDefaults: { pattern: "(" } })).toThrow(TemplateFormError);
  });

  it("keeps schemas strict", () => {
    expect(() => TemplateSourceSchema.parse(doc({ textDefaults: { maxLength: 3 } as never }))).toThrow();
    expect(() => loadTemplate(formTemplate({ minLength: 2.5 }))).toThrow();
    expect(() => loadTemplate(formTemplate({ placeholders: [""] }))).toThrow();
  });
});

const formTemplate = (field: object): TemplateInput =>
  ({ id: "template.test.form", version: 1, meta: 1, kinds: { k: { fields: [{ name: "title", type: "string", ...field }] } } }) as TemplateInput;

describe("text helpers", () => {
  it.each([
    ["TBD", "tbd", true], ["  tbd  ", "TBD", true], ["Todo list app", "todo", true], ["Todoist sync", "todo", false],
    ["really???", "???", false], ["TBD ???", "???", true], ["n/a.", "n/a", true], ["Lorem   Ipsum dolor", "lorem ipsum", true],
    ["Template placeholder, superseded", "placeholder", true],
  ] as const)("isPlaceholder(%j, %j) is %s", (v, t, want) => {
    expect(isPlaceholder(v, t)).toBe(want);
  });

  it("normalises and counts words", () => {
    expect(normaliseText("  Screen.SignIn -- ")).toBe(normaliseText("screen signin"));
    expect(textWords("Saves. — ok")).toBe(2);
  });
});

/** Sloppy content through the real adapters, with defaults switched on in test-local templates. */
describe("sloppy content", () => {
  const ONTOLOGY = "things/webapp/ontology.yaml";
  const DESCRIBED = ["screen", "entity", "operation", "policy", "binding", "section"];
  const NAMED = [...DESCRIBED, "component", "affordance"];
  type K = { fields: { name: string }[] };
  const genomeKinds = artyfactGenome.kinds as Record<string, K>;

  /** Peopling: placeholders by default; every listed kind needs a two-word description; names must not repeat ids. */
  const kitTemplate = loadTemplate({
    id: "template.test.text-peopling", version: 1, meta: 1, extends: ARTYFACT_GENOME,
    textDefaults: {},
    kinds: Object.fromEntries(NAMED.map((k) => [k, {
      ...genomeKinds[k],
      fields: genomeKinds[k]!.fields.map((f) =>
        f.name === "description" && DESCRIBED.includes(k) ? { ...f, required: true, minWords: 2 }
          : f.name === "name" ? { ...f, distinctFrom: ["id"] } : f),
    }])),
  }, memoryStore([artyfactGenome]));

  const peopling = (ontology?: string): Readiness => {
    const files = systemFiles();
    if (ontology !== undefined) files[ONTOLOGY] = ontology;
    const g = loadArtyfactSystem(files, { templates: templateFiles() });
    return evaluate(kitTemplate, { ...g, template: kitTemplate.ref });
  };
  const sloppyPeopling = readFileSync(new URL("./fixtures/text/peopling.ontology.sloppy.yaml", import.meta.url), "utf8");

  /** tidepool: product-spec with defaults on, titles distinct from ids, and a purpose of at least three words. */
  const productKinds = productSpec.kinds as Record<string, K>;
  const tideTemplate = loadTemplate({
    id: "template.test.text-product", version: 1, meta: 1, extends: "template.meta.product-spec@1",
    textDefaults: { distinctFrom: ["id"] },
    kinds: { purpose: { ...productKinds.purpose, fields: productKinds.purpose!.fields.map((f) => (f.name === "title" ? { ...f, minWords: 3 } : f)) } },
  }, memoryStore([productSpec]));
  const fx = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
  const tide = (file: string) => evaluate(tideTemplate, productGraphToGraph(fx(file), { template: tideTemplate.ref }));

  it("both test templates are form-valid", () => {
    expect(checkTemplateForm(kitTemplate).valid).toBe(true);
    expect(checkTemplateForm(tideTemplate).valid).toBe(true);
  });

  it("the degraded Peopling ontology changes exactly the ten listed nodes", () => {
    const load = (o?: string) => {
      const files = systemFiles();
      if (o !== undefined) files[ONTOLOGY] = o;
      return new Map(loadArtyfactSystem(files, { templates: templateFiles() }).nodes.map((n) => [n.id, n] as [string, GraphNode]));
    };
    const a = load(), b = load(sloppyPeopling);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    const changed = [...a.keys()].filter((id) => canon(a.get(id)) !== canon(b.get(id))).sort();
    expect(changed).toEqual(PEOPLING.map(([id]) => id).sort());
  });

  it("real Peopling content gives one text finding: binding.d1, whose description calls it a placeholder", () => {
    const r = peopling();
    expect(pairs(r)).toEqual(["missing text.placeholder binding.d1"]);
    expect(r.findings.find((f) => f.rule === "text.placeholder")!.facts).toContainEqual(["fieldPlaceholder", "binding.d1", "description", "placeholder"]);
  });

  it("degraded Peopling gives one finding per degraded node, plus the known binding.d1", () => {
    const r = peopling(sloppyPeopling);
    expect(pairs(r)).toEqual([
      "missing field.required screen.signin",
      "missing text.empty screen.today",
      "missing text.placeholder binding.d1",
      "missing text.placeholder entity.Account",
      "missing text.placeholder entity.Block",
      "missing text.placeholder operation.contact.save",
      "missing text.placeholder policy.ownerOnly",
      "missing text.short entity.Suggestion",
      "missing text.short operation.goal.save",
      "warning text.sameAsId component.PrimaryNav",
      "warning text.sameAsId component.TodayHeading",
    ]);
    for (const f of r.findings.filter(textish)) expect(edbLeaves(f.derivation)).toBe(true);
    expect(r.actionable).toBe(false);
  });

  it("the degraded tidepool graph changes exactly the ten listed nodes", () => {
    const a = fx("./fixtures/product/tidepool.graph.json"), b = fx("./fixtures/text/tidepool.sloppy.graph.json");
    const changed = a.nodes.filter((n: { id: string }, i: number) => canon(n) !== canon(b.nodes[i])).map((n: { id: string }) => n.id).sort();
    expect(changed).toEqual(TIDEPOOL.map(([id]) => id).sort());
  });

  it("real tidepool content gives no text finding", () => {
    expect(pairs(tide("./fixtures/product/tidepool.graph.json"))).toEqual([]);
  });

  it("degraded tidepool gives one finding per degraded node", () => {
    const r = tide("./fixtures/text/tidepool.sloppy.graph.json");
    expect(pairs(r)).toEqual([
      "missing field.required audience-weekend-shore-volunteer",
      "missing text.empty audience-marine-biologist-running-a-monitoring",
      "missing text.placeholder capability-expert-verification",
      "missing text.placeholder context-rocky-intertidal-sites-with-no-mobile",
      "missing text.placeholder feature-low-tide-reminders",
      "missing text.placeholder summary-an-offline-first-field-app-for-timed",
      "missing text.placeholder thing-quadrat",
      "missing text.short purpose-turn-volunteer-shore-walks-into-survey",
      "warning text.sameAsId capability-field-capture",
      "warning text.sameAsId thing-observation",
    ]);
    for (const f of r.findings.filter(textish)) expect(edbLeaves(f.derivation)).toBe(true);
    expect(TEXT_RULES.filter((x) => x !== "text.sameAsField" && x !== "text.pattern").every((x) => r.findings.some((f) => f.rule === x))).toBe(true);
  });

  it.each(["bropilot", "lfp", "ledgerly"])("real %s content gives no text finding with the defaults on", (p) => {
    expect(pairs(tide(`./fixtures/product/${p}.graph.json`), (f) => f.rule.startsWith("text."))).toEqual([]);
  });
});
