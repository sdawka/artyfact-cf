import { describe, expect, it } from "vitest";
import {
  fakeSystemOne, offSystemOne, rankNodes, route, routeSlice, routeView, routeVocabulary, scriptedSystemOne, ROUTE_DEFAULTS,
  type S1Question,
} from "../../src/index.ts";
import { PRODUCT_KINDS, PRODUCT_SPACES } from "../../src/adapters/product/index.ts";
import { assistant, tidepool } from "./setup.ts";

const tp = tidepool();
const ws = assistant();
const keys = (q: S1Question) => (q.type === "choice" ? Object.keys(q.criteria) : []);

describe("PRODUCT_SPACES", () => {
  it("places every product kind in exactly one space", () => {
    const all = Object.values(PRODUCT_SPACES).flat();
    expect([...all].sort()).toEqual([...PRODUCT_KINDS].sort());
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("routeView", () => {
  it("product: spaces from the kind map under the spec root, no `other` space", () => {
    const v = routeView(tp.graph, tp.options);
    expect(v.root).toBe("$spec");
    expect(v.spaces.map((s) => s.key)).toEqual(Object.keys(PRODUCT_SPACES));
    expect(v.spaces.find((s) => s.key === "planned")!.nodes).toContain("task-resume-interrupted-photo-uploads");
  });
  it("world: the root's sections in order, then the root itself; ws.* bookkeeping is not routable", () => {
    const v = routeView(ws.graph);
    expect(v.root).toBe("assistant-world");
    expect(v.spaces.map((s) => s.key)).toEqual([
      "assistant-environment", "user", "outcome-1", "node-thing-interface", "node-thing-planning", "node-thing-calendar",
      "node-thing-progress", "goal-french", "assistant-world",
    ]);
    expect(v.spaces.find((s) => s.key === "node-thing-calendar")!.nodes).toEqual(["node-thing-calendar", "calendar-1", "criterion-1", "assay-1"]);
    expect(v.nodes.some((id) => id.startsWith("ws:"))).toBe(false);
  });
});

const IF = { ...tp.options, order: "intent-first" as const };
const IL = { ...tp.options, order: "intent-last" as const };

describe("route chain, intent-first", () => {
  it("walks intent, space, kind and node, each question offering only its level's options", async () => {
    const seen: Record<string, string[]> = {};
    const s1 = scriptedSystemOne({
      "route.intent": "update", "route.space": "solution", "route.kind": "screen",
      "route.node": (_s, q) => { seen.node = keys(q); return "screen-species-picker"; },
      "route.more": "no",
    });
    const r = await route(tp.graph, tp.template, "Rename the species picker to 'Species chooser'.", s1, IF);
    expect(r).toMatchObject({ order: "intent-first", root: "$spec", intent: "update", status: "confident", target: { space: "solution", kind: "screen", nodes: ["screen-species-picker"], related: [] }, calls: 5 });
    expect(r.path.map((s) => s.level)).toEqual(["intent", "space", "kind", "node", "more"]);
    expect(r.path[1]!.choices).toEqual([...Object.keys(PRODUCT_SPACES), "none"]);
    expect(seen.node![0]).toBe("screen-species-picker");
    expect(seen.node!.slice(-2)).toEqual(["none", "new"]);
    expect(seen.node!.every((k) => k === "none" || k === "new" || k.startsWith("screen-"))).toBe(true);
    expect(r.path[0]).toMatchObject({ id: "route.intent", answer: "update", confidence: 0.95, status: "confident" });
  });

  it("an add asks for an anchor among every kind in the space, with `none` and without `new`", async () => {
    let offered: string[] = [];
    const s1 = scriptedSystemOne({
      "route.intent": "add", "route.space": "solution", "route.kind": "test",
      "route.node": (_s, q) => { offered = keys(q); return "rule-surveys-start-no-earlier-than-90-minutes"; }, "route.more": "no",
    });
    const r = await route(tp.graph, tp.template, "Add a test that a survey started two hours before low tide is rejected.", s1, IF);
    expect(r.target).toMatchObject({ kind: "test", nodes: ["rule-surveys-start-no-earlier-than-90-minutes"] });
    expect(offered).toHaveLength(ROUTE_DEFAULTS.maxChoices + 1);
    expect(offered.at(-1)).toBe("none");
    expect(new Set(offered.slice(0, -1).map((id) => id.split("-")[0])).size).toBeGreaterThan(1);
  });

  it("an add may choose a declared kind with no nodes yet; `none` leaves it unanchored and confident", async () => {
    let kinds: string[] = [];
    const s1 = scriptedSystemOne({ "route.intent": "add", "route.space": "solution", "route.kind": (_s, q) => { kinds = keys(q); return "design-system"; }, "route.node": "none" });
    const r = await route(tp.graph, tp.template, "Add a design system.", s1, IF);
    expect(kinds).toContain("design-system");
    expect(r).toMatchObject({ status: "confident", target: { kind: "design-system", nodes: [] } });
    expect(r.target.related.length).toBeGreaterThan(0);
  });

  it("stops at a `question` intent, confidently, and at an `unclear` intent as unknown", async () => {
    expect(await route(tp.graph, tp.template, "Can we make it faster?", scriptedSystemOne({ "route.intent": "question" }), IF))
      .toMatchObject({ intent: "question", status: "confident", calls: 1, target: { nodes: [] } });
    expect(await route(tp.graph, tp.template, "hmm", scriptedSystemOne({ "route.intent": "unclear" }), IF)).toMatchObject({ intent: "unclear", status: "unknown", calls: 1 });
  });
});

describe("route chain, intent-last", () => {
  it("navigates first, then asks the intent with the picked items' titles and descriptions in view", async () => {
    const states: Record<string, any> = {};
    let criteria: Record<string, string> = {};
    const s1 = scriptedSystemOne({
      "route.space": "solution", "route.kind": "term", "route.node": "term-percent-cover", "route.more": "no",
      "route.intent": (state, q) => { states.intent = state; criteria = (q as { criteria: Record<string, string> }).criteria; return "update"; },
    });
    const r = await route(tp.graph, tp.template, "Percent cover should be estimated in 10% steps, 5% is too fine for volunteers.", s1, IL);
    expect(r).toMatchObject({ order: "intent-last", intent: "update", status: "confident", calls: 5, target: { space: "solution", kind: "term", nodes: ["term-percent-cover"] } });
    expect(r.path.map((s) => s.level)).toEqual(["space", "kind", "node", "more", "intent"]);
    expect(states.intent.so_far.picked).toEqual([expect.objectContaining({ kind: "term", title: expect.stringMatching(/percent cover/i), description: expect.stringMatching(/quadrat/) })]);
    expect(criteria.update).toMatch(/picked existing item/);
    expect(criteria.add).toMatch(/does not exist yet/);
    expect(Object.keys(criteria)).toEqual(["add", "update", "remove", "link", "question", "answer", "unclear"]);
  });

  it("an add whose node level answers `new` asks for the anchor anywhere in the space", async () => {
    let anchors: string[] = [];
    const s1 = scriptedSystemOne({
      "route.space": "solution", "route.kind": "test", "route.node": "new", "route.intent": "add",
      "route.anchor": (_s, q) => { anchors = keys(q); return "rule-surveys-start-no-earlier-than-90-minutes"; },
    });
    const r = await route(tp.graph, tp.template, "Add a test that a survey started two hours before low tide is rejected.", s1, IL);
    expect(r).toMatchObject({ intent: "add", status: "confident", target: { kind: "test", new: true, nodes: ["rule-surveys-start-no-earlier-than-90-minutes"] } });
    expect(r.path.map((s) => s.level)).toEqual(["space", "kind", "node", "intent", "anchor"]);
    expect(anchors).toContain("rule-surveys-start-no-earlier-than-90-minutes");
    expect(anchors.at(-1)).toBe("none");
  });

  it("a declared kind with no nodes skips the node question and marks the target new", async () => {
    const s1 = scriptedSystemOne({ "route.space": "solution", "route.kind": "design-system", "route.intent": "add", "route.anchor": "none" });
    const r = await route(tp.graph, tp.template, "Add a design system.", s1, IL);
    expect(r).toMatchObject({ intent: "add", status: "confident", calls: 4, target: { kind: "design-system", new: true, nodes: [] } });
    expect(r.path.map((s) => s.level)).toEqual(["space", "kind", "intent", "anchor"]);
  });

  it("still asks the intent after `none` or an unknown answer stops the navigation", async () => {
    const q = await route(tp.graph, tp.template, "Can we make it faster?", scriptedSystemOne({ "route.space": "none", "route.intent": "question" }), IL);
    expect(q).toMatchObject({ intent: "question", status: "confident", calls: 2, target: { nodes: [] } });
    const u = await route(tp.graph, tp.template, "x #s1low:route.space #s1:route.intent=question", fakeSystemOne(), IL);
    expect(u.path.map((s) => [s.level, s.status])).toEqual([["space", "unknown"], ["intent", "confident"]]);
    expect(u.status).toBe("unknown");
    expect(await route(tp.graph, tp.template, "hmm", scriptedSystemOne({ "route.space": "none", "route.intent": "unclear" }), IL)).toMatchObject({ status: "unknown" });
  });

  it("world: routes into a section by its id and down to a nested node", async () => {
    const s1 = scriptedSystemOne({ "route.intent": "update", "route.space": "node-thing-planning", "route.kind": "authorizationRule", "route.node": "auth-routine", "route.more": "no" });
    const r = await route(ws.graph, ws.template, "The assistant may also move blocks the user created.", s1, { order: "intent-last" });
    expect(r).toMatchObject({ root: "assistant-world", status: "confident", target: { space: "node-thing-planning", kind: "authorizationRule", nodes: ["auth-routine"] } });
  });
});

describe("route chain, both orders", () => {
  for (const order of ["intent-first", "intent-last"] as const) {
    const O = { ...tp.options, order }; // shortlist-first has its own block: its first question differs
    it(`${order}: goes on past review answers and takes the lowest status; continueOnReview: false stops there`, async () => {
      const msg = "Rename the species picker #s1low:route.kind #s1:route.intent=update #s1:route.space=solution #s1:route.kind=screen #s1:route.node=screen-species-picker";
      const loose = await route(tp.graph, tp.template, msg, fakeSystemOne(), { ...O, thresholds: { review: 0.2 } });
      expect(loose).toMatchObject({ status: "review", intent: "update", target: { kind: "screen", nodes: ["screen-species-picker"] } });
      const strict = await route(tp.graph, tp.template, msg, fakeSystemOne(), { ...O, thresholds: { review: 0.2 }, continueOnReview: false });
      expect(strict.status).toBe("review");
      expect(strict.target.nodes).toEqual([]);
      expect(strict.path.map((s) => s.level)).toEqual(order === "intent-first" ? ["intent", "space", "kind"] : ["space", "kind", "intent"]);
      const low = await route(tp.graph, tp.template, msg, fakeSystemOne(), O); // 0.3 is below review: unknown stops
      expect(low.status).toBe("unknown");
      expect(low.path.map((s) => s.level)).not.toContain("node");
    });

    it(`${order}: an update without a picked node is left for review`, async () => {
      const none = await route(tp.graph, tp.template, "x", scriptedSystemOne({ "route.intent": "update", "route.space": "none" }), O);
      expect(none).toMatchObject({ status: "review", calls: 2 });
      const fresh = await route(tp.graph, tp.template, "x", scriptedSystemOne({ "route.intent": "update", "route.space": "solution", "route.kind": "screen", "route.node": "new" }), O);
      expect(fresh).toMatchObject({ status: "review", target: { new: true, nodes: [] } });
    });

    it(`${order}: picks up to maxNodes nodes through follow-ups and never exceeds maxCalls`, async () => {
      const s1 = scriptedSystemOne({
        "route.intent": "link", "route.space": "solution", "route.kind": "module",
        "route.node": (_s, q) => keys(q)[0]!, "route.more": "yes", "route.nodes": (_s, q) => keys(q)[0]!,
      });
      const r = await route(tp.graph, tp.template, "Move the site map into the verification service", s1, O);
      expect(r.target.nodes).toHaveLength(3);
      expect(new Set(r.target.nodes).size).toBe(3);
      expect(r.calls).toBe(8);
      expect(r.intent).toBe("link");
      const tight = await route(tp.graph, tp.template, "Move the site map", s1, { ...O, maxCalls: 6 });
      expect(tight.target.nodes).toHaveLength(2);
      expect(tight.calls).toBeLessThanOrEqual(6);
      expect(tight).toMatchObject({ intent: "link", status: "confident", provenance: { truncated: true } });
    });

    it(`${order}: a budget that cuts the main chain leaves the route in review`, async () => {
      const r = await route(tp.graph, tp.template, "x", scriptedSystemOne({ "route.intent": "update", "route.space": "solution" }), { ...O, maxCalls: 2 });
      expect(r).toMatchObject({ status: "review", calls: 2, intent: "update", provenance: { truncated: true } });
    });

    it(`${order}: an answer outside the offered options is unknown`, async () => {
      const r = await route(tp.graph, tp.template, "x", scriptedSystemOne({ "route.intent": "update", "route.space": "solution", "route.kind": "goal" }), O);
      expect(r.status).toBe("unknown");
      expect(r.path.find((s) => s.level === "kind")).toMatchObject({ answer: "goal", status: "unknown" });
    });

    it(`${order}: a failing provider gives an unknown route with the error recorded`, async () => {
      const r = await route(tp.graph, tp.template, "x", offSystemOne(), O);
      expect(r).toMatchObject({ status: "unknown", calls: order === "intent-first" ? 1 : 2, provenance: { provider: "off" } });
      expect(r.provenance.errors?.[0]).toMatch(/off/);
    });

    it(`${order}: each question's state holds the message and the answers so far, never the graph`, async () => {
      const states: unknown[] = [];
      const s1 = fakeSystemOne();
      const spy = { ...s1, ask: (state: unknown, q: Parameters<typeof s1.ask>[1]) => { states.push(state); return s1.ask(state, q); } };
      await route(tp.graph, tp.template, "Rename the species picker", spy, O);
      expect(states.length).toBeGreaterThan(1);
      for (const s of states) expect(Object.keys(s as object).sort()).toEqual(["level", "message", "so_far", "task"]);
    });
  }
});

describe("route chain, shortlist-first (default)", () => {
  it("one question over the nodes nearest the message fixes space and kind, then the intent", async () => {
    let shortlisted: string[] = [];
    const s1 = scriptedSystemOne({ "route.shortlist": (_s, q) => { shortlisted = keys(q); return "screen-species-picker"; }, "route.more": "no", "route.intent": "update" });
    const r = await route(tp.graph, tp.template, "Rename the species picker to 'Species chooser'.", s1, tp.options);
    expect(r).toMatchObject({ order: "shortlist-first", intent: "update", status: "confident", target: { space: "solution", kind: "screen", nodes: ["screen-species-picker"] } });
    expect(r.path.map((s) => s.level)).toEqual(["shortlist", "more", "intent"]);
    expect(shortlisted[0]).toBe("screen-species-picker");
    expect(shortlisted.length).toBeLessThanOrEqual(ROUTE_DEFAULTS.maxChoices + 1);
    expect(shortlisted.at(-1)).toBe("none");
  });

  it("scores the kind name too, so 'the GPS rule' shortlists rules", async () => {
    let shortlisted: string[] = [];
    await route(tp.graph, tp.template, "The GPS rule should be 10 metres, not 20.",
      scriptedSystemOne({ "route.shortlist": (_s, q) => { shortlisted = keys(q); return "none"; }, "route.space": "none", "route.intent": "question" }), tp.options);
    expect(shortlisted[0]).toBe("rule-every-observation-carries-a-gps-fix");
  });

  it("an add after a shortlisted anchor asks the new item's kind (named kinds, then the anchor's space) and takes that kind's space", async () => {
    let kinds: string[] = [];
    const s1 = scriptedSystemOne({
      "route.shortlist": "usage-event-survey-abandoned-mid-transect", "route.more": "no", "route.intent": "add",
      "route.kind": (_s, q) => { kinds = keys(q); return "event"; },
    });
    const r = await route(tp.graph, tp.template, "Add an event when a survey is abandoned mid-transect so we can count it.", s1, tp.options);
    expect(r).toMatchObject({ intent: "add", status: "confident", target: { space: "solution", kind: "event", nodes: ["usage-event-survey-abandoned-mid-transect"] } });
    expect(kinds.slice(0, 2).sort()).toEqual(["event", "usage-event"]); // both named by "event"; the anchor's space breaks the tie
    expect(kinds).toEqual(expect.arrayContaining(["metric-reading", "feedback", "evidence", "none"]));
  });

  it("`none` on the shortlist falls back to the space, kind and node chain", async () => {
    const s1 = scriptedSystemOne({ "route.shortlist": "none", "route.space": "problem", "route.kind": "audience", "route.node": "new", "route.intent": "add", "route.anchor": "none" });
    const r = await route(tp.graph, tp.template, "We also need to support school groups doing shore surveys with a teacher.", s1, tp.options);
    expect(r.path.map((s) => s.level)).toEqual(["shortlist", "space", "kind", "node", "intent", "anchor"]);
    expect(r).toMatchObject({ intent: "add", status: "confident", target: { space: "problem", kind: "audience", new: true, nodes: [] } });
  });

  it("an unknown space falls back to a kind question over every kind with nodes and a node across the graph", async () => {
    let kinds: string[] = [];
    const msg = "Percent cover should be in 10% steps #s1low:route.space #s1:route.shortlist=none #s1:route.node=term-percent-cover #s1:route.more=no #s1:route.intent=update";
    const s1 = scriptedSystemOne({ "route.kind": (_s, q) => { kinds = keys(q); return "term"; } });
    const r = await route(tp.graph, tp.template, msg, s1, tp.options);
    expect(r.path.map((s) => [s.level, s.status])).toEqual([["shortlist", "confident"], ["space", "unknown"], ["kind", "confident"], ["node", "confident"], ["more", "confident"], ["intent", "confident"]]);
    expect(r).toMatchObject({ status: "review", intent: "update", target: { space: "solution", kind: "term", nodes: ["term-percent-cover"] } });
    expect(kinds[0]).toBe("term");
    expect(kinds.length).toBeLessThanOrEqual(ROUTE_DEFAULTS.maxChoices + 1);
  });

  it("a `new` below confident is settled by the anchor: a picked anchor clears it, `none` keeps it", async () => {
    const base = { "route.shortlist": "none", "route.space": "solution", "route.kind": "term", "route.intent": "update" };
    const lowNew = "Percent cover steps #s1low:route.node #s1:route.node=new";
    const picked = await route(tp.graph, tp.template, lowNew, scriptedSystemOne({ ...base, "route.anchor": "term-percent-cover" }), { ...tp.options, thresholds: { review: 0.2 } });
    expect(picked.path.map((s) => s.level)).toEqual(["shortlist", "space", "kind", "node", "intent", "anchor"]);
    expect(picked.target).toMatchObject({ nodes: ["term-percent-cover"] });
    expect(picked.target.new).toBeUndefined();
    expect(picked.status).toBe("review");
    const none = await route(tp.graph, tp.template, lowNew, scriptedSystemOne({ ...base, "route.anchor": "none" }), { ...tp.options, thresholds: { review: 0.2 } });
    expect(none.target).toMatchObject({ new: true, nodes: [] });
    const sure = await route(tp.graph, tp.template, "Percent cover steps", scriptedSystemOne({ ...base, "route.node": "new" }), tp.options);
    expect(sure.path.map((s) => s.level)).toEqual(["shortlist", "space", "kind", "node", "intent"]);
    expect(sure.target.new).toBe(true);
  });

  it("an empty shortlist goes straight to the chain; calls stay within budget", async () => {
    const r = await route(tp.graph, tp.template, "zzz qqq", scriptedSystemOne({ "route.space": "none", "route.intent": "question" }), tp.options);
    expect(r.path.map((s) => s.level)).toEqual(["space", "intent"]);
    const busy = scriptedSystemOne({ "route.shortlist": "none", "route.space": "solution", "route.kind": "module", "route.node": (_s, q) => keys(q)[0]!, "route.more": "yes", "route.nodes": (_s, q) => keys(q)[0]!, "route.intent": "link" });
    const b = await route(tp.graph, tp.template, "Move the site map into the verification service module", busy, tp.options);
    expect(b.calls).toBeLessThanOrEqual(8);
    expect(b.intent).toBe("link");
  });

  it("world: a shortlisted nested node gives its section as the space", async () => {
    const s1 = scriptedSystemOne({ "route.shortlist": "auth-routine", "route.more": "no", "route.intent": "update" });
    const r = await route(ws.graph, ws.template, "The assistant may also move blocks the user created, as long as it asks first.", s1);
    expect(r).toMatchObject({ status: "confident", target: { space: "node-thing-planning", kind: "authorizationRule", nodes: ["auth-routine"] } });
  });
});

describe("node ordering under maxChoices", () => {
  /** Gold nodes the node level would not offer: for an add, the space's nodes; otherwise the kind's nodes in the space. */
  function cut(setting: ReturnType<typeof tidepool>) {
    const v = routeView(setting.graph, setting.options);
    const out: string[] = [];
    for (const c of setting.cases.cases) {
      const g = c.gold;
      if (g.intent === "question" || !g.space || !g.nodes.length) continue;
      const sp = v.spaces.find((s) => s.key === g.space);
      if (!sp) { out.push(`${c.id}: space ${g.space} missing`); continue; }
      const pool = g.intent === "add" ? sp.nodes : sp.nodes.filter((id) => v.byId.get(id)!.kind === g.kind);
      const offered = rankNodes(v, c.message, pool).slice(0, ROUTE_DEFAULTS.maxChoices);
      if (!g.nodes.some((n) => offered.includes(n))) out.push(c.id);
    }
    return out;
  }
  it("offers a gold node in the top 12 for every routable tidepool case", () => {
    expect(cut(tp)).toEqual([]);
  });
  it("offers a gold node in the top 12 for every routable assistant case", () => {
    expect(cut(ws)).toEqual([]);
  });
});

describe("routeSlice and routeVocabulary", () => {
  it("bounds the translator's view to the targets, their parents and one hop", async () => {
    const s1 = scriptedSystemOne({ "route.intent": "remove", "route.space": "solution", "route.kind": "feature", "route.node": "feature-low-tide-reminders", "route.more": "no" });
    const r = await route(tp.graph, tp.template, "Drop the low-tide reminders feature", s1, tp.options);
    const slice = routeSlice(tp.graph, r);
    const ids = slice.nodes.map((n) => n.id);
    expect(slice.targets).toEqual(["feature-low-tide-reminders"]);
    expect(ids).toEqual(expect.arrayContaining(["feature-low-tide-reminders", "$spec", "flow-get-a-reminder-before-the-next-good-tide"]));
    expect(ids.length).toBeLessThan(tp.graph.nodes.length / 3);
    expect(slice.nodes.every((n) => Object.keys(n.fields).every((k) => !k.startsWith("source.")))).toBe(true);
    expect(slice.links.every((l) => ids.includes(l.from) && ids.includes(l.to))).toBe(true);
    const vocab = routeVocabulary(tp.template, r, slice);
    expect(vocab.kinds).toContain("feature");
    expect(Object.keys(vocab.relations)).toContain("serves");
  });
  it("uses related nodes when the route picked none", async () => {
    const r = await route(tp.graph, tp.template, "Add a metric for how many photos each survey has.",
      scriptedSystemOne({ "route.intent": "add", "route.space": "hypothesis", "route.kind": "metric", "route.node": "new", "route.anchor": "none" }), IL);
    expect(r.target.nodes).toEqual([]);
    expect(r.target.related.length).toBeGreaterThan(0);
    expect(routeSlice(tp.graph, r).targets).toEqual(r.target.related);
  });
});
