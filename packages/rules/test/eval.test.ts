import { describe, expect, it } from "vitest";
import { factSet, parse, render, run, RuleParseError, type Tuple } from "../src/index";
import { AUTHZ, TREE_RULES } from "./fixtures";

const tree = parse(TREE_RULES, "tree.dl");
const sorted = (ts: Tuple[]) => [...ts].map((t) => JSON.stringify(t)).sort();

describe("ancestor closure and tree checks", () => {
  it("computes the closure of a 6-node tree", () => {
    const facts = factSet({
      parent: [["b", "a"], ["c", "a"], ["d", "b"], ["e", "b"], ["f", "d"]],
    });
    const r = run(facts, [tree]);
    expect(r.incomplete).toBe(false);
    expect(sorted(r.relations.get("ancestor")!)).toEqual(
      sorted([
        ["b", "a"], ["c", "a"], ["d", "b"], ["d", "a"], ["e", "b"], ["e", "a"],
        ["f", "d"], ["f", "b"], ["f", "a"],
      ]),
    );
    expect(r.relations.get("violation")).toEqual([]);
  });

  it("detects tree.cycle and tree.multiParent", () => {
    const facts = factSet({
      parent: [["x", "y"], ["y", "z"], ["z", "x"], ["m", "p1"], ["m", "p2"]],
    });
    const r = run(facts, [tree]);
    expect(sorted(r.relations.get("violation")!)).toEqual(
      sorted([
        ["tree.cycle", "x", "hard"], ["tree.cycle", "y", "hard"], ["tree.cycle", "z", "hard"],
        ["tree.multiParent", "m", "hard"],
      ]),
    );
  });

  it("returns only .output relations unless all=true", () => {
    const facts = factSet({ parent: [["b", "a"]] });
    expect([...run(facts, [tree]).relations.keys()]).toEqual(["ancestor", "violation"]);
    expect([...run(facts, [tree], { all: true }).relations.keys()]).toEqual(["ancestor", "node", "parent", "violation"]);
  });

  it("rejects facts with the wrong arity", () => {
    expect(() => run(factSet({ parent: [["a"]] }), [tree])).toThrow(/arity/);
  });
});

describe("negation: authz.ungoverned", () => {
  const facts = factSet({
    node: [
      ["screen.people", "screen", "thing.webapp"],
      ["dialog.add", "component", "thing.webapp"],
      ["affordance.save", "affordance", "thing.webapp"],
      ["svc.invites", "component", "thing.webapp"],
      ["operation.contact.save", "operation", "thing.webapp"],
      ["operation.invite.accept", "operation", "thing.webapp"],
      ["operation.direct", "operation", "thing.webapp"],
      ["operation.orphan", "operation", "thing.webapp"],
      ["operation.read", "operation", "thing.webapp"],
    ],
    parent: [
      ["dialog.add", "screen.people"],
      ["affordance.save", "dialog.add"],
      ["operation.invite.accept", "svc.invites"],
    ],
    link: [
      ["policy.ownerOnly", "governs", "dialog.add", "declared"],
      ["affordance.save", "invokes", "operation.contact.save", "declared"],
      ["operation.contact.save", "writes", "entity.ContactRecord", "declared"],
      ["policy.pairConsent", "governs", "svc.invites", "declared"],
      ["operation.invite.accept", "writes", "entity.Connection", "declared"],
      ["operation.direct", "governs", "policy.x", "declared"],
      ["operation.direct", "writes", "entity.X", "declared"],
      ["operation.orphan", "writes", "entity.Y", "declared"],
      ["operation.read", "reads", "entity.Y", "declared"],
    ],
  });
  const authz = parse(AUTHZ, "authorization@1");

  it("flags only the ungoverned mutating operation", () => {
    const r = run(facts, [authz]);
    expect(r.relations.get("violation")).toEqual([["authz.ungoverned", "operation.orphan", "hard"]]);
  });

  it("inherits governedBy via ancestor and via invokes", () => {
    const g = sorted(run(facts, [authz]).relations.get("governedBy")!);
    expect(g).toContain(JSON.stringify(["operation.contact.save", "policy.ownerOnly"]));
    expect(g).toContain(JSON.stringify(["affordance.save", "policy.ownerOnly"]));
    expect(g).toContain(JSON.stringify(["operation.invite.accept", "policy.pairConsent"]));
    expect(g).toContain(JSON.stringify(["operation.direct", "policy.x"]));
  });

  it("renders messages with {n} = nth argument after the rule id", () => {
    const r = run(facts, [authz]);
    const v = r.relations.get("violation")![0];
    expect(render(r.messages, v)).toBe(
      "Operation operation.orphan writes data but no authorization policy governs it.",
    );
    expect(render(new Map(), ["x.rule", "s1", "hard"])).toBe("x.rule: s1, hard");
  });
});

describe("count and built-ins", () => {
  it("counts matching tuples per bound group, including zero", () => {
    const p = parse(
      `.decl node(Id: sym)\n.decl parent(C: sym, P: sym)\n.decl childCount(X: sym, N: num) .output
childCount(X,N) :- node(X), N = count : parent(_,X).\n`,
      "c.dl",
    );
    const r = run(factSet({ node: [["a"], ["b"], ["c"]], parent: [["b", "a"], ["c", "a"]] }), [p]);
    expect(sorted(r.relations.get("childCount")!)).toEqual(sorted([["a", 2], ["b", 0], ["c", 0]]));
  });

  it("filters with a count comparison", () => {
    const p = parse(
      `.decl conn(C: sym, A: sym)\n.decl c(C: sym)\n.decl bad(C: sym) .output
bad(C) :- c(C), N = count : conn(C,_), N != 2.\n`,
      "card.dl",
    );
    const r = run(factSet({ c: [["c1"], ["c2"]], conn: [["c1", "a"], ["c1", "b"], ["c2", "a"]] }), [p]);
    expect(r.relations.get("bad")).toEqual([["c2"]]);
  });

  it("supports contains, matches, != and comparisons", () => {
    const p = parse(
      `.decl effectText(Id: sym, T: sym)\n.decl fieldType(Id: sym, F: sym, Ty: sym)\n.decl w(Id: sym, N: num)
.decl cand(Id: sym, T: sym) .output\n.decl arr(Id: sym) .output\n.decl heavy(Id: sym) .output\n.decl plain(Id: sym) .output
cand(N,T) :- effectText(N,T), contains(T,"recipient"), N != "skip".
arr(N) :- fieldType(N,_,Ty), matches(Ty,"^list<ref:entity\\\\.Account").
heavy(I) :- w(I,N), N >= 3, N < 10.
plain(N) :- effectText(N,T), not contains(T,"recipient").\n`,
      "b.dl",
    );
    const r = run(
      factSet({
        effectText: [["op.a", "notify recipient"], ["skip", "recipient"], ["op.b", "nothing"]],
        fieldType: [["e.Msg", "to", "list<ref:entity.Account>"], ["e.Other", "to", "list<ref:entityXAccount>"]],
        w: [["a", 2], ["b", 3], ["c", 10]],
      }),
      [p],
    );
    expect(r.relations.get("cand")).toEqual([["op.a", "notify recipient"]]);
    expect(r.relations.get("arr")).toEqual([["e.Msg"]]);
    expect(r.relations.get("heavy")).toEqual([["b"]]);
    expect(r.relations.get("plain")).toEqual([["op.b"]]);
  });

  it("matches bool constants", () => {
    const p = parse(
      `.decl requirement(Id: sym, T: sym, On: bool)\n.decl on(Id: sym) .output\non(R) :- requirement(R,_,true).\n`,
      "bool.dl",
    );
    const r = run(factSet({ requirement: [["r1", "t", true], ["r2", "t", false]] }), [p]);
    expect(r.relations.get("on")).toEqual([["r1"]]);
  });

  it("combines several programs", () => {
    const a = parse(`.decl e(X: sym)\n.decl p(X: sym)\np(X) :- e(X).\n`, "a.dl");
    const b = parse(`.decl p(X: sym)\n.decl e(X: sym)\n.decl q(X: sym) .output\nq(X) :- e(X), not p(X).\n`, "b.dl");
    const c = parse(`.decl e(X: sym)\n.decl e2(X: sym)\n.decl p(X: sym)\np(X) :- e2(X).\n`, "c.dl");
    const r = run(factSet({ e: [["1"], ["2"]], e2: [["2"]] }), [b, c]);
    expect(r.relations.get("q")).toEqual([["1"]]);
    expect(run(factSet({ e: [["1"]] }), [a, b]).relations.get("q")).toEqual([]);
  });
});

describe("evaluation edge cases", () => {
  it("handles rules with two recursive literals (non-linear recursion)", () => {
    const p = parse(
      `.decl e(X: sym, Y: sym)\n.decl tc(X: sym, Y: sym) .output\ntc(X,Y) :- e(X,Y).\ntc(X,Z) :- tc(X,Y), tc(Y,Z).\n`,
      "nl.dl",
    );
    const e: Tuple[] = Array.from({ length: 12 }, (_, i) => [`n${i}`, `n${i + 1}`]);
    expect(run(factSet({ e }), [p]).relations.get("tc")).toHaveLength((12 * 13) / 2);
  });

  it("binds a variable with = and checks a bound count result", () => {
    const p = parse(
      `.decl e(X: sym, Y: sym)\n.decl k(X: sym, N: num)\n.decl tag(X: sym, T: sym) .output\n.decl exact(X: sym) .output
tag(X,T) :- e(X,_), T = "seen".
exact(X) :- k(X,N), N = count : e(X,_).\n`,
      "eq.dl",
    );
    const r = run(factSet({ e: [["a", "1"], ["a", "2"], ["b", "1"]], k: [["a", 2], ["b", 2]] }), [p]);
    expect(r.relations.get("tag")).toEqual([["a", "seen"], ["b", "seen"]]);
    expect(r.relations.get("exact")).toEqual([["a"]]);
  });

  it("joins on repeated variables within one atom", () => {
    const p = parse(`.decl e(X: sym, Y: sym)\n.decl self(X: sym) .output\nself(X) :- e(X,X).\n`, "rep.dl");
    expect(run(factSet({ e: [["a", "a"], ["a", "b"]] }), [p]).relations.get("self")).toEqual([["a"]]);
  });
});

describe("contract rulings", () => {
  it("render: {n} is the nth argument after the rule id", () => {
    const m = new Map([["r", "{0} on {1} is {2}; {9} stays"]]);
    expect(render(m, ["r", "subj", "hard"])).toBe("r on subj is hard; {9} stays");
  });

  it("accepts identical redeclarations; .output in any program marks the relation as output", () => {
    const a = parse(`.decl e(X: sym)\n.decl p(X: sym) .output\np(X) :- e(X).\n`, "a.dl");
    const b = parse(`.decl e(X: sym)\n.decl p(X: sym)\n.decl q(X: sym)\nq(X) :- p(X).\n`, "b.dl");
    const r = run(factSet({ e: [["1"]] }), [b, a]);
    expect([...r.relations.keys()]).toEqual(["p"]);
    expect(r.relations.get("p")).toEqual([["1"]]);
  });

  it("rejects conflicting redeclarations at run()", () => {
    const a = parse(`.decl e(X: sym)\n`, "a.dl");
    const b = parse(`.decl e(X: num)\n`, "b.dl");
    expect(() => run(factSet({}), [a, b])).toThrow(RuleParseError);
  });
});
