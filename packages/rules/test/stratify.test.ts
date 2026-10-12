import { describe, expect, it } from "vitest";
import { parse, stratify, StratificationError } from "../src/index";
import { TREE_RULES } from "./fixtures";

describe("stratify", () => {
  it("accepts positive recursion and orders dependencies first", () => {
    const strata = stratify([parse(TREE_RULES, "tree.dl")]);
    const order = strata.flatMap((s) => s.relations);
    expect(order.indexOf("ancestor")).toBeLessThan(order.indexOf("violation"));
    const anc = strata.find((s) => s.relations.includes("ancestor"))!;
    expect(anc.rules).toHaveLength(2);
  });

  it("rejects negation through a cycle across programs, naming the cycle", () => {
    const a = parse(`.decl p(X: sym)\n.decl q(X: sym)\n.decl e(X: sym)\np(X) :- e(X), not q(X).\n`, "a.dl");
    const b = parse(`.decl p(X: sym)\n.decl q(X: sym)\n.decl e(X: sym)\nq(X) :- e(X), p(X).\n`, "b.dl");
    expect(() => stratify([a])).not.toThrow();
    try {
      stratify([a, b]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(StratificationError);
      const err = e as StratificationError;
      expect(err.cycle).toEqual(["p", "q", "p"]);
      expect(err.message).toMatch(/p -> q -> p/);
    }
  });

  it("parse rejects a self-contained negative cycle", () => {
    expect(() => parse(`.decl p(X: sym)\n.decl e(X: sym)\np(X) :- e(X), not p(X).\n`, "c.dl")).toThrow(StratificationError);
  });

  it("rejects count over its own stratum", () => {
    expect(() =>
      parse(`.decl n(X: sym, N: num)\n.decl e(X: sym)\nn(X,N) :- e(X), N = count : n(X,_).\n`, "d.dl"),
    ).toThrow(StratificationError);
  });

  it("rejects conflicting declarations across programs", () => {
    const a = parse(`.decl e(X: sym)\n`, "a.dl");
    const b = parse(`.decl e(X: sym, Y: sym)\n`, "b.dl");
    expect(() => stratify([a, b])).toThrow(/e/);
  });
});
