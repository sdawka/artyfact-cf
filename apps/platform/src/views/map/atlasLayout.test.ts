import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "@/model/index";
import { buildMapGraph, ENVIRONMENT_SCOPE, type MapGraph, type MapNode } from "./useMapGraph";
import { layoutAtlas } from "./atlasLayout";

const tile = (id: string, extra: Partial<MapNode> = {}): MapNode => ({ id, name: id, kind: "component", role: "child", childCount: 0, description: "", preview: [], ...extra });
const graph = (nodes: MapNode[], scope = ENVIRONMENT_SCOPE): MapGraph => ({ scope, nodes, edges: [], ids: new Set(nodes.map((n) => n.id)), bands: [], layered: false });
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe("layoutAtlas", () => {
  it("packs readable content-sized rectangles with shared row boundaries and no gutters", () => {
    const g = graph([
      tile("frame", { role: "scope" }),
      tile("short"),
      tile("medium", { description: "A concise purpose explaining this component's job." }),
      tile("large", { name: "A longer descriptive component name", description: "A purpose with enough context to explain the boundary and its responsibilities.", childCount: 3, preview: [{ id: "a", name: "First", kind: "component" }, { id: "b", name: "Second", kind: "component" }, { id: "c", name: "Third", kind: "component" }] }),
      ...Array.from({ length: 5 }, (_, i) => tile(`more-${i}`)),
    ], "frame");
    const l = layoutAtlas(g);
    expect(Object.keys(l.boxes)).toHaveLength(9);
    expect(l.boxes.medium!.width * l.boxes.medium!.height).toBeGreaterThan(l.boxes.short!.width * l.boxes.short!.height);
    expect(l.boxes.large!.width * l.boxes.large!.height).toBeGreaterThan(l.boxes.medium!.width * l.boxes.medium!.height);
    for (const b of Object.values(l.boxes)) {
      expect(b.width).toBeGreaterThanOrEqual(216);
      expect(b.height).toBeGreaterThanOrEqual(144);
      expect([b.x, b.y, b.width, b.height].every(Number.isFinite)).toBe(true);
    }
    const bs = Object.entries(l.boxes).filter(([id]) => id !== "frame").map(([, box]) => box);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(overlap(bs[i]!, bs[j]!)).toBe(false);
    const ys = [...new Set(bs.map((b) => b.y))].sort((a, b) => a - b);
    let bottom = 80;
    for (const y of ys) {
      expect(y).toBe(bottom);
      const row = bs.filter((b) => b.y === y).sort((a, b) => a.x - b.x);
      let right = l.boxes.frame!.x;
      for (const b of row) { expect(b.x).toBeCloseTo(right); right += b.width; expect(b.height).toBe(row[0]!.height); }
      expect(right).toBeCloseTo(l.boxes.frame!.x + l.boxes.frame!.width);
      bottom = y + row[0]!.height;
    }
    expect(bottom).toBe(l.boxes.frame!.height);
  });

  it("uses absolute children inside a scope background and puts context outside it", () => {
    const g = buildMapGraph(buildIndex(fixtureBundle()), "screen.people");
    const l = layoutAtlas(g);
    expect(Object.keys(l.boxes)).toHaveLength(g.nodes.length);
    const scope = l.boxes["screen.people"]!;
    for (const n of g.nodes) {
      const b = l.boxes[n.id]!;
      expect(b).toBeDefined();
      if (n.role === "child") {
        expect(b.x).toBeGreaterThanOrEqual(scope.x);
        expect(b.y).toBeGreaterThan(scope.y);
        expect(b.x + b.width).toBeLessThanOrEqual(scope.x + scope.width + 0.001);
        expect(b.y + b.height).toBeLessThanOrEqual(scope.y + scope.height + 0.001);
      } else if (n.role !== "scope") {
        expect(overlap(scope, b)).toBe(false);
        expect(b.x + b.width <= scope.x - 32 || b.x >= scope.x + scope.width + 32).toBe(true);
      }
    }
  });

  it("ignores edge visibility, certainty, overlay data and input order when placing the same content", () => {
    const g = buildMapGraph(buildIndex(fixtureBundle()), ENVIRONMENT_SCOPE);
    const original = layoutAtlas(g);
    const changed = { ...g, nodes: [...g.nodes].reverse(), edges: [], layered: !g.layered, bands: [] };
    expect(layoutAtlas(changed)).toEqual(original);
    expect(layoutAtlas(g)).toEqual(original);
  });

  it("keeps the scope mosaic fixed when boundary relationship context is hidden", () => {
    const scope = tile("scope", { role: "scope" });
    const child = tile("child", { parentId: "scope" });
    const outside = tile("outside", { role: "outside", description: "An authored purpose long enough to need a medium reading budget." });
    const shown = layoutAtlas(graph([scope, child, outside], "scope"));
    const hidden = layoutAtlas(graph([scope, child], "scope"));
    expect(shown.boxes.scope).toEqual(hidden.boxes.scope);
    expect(shown.boxes.child).toEqual(hidden.boxes.child);
  });

  it("makes the environment System prominent and central between disconnected perimeter actors", () => {
    const g = graph([
      tile("system.main", { kind: "system" }),
      ...["a", "b", "c", "d"].map((id) => tile(`ext.${id}`, { role: "external", kind: "external" })),
    ]);
    const l = layoutAtlas(g);
    const system = l.boxes["system.main"]!;
    expect(system).toEqual({ x: 292, y: 0, width: 560, height: 320 });
    expect(l.boxes["ext.a"]).toMatchObject({ x: 0, y: 0, width: 260 });
    expect(l.boxes["ext.b"]).toMatchObject({ x: 884, y: 0, width: 260 });
    expect(l.boxes["ext.c"]!.y).toBeGreaterThan(l.boxes["ext.a"]!.y);
    expect(l.boxes["ext.d"]!.y).toBeGreaterThan(l.boxes["ext.b"]!.y);
    expect(system.x + system.width / 2).toBe(l.width / 2);
    const boxes = Object.values(l.boxes);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
    expect(layoutAtlas(graph([g.nodes[0]!])).boxes["system.main"]).toEqual(system);
    expect(layoutAtlas({ ...g, nodes: [...g.nodes].reverse() })).toEqual(l);
  });

  it("keeps outside-System actors and outside-scope context in separate readable perimeter columns", () => {
    const g = graph([
      tile("scope", { role: "scope" }), tile("child", { parentId: "scope" }),
      tile("ext.actor", { role: "external" }),
      tile("context.other", { role: "outside", description: "x".repeat(180) }),
      tile("context.second", { role: "outside" }),
    ], "scope");
    const l = layoutAtlas(g);
    expect(l.boxes["ext.actor"]).toMatchObject({ x: 0, y: 0, width: 260 });
    expect(l.boxes["context.other"]).toMatchObject({ x: 1188, y: 0, width: 260 });
    expect(l.boxes["context.second"]!.y).toBeGreaterThanOrEqual(l.boxes["context.other"]!.height);
    const independent = Object.entries(l.boxes).filter(([id]) => id !== "child").map(([, box]) => box);
    for (let i = 0; i < independent.length; i++) for (let j = i + 1; j < independent.length; j++) expect(overlap(independent[i]!, independent[j]!)).toBe(false);
    for (const id of ["ext.actor", "context.other", "context.second"]) {
      expect(l.boxes[id]!.height).toBeGreaterThanOrEqual(144);
      expect(l.boxes[id]!.y + l.boxes[id]!.height).toBeLessThanOrEqual(l.height);
    }
  });

  it("handles an empty graph and a leaf scope with finite positive bounds", () => {
    expect(layoutAtlas(graph([]))).toEqual({ boxes: {}, width: 0, height: 0 });
    const g = graph([tile("leaf", { role: "scope" })], "leaf");
    const l = layoutAtlas(g);
    expect(l.boxes.leaf).toMatchObject({ x: 292, y: 0 });
    expect(l.width).toBeGreaterThanOrEqual(216);
    expect(l.height).toBeGreaterThanOrEqual(144);
  });
});
