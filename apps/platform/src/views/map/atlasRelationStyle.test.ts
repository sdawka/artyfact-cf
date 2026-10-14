import { describe, expect, it } from "vitest";
import { relationDirections } from "./atlasRelationStyle";
import { selectedBoundaryEdges } from "./atlasConnections";
import { buildIndex } from "@/model/index";
import { fixtureBundle } from "@/api/fixtures";
import { buildMapGraph } from "./useMapGraph";
import { layoutAtlas } from "./atlasLayout";

const box = (x: number, y = 0) => ({ x, y, width: 100, height: 100 });
describe("relation-facing inset borders", () => {
  it("retains opposite neighbors independently instead of cancelling vectors", () => {
    const result = relationDirections({ boxes: { a: box(100), b: box(0), c: box(200) }, width: 300, height: 100 }, [{ source: "a", target: "b" }, { source: "a", target: "c" }]);
    expect(result.get("a")).toEqual({ top: 1, right: 3, bottom: 1, left: 3 });
    expect(result.get("b")?.right).toBe(3);
    expect(result.get("c")?.left).toBe(3);
  });
  it("uses both facing sides for diagonal relations and ignores absent endpoints", () => {
    const result = relationDirections({ boxes: { a: box(0), b: box(100, 100) }, width: 200, height: 200 }, [{ source: "a", target: "b" }, { source: "a", target: "missing" }]);
    expect(result.get("a")).toEqual({ top: 1, right: 3, bottom: 3, left: 1 });
    expect(relationDirections({ boxes: { a: box(0) }, width: 100, height: 100 }, []).size).toBe(0);
  });
  it("uses the selected subtree cut and actual outside box centers", () => {
    const index = buildIndex(fixtureBundle()), graph = buildMapGraph(index, "screen.people"), layout = layoutAtlas(graph);
    const edges = selectedBoundaryEdges(graph, "screen.people", index);
    const directions = relationDirections(layout, edges);
    expect(directions.has("entity.ContactRecord")).toBe(true);
    expect(directions.has("component.SearchInput")).toBe(false);
    for (const values of directions.values()) expect(Object.values(values).every(value => value >= 1 && value <= 3)).toBe(true);
  });
});
