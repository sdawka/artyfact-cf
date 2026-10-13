/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkTemplateForm, diff, diffFindings, EDB_RELATIONS, evaluate, evaluateAndJudge, fakeSystemOne, loadTemplate, S1Error, type Finding,
  type Readiness, type SystemOne,
} from "../src/index.ts";
import {
  bropilotSpaces, PRODUCT_EDGE_TYPES, PRODUCT_KINDS, productGraphToGraph, productSpec, spacesGraphToGraph, SPEC_ROOT,
  type ProductGraphJson,
} from "../src/adapters/product/index.ts";
import { edbLeaves } from "./fixture.ts";

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/product/${name}`, import.meta.url), "utf8"));
const product = loadTemplate(productSpec);
const spaces = loadTemplate(bropilotSpaces);

/** Findings per `level rule`: the regression oracle for a real graph. */
const counts = (r: Readiness) => {
  const c: Record<string, number> = {};
  for (const f of r.findings) c[`${f.level} ${f.rule}`] = (c[`${f.level} ${f.rule}`] ?? 0) + 1;
  return c;
};
const pairs = (fs: Finding[]) => fs.map((f) => `${f.level} ${f.rule} ${f.subject ?? ""}`).sort();

type N = ProductGraphJson["nodes"][number];
type E = NonNullable<ProductGraphJson["edges"]>[number];
const n = (id: string, kind: string, extra: Partial<N> = {}): N => ({ id, kind, title: id, status: "committed", ...extra });
const e = (src: string, type: string, dst: string): E => ({ id: `${src}-${type}-${dst}`, src, type, dst });
const spec = (nodes: N[], edges: E[] = []) => productGraphToGraph({ nodes, edges });

/** name, purpose, outcome and the motivating link: the smallest actionable spec. */
const core = (outcome: Partial<N> = {}) => ({
  nodes: [n("name", "name"), n("purpose", "purpose"), n("outcome", "outcome", outcome)],
  edges: [e("purpose", "motivates", "outcome")],
});

describe("product-spec template", () => {
  it("both templates are form-valid", () => {
    for (const t of [product, spaces]) expect(checkTemplateForm(t)).toMatchObject({ valid: true, findings: [] });
    expect(product.ref).toBe("template.meta.product-spec@1");
    expect(spaces.ref).toBe("template.meta.bropilot-spaces@3");
  });

  it("carries the uip ontology's kinds and edge endpoints verbatim", () => {
    const o = fx("ontology.json") as { KINDS: { id: string }[]; EDGE_TYPES: { id: string; from: string[]; to: string[] }[] };
    expect([...PRODUCT_KINDS].sort()).toEqual(o.KINDS.map((k) => k.id).sort());
    expect(Object.fromEntries(Object.entries(PRODUCT_EDGE_TYPES).map(([id, x]) => [id, [x.from, x.to]])))
      .toEqual(Object.fromEntries(o.EDGE_TYPES.map((x) => [x.id, [x.from, x.to]])));
  });
});

describe("real product graphs", () => {
  const BROPILOT = {
    "missing need.hypothesisMetric": 8, "missing need.moduleInterface": 7, "missing need.protocolPractice": 2,
    "missing relation.minIn": 4, "missing relation.required": 5,
    "warning feature.stagesWithoutFlow": 10, "warning result.untargeted": 3,
    // The product template's screen checklist: every described screen is asked whether it states its signifiers.
    "info semantic:check:screen.signifiers": 9,
  };
  const cases: [string, Record<string, number>, { required: number; satisfied: number }][] = [
    ["bropilot.graph.json", BROPILOT, { required: 299, satisfied: 273 }],
    ["lfp.graph.json", BROPILOT, { required: 299, satisfied: 273 }],
    ["tidepool.graph.json", { "missing audience.unreached": 2, "missing need.moduleInterface": 2, "missing relation.minIn": 1 }, { required: 101, satisfied: 96 }],
    ["ledgerly.graph.json", { "missing need.moduleInterface": 1, "missing relation.minIn": 1 }, { required: 104, satisfied: 102 }],
  ];
  it.each(cases)("%s loads, evaluates and matches its finding counts", (file, expected, completeness) => {
    const r = evaluate(product, productGraphToGraph(fx(file)));
    expect(counts(r)).toEqual(expected);
    expect(r.completeness).toMatchObject(completeness);
    expect(r).toMatchObject({ actionable: false, buildable: false, incomplete: false, consistency: { violations: 0 } });
  });

  it("the lfp seed graph is the uip bropilot project", () => {
    expect(fx("lfp.graph.json")).toEqual(fx("bropilot.graph.json"));
  });

  it("puts every node under the spec root and flattens source and props", () => {
    const g = productGraphToGraph(fx("bropilot.graph.json"));
    expect(g.nodes[0]).toMatchObject({ id: SPEC_ROOT, kind: "spec" });
    expect(g.nodes.slice(1).every((x) => x.parent === SPEC_ROOT)).toBe(true);
    const outcome = g.nodes.find((x) => x.kind === "outcome" && x.fields["props.metric"] !== undefined)!;
    expect(outcome.fields).toMatchObject({ "source.kind": expect.any(String), status: "committed" });
    expect(g.links).toHaveLength(448);
  });
});

describe("progressive filling", () => {
  it("shrinks the missing set step by step and flips actionable when the purpose motivates an outcome", () => {
    const steps: [N[], E[]][] = [
      [[n("name", "name")], []],
      [[n("name", "name"), n("purpose", "purpose")], []],
      [[n("name", "name"), n("purpose", "purpose"), n("outcome", "outcome")], []],
      [core().nodes, core().edges],
      [[...core().nodes, n("metric", "metric")], [...core().edges, e("metric", "monitors", "outcome")]],
    ];
    const rs = steps.map(([nodes, edges]) => evaluate(product, spec(nodes, edges)));
    const missing = rs.map((r) => pairs(r.findings.filter((f) => f.level === "missing")));

    expect(missing[0]).toEqual([`missing children.required ${SPEC_ROOT}`]);
    expect(rs[0].findings.find((f) => f.rule === "children.required")!.facts).toContainEqual(["requiredChild", "spec", "purpose", 1, 1]);
    expect(missing[1]).toEqual(["missing relation.required purpose"]);
    expect(missing[2]).toEqual(["missing relation.required purpose"]);
    expect(pairs(rs[2].findings.filter((f) => f.rule.startsWith("semantic:")))).toEqual(["info semantic:outcome.measurable outcome"]);
    expect(missing[3]).toEqual([]);
    expect(rs.map((r) => r.completeness.missing.length)).toEqual([1, 1, 1, 0, 0]);
    expect(rs.map((r) => [r.completeness.required - r.completeness.satisfied])).toEqual([[1], [1], [1], [0], [0]]);
    expect(rs.map((r) => r.actionable)).toEqual([false, false, false, true, true]);
    // With no metric the outcome's measurability is an open question; a monitoring metric decides it structurally.
    expect(rs.map((r) => r.buildable)).toEqual([false, false, false, false, true]);
  });
});

describe("provisional nodes", () => {
  const graph = (opts = {}) => productGraphToGraph({
    nodes: [n("name", "name"), n("purpose", "purpose", { status: "proposed" }), n("outcome", "outcome"), n("metric", "metric")],
    edges: [e("purpose", "motivates", "outcome"), e("metric", "monitors", "outcome")],
  }, opts);

  it("a spec whose only purpose is proposed is actionable but not buildable", () => {
    const r = evaluate(product, graph());
    expect(pairs(r.findings)).toEqual(["warning node.proposed purpose"]);
    expect(r).toMatchObject({ actionable: true, buildable: false });
  });

  it("the engine's provisional flag is the stricter reading: missing, so not actionable", () => {
    const r = evaluate(product, graph({ provisionalFlag: true }));
    expect(pairs(r.findings)).toEqual(["missing node.provisional purpose", "warning node.proposed purpose"]);
    expect(r).toMatchObject({ actionable: false, buildable: false });
  });
});

describe("contradictions", () => {
  const withMetric = () => { const c = core(); return { nodes: [...c.nodes, n("metric", "metric")], edges: [...c.edges, e("metric", "monitors", "outcome")] }; };

  it("two names exceed the spec's exactly-one name", () => {
    const c = withMetric();
    const r = evaluate(product, spec([...c.nodes, n("name2", "name")], c.edges));
    expect(pairs(r.findings)).toEqual([`error children.max ${SPEC_ROOT}`]);
    expect(r.consistency.violations).toBe(1);
  });

  it("an edge type not allowed between those kinds is an endpoint violation", () => {
    const c = withMetric();
    const r = evaluate(product, spec([...c.nodes, n("aud", "audience"), n("feat", "feature")], [...c.edges, e("purpose", "serves", "aud"), e("feat", "serves", "aud")]));
    expect(pairs(r.findings)).toEqual(["error link.endpoint purpose"]);
  });

  it("a dangling edge is ref.dangling", () => {
    const c = withMetric();
    const r = evaluate(product, spec(c.nodes, [...c.edges, e("purpose", "motivates", "ghost")]));
    expect(pairs(r.findings)).toEqual(["error ref.dangling purpose"]);
  });
});

describe("judgment: is the outcome measurable?", () => {
  const recording = (): SystemOne & { states: unknown[] } => {
    const inner = fakeSystemOne();
    const states: unknown[] = [];
    return { ...inner, states, ask: (state, qs, o) => { states.push({ state, qs }); return inner.ask(state, qs, o); } };
  };
  const semantic = (r: Readiness) => r.findings.filter((f) => f.rule === "semantic:outcome.measurable");

  it("an outcome with no indicator reaches the provider with its purpose in the slice; benign gives pass", async () => {
    const s1 = recording();
    const c = core();
    const r = await evaluateAndJudge(product, spec(c.nodes, c.edges), s1);
    expect(s1.states).toHaveLength(1);
    const { state, qs } = s1.states[0] as { state: { subject: { id: string }; nodes: { id: string }[] }; qs: Record<string, { type: string; instructions: string }> };
    expect(state.subject.id).toBe("outcome");
    expect(state.nodes.map((x) => x.id)).toEqual(["purpose"]);
    expect(qs["outcome.measurable"]).toMatchObject({ type: "noul", instructions: "Is this outcome stated so that it can be measured?" });
    expect(semantic(r)).toMatchObject([{ level: "pass", subject: "outcome", judgment: { status: "confident", answer: "yes" } }]);
    expect(r).toMatchObject({ actionable: true, buildable: true, judgments: { confident: 1, review: 0, unknown: 0 } });
  });

  it("#s1no gives a warning and the spec stops being buildable", async () => {
    const c = core({ description: "Things feel better #s1no" });
    const r = await evaluateAndJudge(product, spec(c.nodes, c.edges), fakeSystemOne());
    expect(semantic(r)).toMatchObject([{ level: "warning", judgment: { status: "confident", answer: "no" } }]);
    expect(r).toMatchObject({ actionable: true, buildable: false });
  });

  it("a throwing provider gives unknown", async () => {
    const broken: SystemOne = { mode: "http", model: "down", ask: async () => { throw new S1Error("System One HTTP 500", "http", 500); } };
    const c = core();
    const r = await evaluateAndJudge(product, spec(c.nodes, c.edges), broken);
    expect(semantic(r)).toMatchObject([{ level: "info", judgment: { status: "unknown" }, provenance: { provider: "error", error: { code: "http", status: 500 } } }]);
    expect(r).toMatchObject({ actionable: true, buildable: false, judgments: { confident: 0, review: 0, unknown: 1 } });
  });

  it("an outcome a metric monitors is never asked about", async () => {
    const s1 = recording();
    await evaluateAndJudge(product, productGraphToGraph(fx("tidepool.graph.json")), s1);
    expect(s1.states).toHaveLength(0);
  });
});

describe("diff on tidepool", () => {
  const OUTCOME = "outcome-volunteers-come-back-for-the-next-good";
  const AUDIENCE = "audience-weekend-shore-volunteer";
  const before = fx("tidepool.graph.json") as Required<ProductGraphJson>;
  const after = structuredClone(before);
  after.nodes.find((x) => x.id === OUTCOME)!.title = "Volunteers come back within a month";
  after.nodes.push(n("hypothesis-streaks", "hypothesis", { title: "Streak reminders bring volunteers back" }));
  after.edges = after.edges.filter((x) => x.id !== "e11");
  after.edges.push(e("capability-volunteer-engagement", "serves", AUDIENCE));
  const a = productGraphToGraph(before), b = productGraphToGraph(after);

  it("reports exactly the changed nodes and links", () => {
    expect(diff(a, b)).toEqual({
      nodes: { added: ["hypothesis-streaks"], removed: [], changed: [{ id: OUTCOME, fields: ["fields.title"] }] },
      links: {
        added: [{ from: "capability-volunteer-engagement", rel: "serves", to: AUDIENCE }],
        removed: [{ from: "metric-volunteers-returning-within-30-days", rel: "monitors", to: OUTCOME }],
        changed: [],
      },
    });
  });

  it("diffFindings shows what appeared and resolved", () => {
    const d = diffFindings(evaluate(product, a), evaluate(product, b));
    expect(pairs(d.appeared)).toEqual(["info semantic:outcome.measurable " + OUTCOME, "missing need.hypothesisMetric hypothesis-streaks"]);
    expect(pairs(d.resolved)).toEqual(["missing audience.unreached " + AUDIENCE]);
  });
});

describe("spaces template", () => {
  it("the spafax graph loads, is form-valid and matches its finding counts", () => {
    const g = spacesGraphToGraph(fx("spafax.spaces.json"));
    expect(g.nodes).toHaveLength(91);
    expect(g.links).toHaveLength(87);
    const r = evaluate(spaces, g);
    expect(counts(r)).toEqual({ "warning alignment.broken": 2, "info alignment.roadmap": 4 });
    expect(r.completeness).toMatchObject({ required: 93, satisfied: 93, missing: [] });
    expect(r).toMatchObject({ actionable: true, buildable: false, consistency: { violations: 6 } });
  });
});

describe("derivations and determinism", () => {
  const runs: [string, () => Readiness][] = [
    ...["bropilot", "tidepool", "ledgerly"].map((p): [string, () => Readiness] => [p, () => evaluate(product, productGraphToGraph(fx(`${p}.graph.json`)))]),
    ["spafax", () => evaluate(spaces, spacesGraphToGraph(fx("spafax.spaces.json")))],
    ["progressive", () => evaluate(product, spec(core().nodes))],
  ];
  it.each(runs)("%s: every finding derives from EDB facts, and two runs are byte-identical", (_, run) => {
    const r = run();
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) {
      expect(edbLeaves(f.derivation)).toBe(true);
      expect(f.facts.length).toBeGreaterThan(0);
      for (const [rel] of f.facts) expect(EDB_RELATIONS).toContain(rel);
    }
    expect(JSON.stringify(run())).toBe(JSON.stringify(r));
  });
});
