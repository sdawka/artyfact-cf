import { describe, expect, it } from "vitest";
import { initialAtlasViewport } from "./atlasViewport";
import { buildIndex } from "@/model/index";
import { fixtureBundle } from "@/api/fixtures";
import { buildMapGraph, ENVIRONMENT_SCOPE } from "./useMapGraph";
import { layoutAtlas } from "./atlasLayout";

const index = buildIndex(fixtureBundle());
describe("initial atlas camera", () => {
  it("keeps mobile labels readable and anchors the System header inside the canvas", () => {
    const graph = buildMapGraph(index, ENVIRONMENT_SCOPE);
    const layout = layoutAtlas(graph);
    const viewport = initialAtlasViewport(layout, graph, 320, 420);
    const system = layout.boxes[index.model.system.id]!;
    expect(viewport.zoom).toBe(0.85);
    expect(system.x * viewport.zoom + viewport.x).toBe(16);
    expect(system.y * viewport.zoom + viewport.y).toBe(16);
  });
  it("centers both environment columns when desktop width fits at the readable floor", () => {
    const graph = buildMapGraph(index, ENVIRONMENT_SCOPE);
    const layout = layoutAtlas(graph);
    const viewport = initialAtlasViewport(layout, graph, 1440, 300);
    const system = layout.boxes[index.model.system.id]!;
    expect(viewport.zoom).toBe(0.85);
    expect(viewport.x).toBeGreaterThan(0);
    expect(viewport.x + layout.width * viewport.zoom).toBeLessThan(1440);
    expect(viewport.x + (system.x + system.width / 2) * viewport.zoom).toBe(720);
    expect(system.y * viewport.zoom + viewport.y).toBe(16);
  });
  it("prioritizes the immediate scope rather than shrinking to distant context", () => {
    const graph = buildMapGraph(index, "screen.people");
    const layout = layoutAtlas(graph);
    const viewport = initialAtlasViewport(layout, graph, 900, 600);
    expect(viewport.zoom).toBeGreaterThanOrEqual(0.85);
    expect(layout.boxes[graph.scope]!.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(0);
  });
  it("never leaves the outside-scope column peeking in at the right edge", () => {
    const graph = buildMapGraph(index, "screen.people");
    const layout = layoutAtlas(graph);
    const outside = graph.nodes.filter((n) => n.role === "outside").map((n) => layout.boxes[n.id]!);
    expect(outside.length).toBeGreaterThan(0);
    for (const width of [390, 900, 1120, 1600]) {
      const v = initialAtlasViewport(layout, graph, width, 700);
      const left = v.x + Math.min(...outside.map((b) => b.x)) * v.zoom, right = v.x + Math.max(...outside.map((b) => b.x + b.width)) * v.zoom;
      expect(left >= width - 0.001 || right <= width, `outside column at ${width}px`).toBe(true);
      const scope = layout.boxes[graph.scope]!;
      expect(v.x + scope.x * v.zoom).toBeGreaterThanOrEqual(0);
    }
  });
});
