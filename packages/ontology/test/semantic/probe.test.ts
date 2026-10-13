import { describe, expect, it } from "vitest";
import {
  buildSlice, canon, CHECK_PREFIX, checkTemplateForm, evaluate, evaluateAndJudge, fakeSystemOne, loadTemplate, PAIR_PREFIX, pairOf,
  PROBE_RULES_V2, PROBE_SOURCE, PROBE_SOURCE_V2, type SemanticProbeOptions, SEMANTIC_RULES_V1, semanticCatalogue, semanticProbe,
  SliceSchema, toWire, withSemanticProbes, type Graph, type ProbeOptions,
} from "../../src/index.ts";
import { productSpec } from "../../src/adapters/product/index.ts";
import {
  probeFindings, PROBE_RULES_V1 as PROBE_RULES, SETTINGS as SETTINGS_V2, SETTINGS_V1 as SETTINGS, subjectOf, subjectsOf,
  VOCABULARIES as V2_VOCABULARIES, VOCABULARIES_V1 as VOCABULARIES, type Vocabulary,
} from "./vocabularies.ts";

/**
 * Provider calls a v1 run makes per fixture (one per candidate, before retries). The committed v1 live results were
 * recorded at 233, 18 and 10, before the v2 plants were added to the degraded fixtures.
 */
const LIVE_CALLS: Record<string, number> = { artyfact: 274, product: 32, world: 11 };
const SETTING_OF: Record<string, ProbeOptions> = { artyfact: SETTINGS.artyfact, product: SETTINGS.product, world: SETTINGS.world };

/** An independent reading of `semantic.probe@1` over the graph: `rule subject text` for every candidate it should emit. */
function oracle(g: Graph, o: ProbeOptions, asked: Set<string>): string[] {
  const statements = new Map<string, string[]>();
  for (const n of g.nodes) for (const f of o.texts ?? ["description"]) {
    const v = n.fields[f];
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && x !== "") statements.set(n.id, [...(statements.get(n.id) ?? []), x]);
  }
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const out = new Set<string>();
  for (const [id, texts] of statements) for (const t of texts) {
    if (asked.has("text.vague")) out.add(`text.vague ${id} ${t}`);
    if (asked.has("text.unmeasurable") && (o.measurable ?? []).includes(kind.get(id)!)) out.add(`text.unmeasurable ${id} ${t}`);
    if (asked.has("criterion.unfalsifiable") && (o.criteria ?? []).includes(kind.get(id)!)) out.add(`criterion.unfalsifiable ${id} ${t}`);
  }
  if (asked.has("pair.contradiction")) {
    const pair = (a: string, b: string) => { if (a !== b && statements.has(a) && statements.has(b)) out.add(`pair.contradiction ${[a, b].sort().join(" ")}`); };
    for (const l of g.links) if ((o.probePairs ?? []).includes(l.rel)) pair(l.from, l.to);
    const sib = (k: string) => (o.siblings ?? ["*"]).includes("*") || (o.siblings ?? []).includes(k);
    for (const a of g.nodes) for (const b of g.nodes) {
      if (a.parent && a.parent === b.parent && sib(a.kind) && sib(b.kind)) pair(a.id, b.id);
    }
  }
  return [...out].sort();
}

const emitted = (v: Vocabulary) =>
  probeFindings(evaluate(v.template, v.graph)).filter((f) => PROBE_RULES.includes(f.rule.slice("semantic:".length))).map((f) => `${f.rule.slice("semantic:".length)} ${f.subject} ${f.derivation.tuple[2]}`).sort();

describe.each(VOCABULARIES.map((make) => [make().name, make] as const))("semantic.probe@1 on %s", (_name, make) => {
  const v = make();
  const asked = new Set(v.template.questions.map((q) => q.id));

  it("is a valid template with the catalogue and the pack", () => {
    expect(checkTemplateForm(v.template).valid).toBe(true);
    expect(SEMANTIC_RULES_V1.every((r) => asked.has(r))).toBe(true);
    expect(v.template.rules.map((r) => r.id)).toContain("semantic.probe");
  });

  it("emits candidates for exactly the subjects the probe settings select", () => {
    const got = emitted(v);
    expect(got).toEqual(oracle(v.graph, SETTING_OF[v.name], asked));
    expect(got.length).toBeGreaterThan(0);
  });

  it("emits a candidate for every control", () => {
    const singles = new Set(probeFindings(evaluate(v.template, v.graph)).map((f) => `${f.rule} ${f.subject}`));
    for (const c of v.expectations.controls) expect(singles.has(`semantic:text.vague ${c.subject}`), c.id).toBe(true);
  });

  it("judges every probe candidate with the fake provider: benign answers pass, pairs carry both subjects", async () => {
    const r = await evaluateAndJudge(v.template, v.graph, fakeSystemOne());
    const probes = probeFindings(r);
    expect(probes.every((f) => f.level === "pass" && f.judgment?.status === "confident")).toBe(true);
    const pairs = probes.filter((f) => f.rule === "semantic:pair.contradiction");
    expect(pairs.length).toBeGreaterThan(0);
    for (const f of pairs) {
      const [a, b] = subjectsOf(f.subject);
      expect(a < b).toBe(true);
      const q = v.template.questions.find((x) => x.id === "pair.contradiction")!;
      const s = buildSlice(v.graph, f.subject!, q.slice, { rule: "pair.contradiction", text: b });
      expect(s.subject).toMatchObject({ id: a, kind: expect.any(String) });
      expect(s.counterpart).toMatchObject({ id: b, kind: expect.any(String) });
    }
  });

  it("asks one provider call per semantic candidate; the live suite makes this many calls", () => {
    const calls = evaluate(v.template, v.graph).findings.filter((f) => f.rule.startsWith("semantic:") && asked.has(f.rule.slice("semantic:".length))).length;
    expect(calls).toBe(LIVE_CALLS[v.name]);
  });

  it("is deterministic", async () => {
    const run = async () => canon(await evaluateAndJudge(make().template, make().graph, fakeSystemOne()));
    expect(await run()).toBe(await run());
  });
});

describe("probe plumbing", () => {
  const graph = (): Graph => ({
    template: "template.meta.product-spec@1",
    nodes: [
      { id: "$spec", kind: "spec", fields: {} },
      { id: "name", kind: "name", parent: "$spec", fields: { title: "N" } },
      { id: "p", kind: "purpose", parent: "$spec", fields: { title: "P", description: "Works with no signal. #s1harm" } },
      { id: "r", kind: "rule", parent: "$spec", fields: { title: "R", description: "Needs a live connection." } },
      { id: "o", kind: "outcome", parent: "$spec", fields: { title: "O", description: "People are happier." } },
    ],
    links: [{ from: "p", rel: "motivates", to: "o" }], declarations: [], evidence: [],
  });

  it("a template enables rules through its questions", () => {
    const only = loadTemplate(withSemanticProbes(productSpec, { ...SETTINGS.product, rules: ["text.vague"] }));
    const rules = new Set(probeFindings(evaluate(only, graph())).map((f) => f.rule));
    expect([...rules]).toEqual(["semantic:text.vague"]);
    const none = loadTemplate({ ...productSpec, rules: [...productSpec.rules!, semanticProbe(SETTINGS.product as ProbeOptions)] });
    expect(probeFindings(evaluate(none, graph()))).toEqual([]);
  });

  it("policy maps a confident yes per rule: vague warning, contradiction error, unmeasurable pass", async () => {
    const t = loadTemplate(withSemanticProbes(productSpec, SETTINGS.product));
    const r = await evaluateAndJudge(t, graph(), fakeSystemOne());
    const level = (rule: string, subject: string) => r.findings.find((f) => f.rule === `semantic:${rule}` && f.subject === subject)?.level;
    expect(level("text.vague", "p")).toBe("warning");
    expect(level("pair.contradiction", "p|r")).toBe("error");
    expect(level("text.unmeasurable", "o")).toBe("pass");
    expect(level("text.vague", "r")).toBe("pass");
  });

  it("evaluate leaves a pair candidate on its first subject with the second in the text; judge joins them", async () => {
    const t = loadTemplate(withSemanticProbes(productSpec, SETTINGS.product));
    const before = evaluate(t, graph()).findings.find((f) => f.rule === "semantic:pair.contradiction")!;
    expect(before).toMatchObject({ subject: "p", message: "p and r may contradict each other." });
    expect(before.derivation.tuple).toEqual(["pair.contradiction", "p", "r"]);
    const after = (await evaluateAndJudge(t, graph(), fakeSystemOne())).findings.find((f) => f.rule === "semantic:pair.contradiction")!;
    expect(after.subject).toBe("p|r");
  });

  it("buildSlice resolves a pair subject, and a node id containing the separator stays one subject", () => {
    const g = graph();
    const spec = SliceSchema.parse({ fields: ["title"] });
    const s = buildSlice(g, "p|r", spec, { rule: "pair.contradiction", text: "r" });
    expect(s.subject).toEqual({ id: "p", kind: "purpose", parent: "$spec", fields: { title: "P" } });
    expect(s.counterpart).toEqual({ id: "r", kind: "rule", parent: "$spec", fields: { title: "R" } });
    expect(s.parents.map((n) => n.id)).toEqual(["$spec"]);
    expect(buildSlice(g, "p", spec, { rule: "x", text: "" })).not.toHaveProperty("counterpart");
    const odd: Graph = { ...g, nodes: [...g.nodes, { id: "a|b", kind: "rule", fields: {} }] };
    expect(pairOf("a|b", (id) => odd.nodes.some((n) => n.id === id))).toBeUndefined();
    expect(pairOf("x|y|z", (id) => ["x|y", "z"].includes(id))).toEqual(["x|y", "z"]);
    expect(buildSlice(g, "p|nope", spec, { rule: "pair.contradiction", text: "nope" }).counterpart).toEqual({ id: "nope", missing: true });
  });

  it("yes-no catalogue questions send their two choices as the wire criteria", () => {
    for (const q of loadTemplate({ id: "t", version: 1, meta: 1, questions: semanticCatalogue({ version: "1" }) }).questions) {
      const w = toWire(q);
      expect(w).toMatchObject({ type: "noul", criteria: { true: q.choices![0], false: q.choices![1] } });
    }
  });

  it("an empty option still parses and emits nothing for that rule", () => {
    expect(semanticProbe({ version: "1", probePairs: [], siblings: [] }).source).toContain('probePair("").');
    expect(PROBE_SOURCE).toContain("semanticCandidate");
    const t = loadTemplate(withSemanticProbes(productSpec, { ...SETTINGS.product, siblings: [] }));
    expect(checkTemplateForm(t).valid).toBe(true);
    expect(probeFindings(evaluate(t, graph())).filter((f) => f.rule === "semantic:pair.contradiction")).toEqual([]);
  });

  it("covers every probe rule", () => expect([...SEMANTIC_RULES_V1].sort()).toEqual([...PROBE_RULES].sort()));
});

/** Stage-1 candidates `semantic.probe@2` emits per fixture and rule with the v2 `SETTINGS`. */
const V2_COUNTS: Record<string, Record<string, number>> = {
  artyfact: {
    "node.kind": 57, "node.tangibility": 49, "text.unmeasurable": 27, "criterion.unfalsifiable": 22, "set.allHold": 10, "pair.relation": 34,
    "check:screen.signifiers": 8, "check:component.emptyState": 8, "check:component.loadingState": 8,
  },
  product: {
    "node.kind": 11, "node.tangibility": 10, "text.unmeasurable": 1, "criterion.unfalsifiable": 2, "node.purpose": 7, "sections.allHold": 1,
    "check:feature.userAndTrigger": 4, "check:screen.signifiers": 2,
  },
  world: { "node.kind": 5, "node.tangibility": 5, "text.unmeasurable": 2, "criterion.unfalsifiable": 1, "pair.relation": 1 },
};

const counts = (v: Vocabulary) => {
  const c: Record<string, number> = {};
  for (const f of evaluate(v.template, v.graph).findings) if (f.rule.startsWith("semantic:")) c[f.rule.slice(9)] = (c[f.rule.slice(9)] ?? 0) + 1;
  return c;
};

describe.each(V2_VOCABULARIES.map((make) => [make().name, make] as const))("semantic.probe@2 on %s", (name, make) => {
  const v = make();
  const candidates = (rule: string) => evaluate(v.template, v.graph).findings.filter((f) => f.rule === `semantic:${rule}`);
  const kindOf = new Map(v.graph.nodes.map((n) => [n.id, n.kind]));

  it("is a valid template with zero form findings and the v2 pack", () => {
    const form = checkTemplateForm(v.template);
    expect(form.valid).toBe(true);
    expect(form.findings.filter((f) => f.level !== "pass")).toEqual([]);
    expect(v.template.rules.find((r) => r.id === "semantic.probe")?.version).toBe("2");
  });

  it("emits only stage-1 candidates, in the pinned numbers", () => {
    const c = counts(v);
    // Stage-1 probe candidates, plus the template's own checklist (checks@1), which is not a follow-up either.
    expect(Object.keys(c).every((r) => (PROBE_RULES_V2 as readonly string[]).includes(r) || r.startsWith(CHECK_PREFIX))).toBe(true);
    expect(c).toEqual(V2_COUNTS[name]);
  });

  it("asks node questions only of glossary kinds, and tangibility only of tangible ones", () => {
    const kinds = SETTINGS_V2[name as keyof typeof SETTINGS_V2].kinds as Record<string, { tangible?: boolean }>;
    for (const f of candidates("node.kind")) expect(kinds[kindOf.get(f.subject!)!], f.subject).toBeDefined();
    for (const f of candidates("node.tangibility")) expect(kinds[kindOf.get(f.subject!)!]?.tangible, f.subject).not.toBe(false);
  });

  it("every planted problem has a stage-1 route: its own candidate, its entry's, or its set's or root's", () => {
    const emitted = new Set(evaluate(v.template, v.graph).findings.filter((f) => f.rule.startsWith("semantic:"))
      .map((f) => `${f.rule.slice(9)} ${f.rule.startsWith(`semantic:${PAIR_PREFIX}`) ? `${f.subject}|${f.derivation.tuple[2]}` : f.subject}`));
    const asked = new Set(v.template.questions.map((q) => q.id));
    const all = evaluate(v.template, v.graph).findings;
    for (const p of v.expectations.planted) {
      if (p.check?.deterministic) {
        expect(asked.has(p.rule), `${p.id}: a pattern check is not asked`).toBe(false);
        expect(all.some((f) => f.rule === p.rule && f.subject === subjectOf(p) && f.level === p.level), `${p.id}: ${p.rule} ${subjectOf(p)}`).toBe(true);
        continue;
      }
      expect(asked.has(p.rule), `${p.id}: ${p.rule} is in the catalogue`).toBe(true);
      const route = p.entry ? `${p.entry.rule} ${p.entry.subject}`
        : p.rule === "term.usage" ? `sections.allHold ${p.subjects[0]}`
        : `${p.rule} ${subjectOf(p)}`;
      expect(emitted.has(route), `${p.id}: ${route}`).toBe(true);
    }
  });

  it("orders pair subjects with the smaller id first and the other in the text", () => {
    for (const f of candidates("pair.relation")) expect(f.subject! < String(f.derivation.tuple[2])).toBe(true);
  });

  it("v1 is unchanged with version 1", () => {
    const v1 = counts(VOCABULARIES[V2_VOCABULARIES.indexOf(make)]!());
    expect(Object.keys(v1).filter((r) => !r.startsWith(CHECK_PREFIX)).sort()).toEqual([...PROBE_RULES].filter((r) => v1[r]).sort());
  });
});

describe("semantic.probe@2 plumbing", () => {
  const graph = (): Graph => ({
    template: "template.meta.product-spec@1",
    nodes: [
      { id: "$spec", kind: "spec", fields: {} },
      { id: "p", kind: "purpose", parent: "$spec", fields: { title: "P", description: "Help people keep in touch." } },
      { id: "f", kind: "feature", parent: "$spec", fields: { title: "F", description: "Reminders." } },
      { id: "s", kind: "summary", parent: "$spec", fields: { title: "S", description: "An app." } },
      { id: "f1", kind: "rule", parent: "f", fields: { title: "R1", description: "Remind weekly." } },
      { id: "f2", kind: "rule", parent: "f", fields: { title: "R2", description: "Never remind." } },
      { id: "f3", kind: "rule", parent: "f", fields: { title: "R3" } },
    ],
    links: [], declarations: [], evidence: [],
  });
  const emittedBy = (o: SemanticProbeOptions) =>
    evaluate(loadTemplate(withSemanticProbes(productSpec, o)), graph()).findings
      .filter((f) => f.rule.startsWith("semantic:")).map((f) => `${f.rule.slice(9)} ${f.subject}`).sort();

  it("a set needs at least two texted children; the sections root is not also a set", () => {
    const got = emittedBy({ sets: ["*"], sections: true });
    expect(got).toContain("set.allHold f");
    expect(got).toContain("sections.allHold $spec");
    expect(got).not.toContain("set.allHold $spec");
    expect(emittedBy({ sets: ["*"] })).toEqual(expect.arrayContaining(["set.allHold $spec", "set.allHold f"]));
    expect(emittedBy({ sets: ["purpose"] }).filter((x) => x.startsWith("set."))).toEqual([]);
    const thin: Graph = { ...graph(), nodes: graph().nodes.filter((n) => n.id !== "f2") };
    const t = loadTemplate(withSemanticProbes(productSpec, { sets: ["feature"] }));
    expect(evaluate(t, thin).findings.filter((f) => f.rule === "semantic:set.allHold")).toEqual([]);
  });

  it("glossary kinds get node.kind; tangible false skips node.tangibility; purposeKinds get node.purpose", () => {
    const got = emittedBy({ kinds: { purpose: { noun: "purpose" }, summary: { noun: "summary", tangible: false } }, purposeKinds: ["feature"] });
    expect(got.filter((x) => x.startsWith("node."))).toEqual(["node.kind p", "node.kind s", "node.purpose f", "node.tangibility p"]);
  });

  it("node.purpose is left out without purposeKinds, and its slice anchors the purpose", () => {
    expect(loadTemplate(withSemanticProbes(productSpec, {})).questions.some((q) => q.id === "node.purpose")).toBe(false);
    const t = loadTemplate(withSemanticProbes(productSpec, { purposeKinds: ["rule"] }));
    const q = t.questions.find((x) => x.id === "node.purpose")!;
    expect(q.slice.anchors).toEqual(["purpose"]);
    const s = buildSlice(graph(), "f1", q.slice, { rule: "node.purpose", text: "Remind weekly." });
    expect(s.nodes.map((n) => n.id)).toEqual(["p"]);
  });

  it("the v2 pack declares every option fact even when empty", () => {
    const src = semanticProbe({}).source;
    for (const rel of ["probeKind", "probeTangible", "probePurpose", "probeSetKind", "probeSections", "probePair"]) expect(src).toContain(`${rel}("").`);
    expect(semanticProbe({ sections: true }).source).toContain('probeSections("on").');
    expect(PROBE_SOURCE_V2).toContain("count");
    expect(semanticProbe({ version: "1" }).version).toBe("1");
  });
});
