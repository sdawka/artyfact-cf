import { describe, expect, it } from "vitest";
import {
  evalRoute, fakeSystemOne, fakeTranslator, opMatches, oracleSystemOne, scoreRoute, scoreTranslation, scriptedSystemOne, tokenOverlap,
  type Route, type RouteGold,
} from "../../src/index.ts";
import { assistant, GOLD_SPACE_MISMATCHES, tidepool } from "./setup.ts";

const settings = [tidepool(), assistant()];

describe("oracle mode: the chain reaches every gold target", () => {
  for (const order of ["shortlist-first", "intent-first", "intent-last"] as const) {
    for (const s of settings) {
      it(`${s.name}, ${order}: routes every case; question cases score their intent only`, async () => {
        const report = await evalRoute(s.cases, { graph: s.graph, template: s.template, s1: (c) => oracleSystemOne(c.gold), options: { ...s.options, order } });
        expect(report.order).toBe(order);
        const missed = report.cases.filter((c) => !c.routed).map((c) => c.id);
        expect(missed).toEqual(GOLD_SPACE_MISMATCHES[s.name]);
        for (const c of report.cases) {
          expect(c.calls).toBeLessThanOrEqual(8);
          const gold = s.cases.cases.find((x) => x.id === c.id)!.gold;
          expect(c.route.intent, c.id).toBe(gold.intent);
          if (gold.intent === "question") {
            expect(c.levels.space.hit).toBeNull();
            if (order === "intent-first") expect(c.route.path.map((p) => p.level), c.id).toEqual(["intent"]);
            continue;
          }
          // A root-level add (null gold space) answers `none` at the space level, so no kind: left for review.
          expect(c.status, c.id).toBe(gold.space === null ? "review" : "confident");
          // Picks are gold; secondary gold nodes of another kind or space are out of the follow-ups' reach.
          expect(c.route.target.nodes.every((n) => gold.nodes.includes(n)), c.id).toBe(true);
          expect(c.route.target.nodes.length > 0, c.id).toBe(gold.nodes.length > 0);
        }
        expect(report.totals.routed.rate).toBe(1);
      });
    }
  }

  it("w04: a null gold space with an add scores as hit when the route chose no space or the root", async () => {
    const s = settings[1]!;
    const c = s.cases.cases.find((x) => x.id === "w04")!;
    expect(c.gold).toMatchObject({ intent: "add", space: null });
    const stop = await evalRoute({ ...s.cases, cases: [c] }, { graph: s.graph, template: s.template, s1: (x) => oracleSystemOne(x.gold), options: s.options });
    expect(stop.cases[0]!.levels).toMatchObject({ space: { hit: true }, kind: { hit: null }, nodes: { hit: true } });
    expect(stop.cases[0]!.routed).toBe(true);
    const viaRoot = await evalRoute({ ...s.cases, cases: [c] }, {
      graph: s.graph, template: s.template, options: s.options,
      s1: () => scriptedSystemOne({ "route.shortlist": "none", "route.space": "assistant-world", "route.kind": "goal", "route.node": "new", "route.intent": "add", "route.anchor": "none" }),
    });
    expect(viaRoot.cases[0]!.levels).toMatchObject({ space: { got: "assistant-world", hit: true }, kind: { hit: true }, nodes: { hit: true } });
    expect(viaRoot.cases[0]!.routed).toBe(true);
  });
});

describe("fake-benign smoke", () => {
  for (const s of settings) {
    it(`${s.name}: every case routes within budget and the report adds up, with the fake translator scored`, async () => {
      const report = await evalRoute(s.cases, { graph: s.graph, template: s.template, s1: fakeSystemOne(), translator: fakeTranslator(), options: s.options, concurrency: 4 });
      expect(report).toMatchObject({ model: "fake", translateModel: "fake", fixture: s.cases.fixture });
      expect(report.cases.map((c) => c.id)).toEqual(s.cases.cases.map((c) => c.id));
      expect(report.cases.every((c) => c.calls >= 1 && c.calls <= 8 && c.translation)).toBe(true);
      const t = report.totals;
      expect(t.cases).toBe(s.cases.cases.length);
      expect(t.status.confident + t.status.review + t.status.unknown).toBe(t.cases);
      expect(t.byLevel.intent.total).toBe(t.cases);
      expect(Object.values(t.byDifficulty).reduce((n, r) => n + r.total, 0)).toBe(t.cases);
      expect(t.meanCalls).toBeGreaterThan(0);
      expect(t.translation).toBeDefined();
      expect(JSON.parse(JSON.stringify(report))).toBeTruthy();
    });
  }
});

const routeOf = (p: Partial<Route> & { nodes?: string[]; space?: string; kind?: string }): Route => ({
  message: "m", order: "intent-last", root: "root", path: [], status: "confident", calls: 4,
  provenance: { provider: "x", model: "x", usage: { input_tokens: 0, output_tokens: 0 }, thresholds: { confident: 0.9, review: 0.5 } },
  ...p,
  target: { nodes: p.nodes ?? [], related: [], ...(p.space && { space: p.space }), ...(p.kind && { kind: p.kind }) },
});
const gold = (g: Partial<RouteGold>): RouteGold => ({ intent: "update", space: "solution", kind: "rule", nodes: ["a", "b"], ...g });

describe("scoreRoute", () => {
  it("scores each level and routes when all hit; one shared node is enough", () => {
    const s = scoreRoute(gold({}), routeOf({ intent: "update", space: "solution", kind: "rule", nodes: ["b", "z"] }));
    expect(Object.fromEntries(Object.entries(s.levels).map(([k, v]) => [k, v.hit]))).toEqual({ intent: true, space: true, kind: true, nodes: true });
    expect(s.routed).toBe(true);
    expect(scoreRoute(gold({}), routeOf({ intent: "update", space: "solution", kind: "test", nodes: ["a"] })).routed).toBe(false);
  });
  it("an add with empty gold nodes hits when the route picked none", () => {
    const g = gold({ intent: "add", nodes: [] });
    expect(scoreRoute(g, routeOf({ intent: "add", space: "solution", kind: "rule" })).levels.nodes.hit).toBe(true);
    expect(scoreRoute(g, routeOf({ intent: "add", space: "solution", kind: "rule", nodes: ["x"] })).levels.nodes.hit).toBe(false);
  });
  it("a question case scores only its intent; null gold levels match an unchosen level", () => {
    const q = scoreRoute(gold({ intent: "question", space: "solution", kind: null }), routeOf({ intent: "question" }));
    expect(q.routed).toBe(true);
    expect(q.levels.space.hit).toBeNull();
    expect(scoreRoute(gold({ intent: "question" }), routeOf({ intent: "update", space: "solution", kind: "rule", nodes: ["a"] })).routed).toBe(false);
    expect(scoreRoute(gold({ space: null, kind: null }), routeOf({ intent: "update", nodes: ["a"] })).levels.space.hit).toBe(true);
  });
});

describe("translation scoring", () => {
  it("tokenOverlap is the share of gold words the produced text has, plurals folded", () => {
    expect(tokenOverlap("Photos per survey", "photo count per surveys")).toBe(1);
    expect(tokenOverlap("Acceptance rate: 71% in August", "August acceptance was 71%")).toBeGreaterThanOrEqual(0.5);
    expect(tokenOverlap("School group with a teacher", "Retired volunteers")).toBe(0);
  });
  it("opMatches compares op and primary key, and text loosely", () => {
    expect(opMatches({ op: "update", id: "a", fields: { title: "Species chooser" } }, { op: "update", id: "a", fields: { title: "The species chooser" } })).toBe(true);
    expect(opMatches({ op: "update", id: "a", fields: { title: "Species chooser" } }, { op: "update", id: "b", fields: { title: "Species chooser" } })).toBe(false);
    expect(opMatches({ op: "update", id: "a", fields: { title: "Species chooser" } }, { op: "update", id: "a", fields: { description: "Unrelated" } })).toBe(false);
    expect(opMatches({ op: "add", kind: "metric", title: "Photos per survey" }, { op: "add", kind: "metric", title: "Number of photos per survey" })).toBe(true);
    expect(opMatches({ op: "add", kind: "metric", title: "Photos per survey" }, { op: "add", kind: "goal", title: "Photos per survey" })).toBe(false);
    expect(opMatches({ op: "link", from: "a", rel: "uses", to: "b" }, { op: "link", from: "a", rel: "references", to: "b" })).toBe(true);
    expect(opMatches({ op: "link", from: "a", rel: "uses", to: "b" }, { op: "unlink", from: "a", rel: "uses", to: "b" })).toBe(false);
    expect(opMatches({ op: "remove", id: "a" }, { op: "remove", id: "a" })).toBe(true);
  });
  it("scoreTranslation matches one-to-one and reports precision, recall, question, answer and problems", () => {
    const s = tidepool();
    const g: RouteGold = { intent: "link", space: "solution", kind: "screen", nodes: [], ops: [
      { op: "unlink", from: "module-field-capture-app", rel: "exposes", to: "screen-site-map" },
      { op: "link", from: "module-verification-service", rel: "exposes", to: "screen-site-map" },
    ] };
    const out = scoreTranslation(g, { model: "m", provider: "p", ops: [
      { op: "link", from: "module-verification-service", rel: "exposes", to: "screen-site-map" },
      { op: "link", from: "module-verification-service", rel: "exposes", to: "screen-site-map" },
      { op: "remove", id: "nope" },
    ] }, s.template, s.graph);
    expect(out).toMatchObject({ goldOps: 2, producedOps: 3, matched: 1, recall: 0.5, question: null, answer: null });
    expect(out.precision).toBeCloseTo(1 / 3);
    expect(out.problems.map((p) => p.rule)).toEqual(["op.unknownNode"]);
    expect(scoreTranslation({ ...g, intent: "question", ops: undefined, question: "Which?" }, { model: "m", provider: "p", question: "Which part?" }, s.template, s.graph))
      .toMatchObject({ question: true, precision: null, recall: null });
    expect(scoreTranslation({ ...g, intent: "answer", ops: [] }, { model: "m", provider: "p" }, s.template, s.graph).answer).toBe(false);
  });
});
