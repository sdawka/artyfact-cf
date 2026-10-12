import { describe, expect, it } from "vitest";
import { parse, RuleParseError } from "../src/index";

function parseError(src: string): RuleParseError {
  try {
    parse(src, "bad.dl");
  } catch (e) {
    expect(e).toBeInstanceOf(RuleParseError);
    return e as RuleParseError;
  }
  throw new Error("expected parse to throw");
}

describe("parse", () => {
  it("parses declarations, rules, negation, count, built-ins, .output and .message", () => {
    const p = parse(
      `% comment
.decl node(Id: sym, Kind: sym, Thing: sym)
.decl parent(Child: sym, Parent: sym)
.decl effectText(Id: sym, Text: sym)
.decl flag(Id: sym, On: bool, Weight: num)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl n(X: sym, N: num) .output
.decl ok(T: sym)
.message "authz.ungoverned" "Operation {1} writes data but no authorization policy governs it."
violation("x",X,"hard") :- node(X,_,_), not parent(X,_).
n(X,N) :- node(X,_,_), N = count : parent(_,X).
ok(T) :- effectText(_,T), contains(T,"recipient"), matches(T,"^re"), T != "x".
ok(I) :- flag(I,true,W), W >= 2.5, W < 10.
`,
      "pack.dl",
    );
    expect(p.name).toBe("pack.dl");
    expect([...p.decls.keys()]).toEqual(["node", "parent", "effectText", "flag", "violation", "n", "ok"]);
    expect(p.decls.get("node")!.arity).toBe(3);
    expect(p.decls.get("flag")!.columns.map((c) => c.type)).toEqual(["sym", "bool", "num"]);
    expect(p.decls.get("violation")!.output).toBe(true);
    expect(p.decls.get("ok")!.output).toBe(false);
    expect(p.messages.get("authz.ungoverned")).toMatch(/^Operation \{1\} writes/);
    expect(p.rules).toHaveLength(4);
    expect(p.rules.map((r) => r.id)).toEqual(["pack.dl:10", "pack.dl:11", "pack.dl:12", "pack.dl:13"]);
    expect(p.rules[0].body.map((l) => l.kind)).toEqual(["atom", "atom"]);
    expect(p.rules[1].body[1].kind).toBe("count");
    expect(p.rules[2].body.map((l) => l.kind)).toEqual(["atom", "builtin", "builtin", "cmp"]);
  });

  it("accepts standalone .output and ground facts", () => {
    const p = parse(`.decl a(X: sym)\n.output a\na("k").\n`, "f.dl");
    expect(p.decls.get("a")!.output).toBe(true);
    expect(p.rules[0].body).toHaveLength(0);
  });

  it("rejects an unknown relation in a body", () => {
    const e = parseError(`.decl a(X: sym)\n\na(X) :- b(X).\n`);
    expect(e.message).toMatch(/unknown relation 'b'/);
    expect(e.line).toBe(3);
    expect(e.column).toBe(9);
    expect(e.file).toBe("bad.dl");
  });

  it("rejects an arity mismatch", () => {
    const e = parseError(`.decl a(X: sym)\n.decl b(X: sym, Y: sym)\na(X) :-\n  b(X).\n`);
    expect(e.message).toMatch(/arity/);
    expect(e.line).toBe(4);
  });

  it("rejects an unsafe head variable", () => {
    const e = parseError(`.decl a(X: sym, Y: sym)\n.decl b(X: sym)\n\n\na(X,Y) :- b(X).\n`);
    expect(e.message).toMatch(/unsafe variable 'Y'/);
    expect(e.line).toBe(5);
  });

  it("rejects an unsafe negated variable", () => {
    const e = parseError(`.decl a(X: sym)\n.decl b(X: sym)\n.decl c(X: sym, Y: sym)\na(X) :- b(X), not c(X,Y).\n`);
    expect(e.message).toMatch(/unsafe variable 'Y'/);
    expect(e.line).toBe(4);
  });

  it("rejects an unsafe built-in variable", () => {
    const e = parseError(`.decl a(X: sym)\n.decl b(X: sym)\na(X) :- b(X), contains(T,"x").\n`);
    expect(e.message).toMatch(/unsafe variable 'T'/);
    expect(e.line).toBe(3);
  });

  it("rejects an undeclared head relation", () => {
    const e = parseError(`.decl b(X: sym)\nzz(X) :- b(X).\n`);
    expect(e.message).toMatch(/undeclared relation 'zz'/);
    expect(e.line).toBe(2);
  });

  it("rejects constants of the wrong type", () => {
    const e = parseError(`.decl a(X: num)\na("one").\n`);
    expect(e.message).toMatch(/type/);
    expect(e.line).toBe(2);
  });

  it("rejects syntax errors with position", () => {
    const e = parseError(`.decl a(X: sym)\na(X) :- a(X)\n`);
    expect(e.line).toBe(3);
    expect(e.message).toMatch(/expected/);
  });
});
