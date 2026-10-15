import { describe, expect, it } from "vitest";
import { kindViews } from "@/model/kinds";
import { clampPurpose, insideSummary, restates, TILE, tileMetrics, wrapLines } from "./atlasTile";
import type { MapNode } from "./useMapGraph";

const node = (extra: Partial<MapNode> = {}): MapNode => ({ id: "n", name: "Name", kind: "component", role: "child", childCount: 0, description: "", inside: [], ...extra });

describe("atlas tile metrics", () => {
  it("wraps words greedily and breaks a word longer than a line", () => {
    expect(wrapLines("", 10)).toBe(0);
    expect(wrapLines("one two three", 20)).toBe(1);
    expect(wrapLines("one two three", 8)).toBe(2);
    expect(wrapLines("abcdefghijklmnopqrstuvwxyz", 10)).toBe(3);
  });

  it("cuts a long purpose after the last whole sentence that fits, never inside a word", () => {
    const text = "First sentence explains the job. Second sentence adds detail about the boundary. Third sentence keeps going far beyond the budget of the tile and more.";
    const cut = clampPurpose(text, 34);
    expect(cut.faded).toBe(false);
    expect(cut.lines).toBeLessThanOrEqual(3);
    expect(text.startsWith(cut.text)).toBe(true);
    expect(cut.text.endsWith(".")).toBe(true);
    expect(cut.text).not.toMatch(/…|\.\.\.$/);
  });

  it("fades a long purpose with no sentence to cut at, keeping the full text", () => {
    const text = "a run-on purpose without any sentence boundary that keeps going well past three lines of a narrow tile";
    expect(clampPurpose(text, 20)).toEqual({ text, lines: 3, faded: true });
  });

  it("does not repeat a name the purpose only restates", () => {
    expect(restates("Tokens are never printed", "Tokens are never printed, logged or sent.")).toBe(true);
    expect(restates("Contacts", "The contact record.")).toBe(false);
    const m = tileMetrics(node({ name: "Only pass is green", description: "Only pass is green." }), kindViews(undefined));
    expect(m.purpose.text).toBe("");
  });

  it("summarises what is inside as counts by kind, three kinds at most", () => {
    const base = kindViews(undefined);
    const views = { ...base, of: (kind: string) => kind === "api" ? { ...base.of(kind), label: "API", plural: "APIs" } : base.of(kind) };
    const s = insideSummary(node({ inside: [{ kind: "endpoint", count: 3 }, { kind: "module", count: 1 }, { kind: "api", count: 2 }, { kind: "policy", count: 4 }] }), views);
    expect(s.items.map((i) => i.text)).toEqual(["3 endpoints", "1 module", "2 APIs"]);
    expect(s.more).toBe(4);
  });

  it("grows with content and reserves the layer lane on every in-System tile", () => {
    const views = kindViews(undefined);
    const bare = tileMetrics(node(), views).height;
    const described = tileMetrics(node({ description: "A purpose of a few words." }), views).height;
    const container = tileMetrics(node({ childCount: 2, inside: [{ kind: "module", count: 2 }] }), views).height;
    expect(described).toBe(bare + 6 + TILE.purposeLine);
    expect(container).toBeGreaterThan(bare + TILE.button);
    expect(tileMetrics(node({ role: "external" }), views).height).toBe(bare - 4 - TILE.lane);
  });
});
