import { describe, expect, it } from "vitest";
import {
  buildSlice, evaluate, evaluateAndJudge, fakeSystemOne, judge, loadTemplate, memoryStore, offSystemOne, SliceSchema,
  type Graph, type Readiness, type SystemOne,
} from "../src/index.ts";
import { base, board, clean } from "./fixture.ts";

type Q = Record<string, unknown>;
const vague: Q = { id: "card.vague", answer: "yes-no", slice: { fields: ["title"], hops: 1 }, benign: "no", policy: [{ answer: "no", level: "pass" }, { answer: "yes", level: "warning" }] };
const tpl = (questions: Q[] = [vague]) => loadTemplate({ ...board(), questions }, memoryStore([base()]));
const graph = (title = "Do stuff"): Graph => { const g = clean(); g.nodes[1].fields.title = title; return g; };
const semantic = (r: Readiness) => r.findings.filter((f) => f.rule === "semantic:card.vague");
const fake = fakeSystemOne();

describe("judge", () => {
  it("leaves evaluate synchronous and unjudged", () => {
    const r = evaluate(tpl(), graph());
    expect(semantic(r)).toMatchObject([{ level: "info", subject: "c1" }]);
    expect(r.judgments).toEqual({ confident: 0, review: 0, unknown: 0, calls: 0, rounds: 0, gated: 0, budget: "ok", explained: 0 });
    expect(r.buildable).toBe(false);
  });

  it("benign answer becomes the declared level and unblocks buildable", async () => {
    const r = await evaluateAndJudge(tpl(), graph(), fake);
    const [f] = semantic(r);
    expect(f).toMatchObject({ level: "pass", judgment: { question: "card.vague", status: "confident", answer: "no", confidence: 0.95 } });
    expect(f.provenance).toMatchObject({ provider: "fake", model: "fake", thresholds: { confident: 0.9, review: 0.5 } });
    expect(r.judgments).toEqual({ confident: 1, review: 0, unknown: 0, calls: 1, rounds: 1, gated: 0, budget: "ok", explained: 0 });
    expect(r).toMatchObject({ buildable: true, actionable: true });
  });

  it("a confident harmful answer takes the policy level", async () => {
    const r = await evaluateAndJudge(tpl(), graph("Do stuff #s1harm"), fake);
    expect(semantic(r)).toMatchObject([{ level: "warning", judgment: { status: "confident", answer: "yes" } }]);
    expect(r).toMatchObject({ buildable: false, actionable: true });
  });

  it("#s1low lands in review", async () => {
    const r = await evaluateAndJudge(tpl(), graph("Do stuff #s1low"), fake);
    expect(semantic(r)).toMatchObject([{ level: "review", judgment: { status: "review", answer: "yes", confidence: 0.55 } }]);
    expect(r.judgments).toEqual({ confident: 0, review: 1, unknown: 0, calls: 1, rounds: 1, gated: 0, budget: "ok", explained: 0 });
    expect(r.buildable).toBe(false);
  });

  it("thresholds are an option", async () => {
    const r = await evaluateAndJudge(tpl(), graph("Do stuff #s1low"), fake, { thresholds: { confident: 0.5, review: 0.3 } });
    expect(semantic(r)).toMatchObject([{ level: "warning", judgment: { status: "confident" }, provenance: { thresholds: { confident: 0.5, review: 0.3 } } }]);
  });

  it("#s1no gives an answer the policy does not map: unknown, not buildable", async () => {
    const concrete = { ...vague, benign: "yes", policy: [{ answer: "yes", level: "pass" }] };
    const r = await evaluateAndJudge(tpl([concrete]), graph("Do stuff #s1no"), fake);
    expect(semantic(r)).toMatchObject([{ level: "info", judgment: { status: "unknown", answer: "no" } }]);
    expect(r.judgments).toEqual({ confident: 0, review: 0, unknown: 1, calls: 1, rounds: 1, gated: 0, budget: "ok", explained: 0 });
    expect(r.buildable).toBe(false);
  });

  it("a candidate without a catalogue entry stays unknown with provider off", async () => {
    const r = await evaluateAndJudge(tpl([]), graph(), fake);
    expect(semantic(r)).toMatchObject([{ level: "info", judgment: { status: "unknown" }, provenance: { provider: "off" } }]);
    expect(r.buildable).toBe(false);
  });

  it("a throwing provider gives unknown with provider error, sync or async", async () => {
    const boom = (sync: boolean): SystemOne => ({
      mode: "http", model: "m",
      ask: sync ? () => { throw new TypeError("boom"); } : async () => { throw new Error("later"); },
    });
    for (const [s1, message] of [[boom(true), "boom"], [boom(false), "later"]] as const) {
      const r = await evaluateAndJudge(tpl(), graph(), s1);
      expect(semantic(r)).toMatchObject([{ level: "info", judgment: { status: "unknown" }, provenance: { provider: "error", model: "m", error: { message } } }]);
      expect(r.buildable).toBe(false);
    }
    const off = await evaluateAndJudge(tpl(), graph(), offSystemOne());
    expect(semantic(off)).toMatchObject([{ provenance: { provider: "off", error: { code: "off" } } }]);
  });

  it("provenance hashes are stable and track the slice", async () => {
    const run = async (g: Graph) => semantic(await evaluateAndJudge(tpl(), g, fake))[0].provenance!;
    const a = await run(graph()), b = await run(graph());
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.questionHash).toBe(b.questionHash);
    const outside = graph(); outside.nodes.push({ id: "p9", kind: "person", fields: { handle: "p9" } });
    expect((await run(outside)).stateHash).toBe(a.stateHash);
    const inside = graph(); inside.nodes[2].fields.title = "Shipped";
    expect((await run(inside)).stateHash).not.toBe(a.stateHash);
    expect((await run(graph("Do more stuff"))).stateHash).not.toBe(a.stateHash);
  });

  it("judged Readiness JSON is byte-identical across runs", async () => {
    const t = tpl();
    const a = JSON.stringify(await evaluateAndJudge(t, graph(), fake));
    const b = JSON.stringify(await judge(evaluate(t, graph()), t, graph(), fakeSystemOne()));
    expect(a).toBe(b);
  });
});

describe("buildSlice", () => {
  const g = graph();
  const spec = (o: Q = {}) => SliceSchema.parse(o);
  const cand = { rule: "r", text: "t" };

  it("defaults to the subject and its parent chain", () => {
    const s = buildSlice(g, "c1", spec(), cand);
    expect(s.subject).toMatchObject({ id: "c1", kind: "card", parent: "b1" });
    expect(s.parents.map((p) => p.id)).toEqual(["b1"]);
    expect(s.nodes).toEqual([]);
  });

  it("follows links within hops, filtered by relation, kind and direction", () => {
    expect(buildSlice(g, "c1", spec({ hops: 1 }), cand).nodes.map((n) => n.id)).toEqual(["c2", "p1"]);
    expect(buildSlice(g, "c1", spec({ hops: 1, rels: ["assignedTo"] }), cand).nodes.map((n) => n.id)).toEqual(["p1"]);
    expect(buildSlice(g, "c1", spec({ hops: 1, kinds: ["card"] }), cand).nodes.map((n) => n.id)).toEqual(["c2"]);
    expect(buildSlice(g, "p1", spec({ hops: 1, direction: "in" }), cand).nodes.map((n) => n.id)).toEqual(["c1", "c2"]);
    expect(buildSlice(g, "c1", spec({ hops: 2, direction: "both", rels: ["assignedTo"] }), cand).nodes.map((n) => n.id)).toEqual(["c2", "p1"]);
  });

  it("keeps only named fields and marks a missing subject", () => {
    expect(buildSlice(g, "c1", spec({ fields: ["title"], parents: false }), cand)).toMatchObject({ subject: { fields: { title: "Do stuff" } }, parents: [] });
    expect(buildSlice(g, "ghost", spec(), cand).subject).toEqual({ id: "ghost", missing: true });
  });
});
