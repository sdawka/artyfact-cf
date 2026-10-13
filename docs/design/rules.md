# Appendix D — Rules engine and Rule Packs (packages/rules, packages/templates/rule-packs)

## D.1 `.dl` syntax (subset, deliberately small)
```
% comment
.decl node(Id: sym, Kind: sym, Thing: sym)          % EDB and IDB declarations; types sym|num|bool
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.message "authz.ungoverned" "Operation {1} writes data but no authorization policy governs it (directly, via its affordances, or inherited)."
head(A,B) :- body1(A,_), not body2(B), A != B, contains(T,"x"), matches(T,"^re$"), N = count : body3(A,_).
```
Rules: Horn clauses; variables capitalised; `_` wildcard; constants quoted; negation only over safe, lower-stratum relations; `count :` aggregate binds a num. Parser rejects unsafe variables, unknown relations, arity mismatches, unstratifiable negation.

## D.2 Engine API
```ts
parse(src: string, name: string): Program                     // throws RuleParseError{line, message}
stratify(programs: Program[]): Stratum[]
run(facts: FactSet, programs: Program[], opts?: {maxIterations=10_000}): {
  relations: Map<string, Tuple[]>, derivations: Map<tupleKey, {rule: string, body: Tuple[]}[]>, incomplete: boolean, stats }
FactSet = { relations: Map<string, Tuple[]>, hash: string }    // tuples sorted, hash = sha256(canonical)
explain(result, tuple): DerivationTree                          // for the UI
```
Implementation: indexed joins (first-arg hash index built per relation per stratum), semi-naive delta sets, tuple interning for equality, deterministic iteration order. ~500–700 lines TS, zero deps.

## D.3 Packs (initial inventory, each with valid/invalid mini-model tests)
| pack | rules (ids) |
|---|---|
| metamodel@1 | ref.dangling, ref.parentMissing, tree.cycle, tree.multiParent, owner.unknown, criterion.subjectMissing, criterion.ownerMissing, thing.sectionMissing (a Thing may bind no artifact: Genome-only) |
| readiness@1 | coverage.requirement, coverage.hook, hook.unbound, template.sectionMissing, template.criterionMissing, template.unknown, kit.unpinned, evolution.acceptanceMissing, evolution.affectsMissing |
| authorization@1 | ancestor, governedBy (containment + invokes + interface inheritance), mutating, authz.ungoverned, authz.policyConflict, authz.privateReadUngoverned (reads of owner-only entities) |
| theory@1 | purpose.beneficiary, purpose.beneficiaryKind, theory.indicator, theory.method, theory.beneficiary, theory.outcomeUnlinked (claim not referenced by any criterion/requirement) |
| journeys@1 | journey.startMissing, journey.nextDangling, journey.noEnd, journey.screenUncovered, journey.stepRefMissing, journey.operationUncovered |
| topology.private-pairs@1 | topology.recipientArray, topology.groupEnabled, topology.pairCardinality (Connection must declare exactly two account refs), semanticCandidate topology.multiRecipient |

## D.4 Where rules run
- `packages/model.validate()` — tests and CLI (`artyfact check` optional).
- Worker `hooks/model-rules.ts` — on Genome realizations and on import; result cached per genomeCommit in the DO.
- Browser — the model bundle includes `Readiness`; the Map's "findings only" filter and the Inspector derivation tree read it. Engine is small enough to run client-side for *what-if* edits later (not in scope now).

