import { describe, expect, it } from "vitest";
import { explain, factSet, parse, run, type DerivationTree } from "../src/index";
import { TREE_RULES } from "./fixtures";

function leaves(t: DerivationTree): DerivationTree[] {
  return t.children.length === 0 ? [t] : t.children.flatMap(leaves);
}

describe("derivations", () => {
  const tree = parse(TREE_RULES, "tree.dl");
  const r = run(factSet({ parent: [["x", "y"], ["y", "z"], ["z", "x"]] }), [tree]);

  it("records rule id, head and body tuples", () => {
    const ds = r.derivations.get("violation\u0000" + JSON.stringify(["tree.cycle", "x", "hard"]))!;
    expect(ds[0]).toEqual({
      rule: "tree.dl:9",
      head: ["tree.cycle", "x", "hard"],
      body: [{ relation: "ancestor", tuple: ["x", "x"] }],
    });
  });

  it("explain() builds a tree whose leaves are EDB facts", () => {
    const t = explain(r, "violation", ["tree.cycle", "x", "hard"]);
    expect(t.rule).toBe("tree.dl:9");
    expect(t.edb).toBe(false);
    const ls = leaves(t);
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) {
      expect(l.edb).toBe(true);
      expect(l.relation).toBe("parent");
    }
  });

  it("explain() truncates at depth", () => {
    const t = explain(r, "violation", ["tree.cycle", "x", "hard"], 1);
    expect(t.children[0].truncated).toBe(true);
    expect(t.children[0].children).toEqual([]);
  });

  it("explain() is cycle-safe for facts that are also derivable", () => {
    const p = parse(`.decl a(X: sym)\n.decl b(X: sym)\na(X) :- b(X).\nb(X) :- a(X).\n`, "loop.dl");
    const rr = run(factSet({ a: [["1"]] }), [p], { all: true });
    const t = explain(rr, "b", ["1"]);
    expect(t.children[0]).toMatchObject({ relation: "a", tuple: ["1"], edb: true });
  });

  it("appends derivations from a second rule", () => {
    const p = parse(`.decl a(X: sym)\n.decl b(X: sym)\n.decl reach(X: sym) .output\nreach(X) :- a(X).\nreach(X) :- b(X).\n`, "m.dl");
    const rr = run(factSet({ a: [["1"]], b: [["1"]] }), [p]);
    const ds = rr.derivations.get("reach\u0000" + JSON.stringify(["1"]))!;
    expect(ds.map((d) => d.rule)).toEqual(["m.dl:4", "m.dl:5"]);
    expect(explain(rr, "reach", ["1"]).alternatives).toBe(2);
  });

  it("explain() on an unknown tuple returns a leaf", () => {
    expect(explain(r, "violation", ["nope"])).toMatchObject({ edb: true, children: [] });
  });
});
