import { describe, expect, it } from "vitest";
import { buildTree, filterTree, type TreeNode } from "./tree";

const e = (path: string) => ({ path, hash: path });
const names = (nodes: TreeNode[]): unknown[] => nodes.map((n) => (n.type === "dir" ? { [n.name]: names(n.children) } : n.name));

describe("buildTree", () => {
  it("nests by directory, dirs first, sorted", () => {
    const tree = buildTree([e("system.yaml"), e("things/webapp/thing.yaml"), e("criteria.yaml"), e("things/webapp/spec.yaml"), e("journeys/J.a.yaml")]);
    expect(names(tree)).toEqual([{ journeys: ["J.a.yaml"] }, { things: [{ webapp: ["spec.yaml", "thing.yaml"] }] }, "criteria.yaml", "system.yaml"]);
    const things = tree[1]!;
    expect(things.type === "dir" && things.children[0]!.path).toBe("things/webapp");
  });

  it("is empty for no entries", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("filterTree", () => {
  it("keeps matching files and their ancestors", () => {
    const tree = buildTree([e("system.yaml"), e("things/webapp/spec.yaml"), e("journeys/J.a.yaml")]);
    expect(names(filterTree(tree, "SPEC"))).toEqual([{ things: [{ webapp: ["spec.yaml"] }] }]);
    expect(filterTree(tree, " ")).toHaveLength(3);
    expect(filterTree(tree, "nope")).toEqual([]);
  });
});
