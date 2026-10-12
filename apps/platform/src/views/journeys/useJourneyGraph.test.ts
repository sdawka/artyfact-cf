import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { buildJourneyGraph, laneOf, useJourneyGraph } from "./useJourneyGraph";

const journeys = fixtureBundle().model.journeys;
const connect = journeys.find((j) => j.id === "J.connect")!;

describe("buildJourneyGraph(J.connect)", () => {
  const g = buildJourneyGraph(connect);
  it("has 14 step nodes and three lanes of use", () => {
    expect(g.nodes).toHaveLength(14);
    expect(new Set(g.nodes.map((n) => n.data.lane))).toEqual(new Set(["actor", "system", "external"]));
  });
  it("maps kinds to node types", () => {
    const type = (id: string) => g.nodes.find((n) => n.id === id)?.type;
    expect(type("s4")).toBe("decision");
    expect(type("e1")).toBe("terminal");
    expect(type("s2")).toBe("system");
    expect(type("s1")).toBe("action");
  });
  it("assigns lanes by actor, with handoffs to externals in the external lane", () => {
    const lane = (id: string) => g.nodes.find((n) => n.id === id)?.data.lane;
    expect(lane("s1")).toBe("actor");
    expect(lane("s4")).toBe("actor");
    expect(lane("s2")).toBe("system");
    expect(lane("s3")).toBe("external");
  });
  it("flags edges into failure steps and keeps branch labels", () => {
    const failures = g.edges.filter((e) => e.data?.failure);
    expect(failures.length).toBeGreaterThanOrEqual(2);
    expect(failures.map((e) => e.target).sort()).toEqual(["f1", "f1", "f2"]);
    const s4 = g.edges.filter((e) => e.source === "s4").map((e) => e.label);
    expect(s4).toEqual(["token valid", "token invalid, expired or used"]);
  });
  it("filters to a segment and drops dangling edges", () => {
    const seg = buildJourneyGraph(connect, ["s1", "s2", "s3"]);
    expect(seg.nodes).toHaveLength(3);
    expect(seg.edges.map((e) => e.id)).toEqual(["s1->s2#0", "s2->s3#0"]);
  });
  it("marks unresolved steps", () => {
    const j = { ...connect, steps: connect.steps.map((s) => (s.id === "s1" ? { ...s, unresolved: true } : s)) };
    expect(buildJourneyGraph(j).nodes[0]!.data.unresolved).toBe(true);
  });
  it("laneOf: a person using their own screen stays in the actor lane", () => {
    expect(laneOf({ ...connect.steps[0]!, external: "ext.channels", screen: "screen.person" })).toBe("actor");
  });
});

describe("useJourneyGraph", () => {
  it("positions every node inside its lane band, then settles on elk columns", async () => {
    const { result } = renderHook(() => useJourneyGraph(connect));
    expect(result.current.bands.map((b) => b.lane)).toEqual(["actor", "system", "external"]);
    // elk loads lazily and can be slow when the whole suite runs in parallel.
    await waitFor(() => expect(result.current.layoutReady).toBe(true), { timeout: 5000 });
    for (const n of result.current.nodes) {
      const band = result.current.bands.find((b) => b.lane === n.data.lane)!;
      expect(n.position.y).toBeGreaterThanOrEqual(band.y);
      expect(n.position.y + (n.height ?? 0)).toBeLessThanOrEqual(band.y + band.height);
    }
    const boxes = result.current.nodes.map((n) => ({ ...n.position, w: n.width!, h: n.height! }));
    for (const a of boxes) for (const b of boxes) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap).toBe(false);
    }
  });
});
