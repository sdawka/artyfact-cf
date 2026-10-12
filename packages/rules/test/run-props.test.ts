import { describe, expect, it } from "vitest";
import { factSet, parse, run, type Tuple } from "../src/index";
import { TREE_RULES } from "./fixtures";

const tree = parse(TREE_RULES, "tree.dl");
const chain = (n: number): Tuple[] => Array.from({ length: n }, (_, i) => [`n${i + 1}`, `n${i}`]);

describe("incomplete", () => {
  it("stops at maxIterations without throwing", () => {
    const r = run(factSet({ parent: chain(20) }), [tree], { maxIterations: 2 });
    expect(r.incomplete).toBe(true);
    expect(r.stats.iterations).toBeLessThanOrEqual(2);
    expect(r.relations.get("ancestor")!.length).toBeGreaterThan(0);
  });

  it("is complete with enough iterations", () => {
    const r = run(factSet({ parent: chain(20) }), [tree]);
    expect(r.incomplete).toBe(false);
    expect(r.relations.get("ancestor")).toHaveLength((20 * 21) / 2);
  });
});

describe("determinism", () => {
  it("factSet hash is stable across key order, tuple order and duplicates", () => {
    const a = factSet({ parent: [["b", "a"], ["c", "a"]], node: [["a", "x", "t"], ["b", "x", "t"]] });
    const b = factSet(
      new Map<string, Tuple[]>([
        ["node", [["b", "x", "t"], ["a", "x", "t"], ["a", "x", "t"]]],
        ["parent", [["c", "a"], ["b", "a"]]],
        ["empty", []],
      ]),
    );
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);
    expect(b.relations.get("node")).toEqual([["a", "x", "t"], ["b", "x", "t"]]);
    expect(factSet({ v: [[1]] }).hash).not.toBe(factSet({ v: [["1"]] }).hash);
  });

  it("run output is identical across runs", () => {
    const facts = factSet({ parent: [["x", "y"], ["y", "z"], ["z", "x"], ["m", "p1"], ["m", "p2"]] });
    const dump = () => {
      const r = run(facts, [tree], { all: true });
      return JSON.stringify([[...r.relations], [...r.derivations]]);
    };
    expect(dump()).toBe(dump());
  });
});

describe("performance smoke", () => {
  it("closes 2,000 nodes / 2,000 parent edges in under 500 ms", () => {
    const parent: Tuple[] = [];
    for (let i = 1; i < 2000; i++) parent.push([`n${i}`, `n${Math.floor((i - 1) / 2)}`]);
    parent.push(["n1999", "n5"]);
    const node: Tuple[] = Array.from({ length: 2000 }, (_, i) => [`n${i}`, "component", "t"]);
    const facts = factSet({ node, parent });
    const t0 = Date.now();
    const r = run(facts, [tree]);
    const ms = Date.now() - t0;
    expect(r.incomplete).toBe(false);
    // sum of heap depths for n1..n1999, plus n5 reached via the extra edge
    expect(r.relations.get("ancestor")).toHaveLength(17_965);
    expect(r.relations.get("violation")).toEqual([["tree.multiParent", "n1999", "hard"]]);
    expect(ms).toBeLessThan(500);
  });
});
