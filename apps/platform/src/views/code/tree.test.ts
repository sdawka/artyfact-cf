import { describe, expect, it } from "vitest";
import { buildTree, compactTree, filterTree, type TreeNode } from "./tree";

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

describe("compactTree", () => {
  it("folds single-child directories into one row", () => {
    const tree = buildTree([e("commitment.x/node.yaml"), e("a/b/c.yaml"), e("a/b/d.yaml"), e("a/z/q/r.yaml"), e("system.yaml")]);
    const compact = compactTree(tree);
    expect(names(compact)).toEqual([{ "a": [{ "b": ["c.yaml", "d.yaml"] }, "z/q/r.yaml"] }, "commitment.x/node.yaml", "system.yaml"]);
    const file = compact[1]!;
    expect(file.type === "file" && file.path).toBe("commitment.x/node.yaml");
  });

  it("merges a chain of single directories and keeps the deepest path", () => {
    const [only] = compactTree(buildTree([e("a/b/c/x.yaml"), e("a/b/c/y.yaml")]));
    expect(only!.name).toBe("a/b/c");
    expect(only!.path).toBe("a/b/c");
  });
});
