# @artyfact/rules

A small Datalog engine for checking a fact set (the compiled ontology graph) against versioned Rule Packs written in `.dl` files. It is pure TypeScript ESM with zero runtime dependencies, and runs the same in Node, Cloudflare Workers and the browser. The API is fully synchronous; `factSet()` hashes with a bundled SHA-256.

The design is Appendix D of the plan (`docs/design/rules.md`). This engine replaces a possible Ascent/WASM build for now: the semantics are the same, and the `.dl` packs can be ported later.

## `.dl` grammar

```
program   := (decl | output | message | clause)*
decl      := ".decl" rel "(" [col ("," col)*] ")" [".output"]      % .output on the same line
col       := Name ":" ("sym" | "num" | "bool")
output    := ".output" rel
message   := ".message" STRING STRING                              % rule id, template
clause    := atom [":-" literal ("," literal)*] "."
literal   := atom | "not" atom
           | term cmp term                                         % = != < <= > >=
           | Var "=" "count" ":" atom
atom      := rel "(" [term ("," term)*] ")"                         % contains/2, matches/2 are built-ins
term      := Var | "_" | STRING | NUMBER | "true" | "false"
rel       := [a-z][A-Za-z0-9_]*        Var := [A-Z_][A-Za-z0-9_]*  % "_" alone is the wildcard
comment   := "%" to end of line
```

Semantics and checks:
- **Safety is checked left to right.** Every variable in a negation, built-in, comparison or head must already be bound by an earlier positive atom, an `X = term` binding, or a `count` result.
- `N = count : rel(...)` counts the tuples of `rel` that match, given the variables bound so far. Its other variables are local to the aggregate. If `N` is already bound, the literal tests equality instead.
- Negation and `count` must refer to a lower stratum. `parse()` checks this within one program, and `stratify()` checks it across programs. Either throws `StratificationError` with `cycle: string[]`.
- Parse errors are thrown as `RuleParseError { file, line, column, message }`. Causes include unknown or undeclared relations, arity mismatches, unsafe variables, constants of the wrong type, and syntax errors.
- A relation may be declared in several programs if the column types agree. `.output` in any program marks the relation as output.
- `render(messages, tuple)` looks up `tuple[0]` (the rule id) and replaces `{n}` with `tuple[n]`. So `{1}` is the first argument after the rule id, usually the subject.

Evaluation proceeds stratum by stratum. Within each stratum it is semi-naive and bottom-up, using a first-argument hash index for each relation and JSON-keyed tuple sets. Every derived tuple records its first derivation, as `{rule: "<program>:<line>", head, body}`. When a different rule derives the same tuple again, that derivation is added too, up to 8 per tuple. If the run hits `maxIterations` (default 10,000 semi-naive rounds in total), it stops with `incomplete: true` and leaves later strata unevaluated. Callers should treat an incomplete result as unknown.

## Usage

```ts
import { explain, factSet, parse, render, run } from "@artyfact/rules";

const pack = parse(`
.decl parent(Child: sym, Parent: sym)
.decl ancestor(X: sym, Y: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.message "tree.cycle" "{1} is its own ancestor."
ancestor(X,Z) :- parent(X,Z).
ancestor(X,Z) :- parent(X,Y), ancestor(Y,Z).
violation("tree.cycle",X,"hard") :- ancestor(X,X).
`, "metamodel@1");

const facts = factSet({ parent: [["a", "b"], ["b", "a"]] });   // facts.hash: sha256 snapshot
const result = run(facts, [pack], { maxIterations: 10_000 });

for (const v of result.relations.get("violation") ?? []) {
  console.log(render(result.messages, v));                    // "a is its own ancestor."
  console.log(explain(result, "violation", v));               // derivation tree, leaves = input facts
}
```
