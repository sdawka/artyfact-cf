import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "@/model/index";
import { buildMapGraph, ENVIRONMENT_SCOPE, type MapGraph, type MapNode } from "./useMapGraph";
import { columnsForCanvas, layoutAtlas, SCOPE_HEADER, SCOPE_PAD } from "./atlasLayout";
import { TILE } from "./atlasTile";

const tile = (id: string, extra: Partial<MapNode> = {}): MapNode => ({ id, name: id, kind: "component", role: "child", childCount: 0, description: "", inside: [], ...extra });
const graph = (nodes: MapNode[], scope = ENVIRONMENT_SCOPE): MapGraph => ({ scope, nodes, edges: [], ids: new Set(nodes.map((n) => n.id)), bands: [], layered: false });
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe("layoutAtlas", () => {
  it("packs content-sized tiles as masonry columns inside the scope frame, with no overlap and no wasted rows", () => {
    const g = graph([
      tile("frame", { role: "scope" }),
      tile("short"),
      tile("medium", { description: "A concise purpose explaining this component's job." }),
      tile("large", { name: "A longer descriptive component name", description: "A purpose with enough context to explain the boundary and its responsibilities.", childCount: 3, inside: [{ kind: "component", count: 3 }] }),
      ...Array.from({ length: 5 }, (_, i) => tile(`more-${i}`)),
    ], "frame");
    const l = layoutAtlas(g);
    const frame = l.boxes.frame!;
    expect(Object.keys(l.boxes)).toHaveLength(9);
    // Height follows content; every tile has the same column width.
    expect(l.boxes.medium!.height).toBeGreaterThan(l.boxes.short!.height);
    expect(l.boxes.large!.height).toBeGreaterThan(l.boxes.medium!.height);
    const bs = Object.entries(l.boxes).filter(([id]) => id !== "frame").map(([, box]) => box);
    for (const b of bs) {
      expect(b.width).toBe(TILE.width);
      expect(b.height).toBeLessThan(TILE.width);
      expect(b.x).toBeGreaterThanOrEqual(frame.x + SCOPE_PAD);
      expect(b.y).toBeGreaterThanOrEqual(SCOPE_HEADER);
      expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width - SCOPE_PAD);
      expect(b.y + b.height).toBeLessThanOrEqual(frame.height - SCOPE_PAD);
    }
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(overlap(bs[i]!, bs[j]!)).toBe(false);
    // Columns sit a gutter apart and each column stacks its tiles a gutter apart from the header down.
    const columns = [...new Set(bs.map((b) => b.x))].sort((a, b) => a - b);
    expect(columns.length).toBeGreaterThan(1);
    columns.forEach((x, i) => {
      expect(x).toBe(frame.x + SCOPE_PAD + i * (TILE.width + TILE.gap));
      const stack = bs.filter((b) => b.x === x).sort((a, b) => a.y - b.y);
      let top = SCOPE_HEADER;
      for (const b of stack) { expect(b.y).toBe(top); top = b.y + b.height + TILE.gap; }
    });
    expect(frame.width).toBe(columns.length * TILE.width + (columns.length - 1) * TILE.gap + 2 * SCOPE_PAD);
    expect(frame.height).toBe(Math.max(...bs.map((b) => b.y + b.height)) + SCOPE_PAD);
  });

  it("uses one column on a phone and as many columns as the canvas shows at the readable zoom", () => {
    const nodes = [tile("frame", { role: "scope" }), ...Array.from({ length: 30 }, (_, i) => tile(`c-${i}`, { description: "A purpose of moderate length for the tile." }))];
    const phone = layoutAtlas(graph(nodes, "frame"), { maxColumns: columnsForCanvas(358) });
    expect(new Set(Object.entries(phone.boxes).filter(([id]) => id !== "frame").map(([, b]) => b.x)).size).toBe(1);
    const laptop = layoutAtlas(graph(nodes, "frame"), { maxColumns: columnsForCanvas(1120) });
    expect(new Set(Object.entries(laptop.boxes).filter(([id]) => id !== "frame").map(([, b]) => b.x)).size).toBe(4);
    expect(laptop.boxes.frame!.width * 0.85).toBeLessThanOrEqual(1120 - 80);
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
    expect(system).toMatchObject({ x: TILE.width + 32, y: 0, width: TILE.systemWidth });
    expect(l.boxes["ext.a"]).toMatchObject({ x: 0, y: 0, width: TILE.width });
    expect(l.boxes["ext.b"]).toMatchObject({ x: TILE.width + 32 + TILE.systemWidth + 32, y: 0, width: TILE.width });
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
    expect(l.boxes["ext.actor"]).toMatchObject({ x: 0, y: 0, width: TILE.width });
    expect(l.boxes["context.other"]).toMatchObject({ x: l.boxes.scope!.x + l.boxes.scope!.width + 72, y: 0, width: TILE.width });
    expect(l.boxes.scope!.x).toBe(TILE.width + 32);
    expect(l.boxes["context.second"]!.y).toBeGreaterThanOrEqual(l.boxes["context.other"]!.height);
    const independent = Object.entries(l.boxes).filter(([id]) => id !== "child").map(([, box]) => box);
    for (let i = 0; i < independent.length; i++) for (let j = i + 1; j < independent.length; j++) expect(overlap(independent[i]!, independent[j]!)).toBe(false);
    for (const id of ["ext.actor", "context.other", "context.second"]) {
      expect(l.boxes[id]!.height).toBeGreaterThanOrEqual(TILE.tab + TILE.titleLine);
      expect(l.boxes[id]!.y + l.boxes[id]!.height).toBeLessThanOrEqual(l.height);
    }
  });

  it("handles an empty graph and a leaf scope with finite positive bounds", () => {
    expect(layoutAtlas(graph([]))).toEqual({ boxes: {}, metrics: {}, width: 0, height: 0 });
    const g = graph([tile("leaf", { role: "scope" })], "leaf");
    const l = layoutAtlas(g);
    // No externals: the frame starts at the left edge instead of leaving an empty perimeter column.
    expect(l.boxes.leaf).toMatchObject({ x: 0, y: 0 });
    expect(l.width).toBeGreaterThanOrEqual(TILE.width);
    expect(l.height).toBeGreaterThanOrEqual(SCOPE_HEADER);
  });
});
