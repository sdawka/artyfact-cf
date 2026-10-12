import { describe, expect, it } from "vitest";
import { explain, factSet, parse, render, run } from "../src/index";

describe("README usage example", () => {
  it("runs as documented", () => {
    const pack = parse(`
.decl parent(Child: sym, Parent: sym)
.decl ancestor(X: sym, Y: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.message "tree.cycle" "{1} is its own ancestor."
ancestor(X,Z) :- parent(X,Z).
ancestor(X,Z) :- parent(X,Y), ancestor(Y,Z).
violation("tree.cycle",X,"hard") :- ancestor(X,X).
`, "metamodel@1");
    const result = run(factSet({ parent: [["a", "b"], ["b", "a"]] }), [pack]);
    const vs = result.relations.get("violation")!;
    expect(vs.map((v) => render(result.messages, v))).toEqual(["a is its own ancestor.", "b is its own ancestor."]);
    expect(explain(result, "violation", vs[0]).rule).toBe("metamodel@1:8");
  });
});
