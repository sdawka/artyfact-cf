import { describe, expect, it } from "vitest";
import { absoluteBoxes, layoutGraph, LAYERED_RIGHT, partition, toElkGraph, type LayoutRequest } from "./elk";

const req: LayoutRequest = {
  layoutOptions: { ...LAYERED_RIGHT, "elk.partitioning.activate": "true" },
  nodes: [
    { id: "ext", width: 160, height: 40, layoutOptions: partition(0) },
    { id: "group", width: 0, height: 0, layoutOptions: { ...partition(1), "elk.padding": "[top=40,left=16,bottom=16,right=16]" } },
    { id: "a", width: 120, height: 40, parentId: "group" },
    { id: "b", width: 120, height: 40, parentId: "group" },
    { id: "out", width: 120, height: 40, layoutOptions: partition(1) },
  ],
  edges: [
    { id: "a-b", source: "a", target: "b" },
    { id: "a-ext", source: "a", target: "ext" },
    { id: "b-out", source: "b", target: "out" },
    { id: "group-a", source: "group", target: "a" },
  ],
};

describe("toElkGraph", () => {
  it("nests children under their parent and drops edges between a node and its ancestor", () => {
    const g = toElkGraph(req);
    expect(g.children?.map((c) => c.id)).toEqual(["ext", "group", "out"]);
    expect(g.children?.[1]?.children?.map((c) => c.id)).toEqual(["a", "b"]);
    expect(g.edges?.map((e) => e.id)).toEqual(["a-b", "a-ext", "b-out"]);
  });
});

describe("layoutGraph (in-thread fallback)", () => {
  it("returns numeric positions, parent bounds containing children, and partition order", async () => {
    const out = await layoutGraph(req);
    for (const n of req.nodes) {
      const box = out.nodes[n.id];
      expect(box, n.id).toBeDefined();
      for (const v of [box!.x, box!.y, box!.width, box!.height]) expect(Number.isFinite(v), `${n.id} ${v}`).toBe(true);
    }
    const group = out.nodes.group!;
    for (const id of ["a", "b"]) {
      const c = out.nodes[id]!; // relative to the group
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(group.width);
      expect(c.y + c.height).toBeLessThanOrEqual(group.height);
    }
    const abs = absoluteBoxes(out, req);
    expect(abs.ext!.x + abs.ext!.width).toBeLessThanOrEqual(abs.group!.x);
    expect(abs.a!.x).toBe(group.x + out.nodes.a!.x);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});
