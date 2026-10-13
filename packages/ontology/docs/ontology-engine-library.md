> Copied from bropilot `docs/ontology-engine-library.md` @ `cb1599c` with the engine; maintained here since. Paths like `packages/ontology-engine` and `@bropilot/ontology-engine` now mean `packages/ontology` and `@artyfact/ontology`.

# Ontology engine as a library

Status: accepted design, 2026-10-12. Consumer: `artyfact-cf`. Implementation in `packages/ontology-engine`.

## What exists today

Two partial implementations of the same engine live in two repositories.

| Concern | artyfact-cf | bropilot |
|---|---|---|
| Template shape | `packages/model/src/schema.ts` (zod, fixed node kinds and relation vocabulary); a template adds nodes, criteria, hooks, `requires` sections | `crates/world-core/src/lib.rs`: `WorldTemplate` / `ThingTemplate` with `ObjectShape`, `RelationEndpoint`, `RequiredRelation`, `ForbiddenCycle`, `IncompatibleConstraint` |
| Instance state | YAML directory loaded by `loadSystem`, flattened by `toFacts` into ~60 fixed EDB relations | `WorldSnapshot` with `ModelObject`, `ModelRelation`, `CompletenessDeclaration` |
| Deterministic checks | `@artyfact/rules`: own Datalog dialect, stratified negation, derivation trees, zero dependencies; rule packs in `packages/templates/rule-packs/*.dl` keyed by kit | `ascent` programs compiled into Rust; `evaluate_readiness` |
| Judgment | `@artyfact/semantic`: System One question catalogue, probabilities, policy thresholds (0.9 confident, 0.5 review), fake provider | Jev / System One seam in `lfp` |
| Form validity of the template | zod parse plus `id@version` matches directory name | shape structs, no versioned meta-schema |

The artyfact side is closer to a library already: `model`, `rules`, `semantic` and `templates` are separate packages, the rules engine is self-contained, and every finding carries a derivation and the pack hash that produced it. Its limit is that the vocabulary is closed. Node kinds, relation names, the fact relations and the core packs are fixed in `schema.ts`, `facts.ts` and the bundled `.dl` files. A template cannot introduce a kind, a relation, a cardinality rule or its own fact relations. That is exactly what the requirement asks for.

The bropilot Rust core has the open vocabulary (templates declare shapes, endpoints, required relations, forbidden cycles, incompatible constraints, completeness declarations) but no portable rule language, no derivations, and a JSON contract tied to the World platform.

## Requirement, restated

One engine, independent of any particular template, that answers two questions:

1. **Form.** Is this template, at this version, a valid template? Does it describe a coherent ontology whose constraints can in principle be satisfied?
2. **State.** Given a template and a partially filled instance, how complete, consistent and correct is the instance, and can it be built?

The template carries its own criteria, relationships and rules. The engine supplies the meta-schema, the evaluation machinery, the judgment protocol and the report shape. Deterministic reasoning answers everything it can. System One models answer bounded questions with probabilities. An LLM is an optional provider behind the same interface, never a requirement.

## Architecture

Three layers, each a package or module, each usable alone.

### 1. Meta-schema (`meta@1`, versioned)

The grammar of templates. A template is data that conforms to the meta-schema. The meta-schema is itself versioned so templates pin `meta: 1` and the engine can refuse or migrate.

A template declares:

- `id`, `version`, `meta`, `extends` (another template ref; refinement by reference, as world-core's Thing templates inherit shared context).
- `kinds`: node kinds with their fields (name, type, required, enum values), allowed parents, and `completeness` rules (required fields, required children with cardinality, required relations with cardinality).
- `relations`: relation vocabulary with endpoint kinds, cardinality on each side, `acyclic`, `inverse`, and `certainty` defaults.
- `constraints`: cross-cutting declarations the engine already understands without custom rules: forbidden cycles over a relation set, incompatible field combinations, mutually exclusive relations, "exactly one of" groups, declared-complete scopes.
- `criteria`: as in artyfact today, with owner, subject kind, severity, gates and hooks.
- `rules`: Datalog packs in the engine's dialect, scoped to the template and allowed to declare new derived relations. Packs may only read fact relations the meta-schema emits plus relations the template declares.
- `questions`: a catalogue of System One questions the template wants asked, each with the state slice it needs, the answer type (yes/no, choice, score), a `benign` answer for the fake provider, and the policy that turns an answer into a finding level.
- `nodes`: prefilled nodes with `$self` placeholders, as artyfact templates do now.

### 2. Generic graph and deterministic core

The instance is a graph, not a YAML layout. Canonical form is JSON:

```
{ template: "template.thing.x@2", nodes: [{id, kind, parent?, fields, provisional?}],
  links: [{from, rel, to, certainty?}], declarations: [{scope, status}], evidence: [...] }
```

Loaders are adapters. The first adapter reads artyfact's YAML directory layout and emits this graph, so artyfact-cf keeps its files until it wants to change them.

`toFacts` becomes generic. It emits a small fixed set of EDB relations from the graph (`node/3`, `field/3`, `parent/2`, `link/4`, `known/1`, `ref/3`, `declared/2`, `provisional/1`) and a second set from the template (`kind/1`, `kindField/4`, `relEndpoint/3`, `relCard/4`, `relAcyclic/1`, `requiredRel/4`, `requiredChild/4`, `incompatible/…`). Template-specific relations such as artyfact's `stepScreen` or `policyMode` move into the template as derived relations or as typed fields on kinds.

Three engine-owned packs run on every evaluation:

- `metamodel`: dangling refs, missing parents, containment cycles, multi-parent, unknown kinds, relations whose endpoints violate the vocabulary.
- `completeness`: required fields, required children, required relations by cardinality, scopes not declared complete, provisional nodes still present. Findings here are `missing`, not `error`.
- `consistency`: cardinality upper bounds exceeded, forbidden cycles, incompatible constraints, exclusive groups violated, contradictory certainty (an `observed` link contradicting a `declared` one).

Template packs run after them. Every finding keeps its derivation tree and the `pack@version` hash, as `@artyfact/model` findings do today.

**Form validity** uses the same machinery turned on the template: the template is loaded as a graph whose kinds are the meta-schema's kinds, and a `meta@1` pack checks it. Examples: a required relation between two kinds the vocabulary does not allow is unsatisfiable; a rule pack reads a relation nobody emits; packs fail to stratify; `extends` chains cycle; a criterion subjects a kind the template does not declare. The report is `TemplateForm { valid, findings, hash }` and is cached by template hash.

### 3. Judgment

The deterministic layer emits `semanticCandidate(rule, subject, text)` rows where a rule decides a question needs judgment. The judgment layer resolves each candidate against the template's question catalogue, builds the bounded state slice, asks the provider, and applies policy. This is `@artyfact/semantic` generalised: the question catalogue comes from the template rather than from `questions.ts`.

Provider interface stays as it is: `SystemOne.ask(state, questions) → probabilities`. Implementations: fake (deterministic, directive driven), System One HTTP, LLM. Policy is deterministic: a `yes` at or above the confident threshold becomes the finding level the template declared; between review and confident becomes `review`; below review stays `unknown`. Unknown never passes. Provenance records provider, state hash and question hash so a judgment can be replayed or invalidated when the slice changes.

### Report

```
Readiness {
  snapshotHash, template: {ref, hash, form: TemplateForm},
  packs: [{id, version, hash}],
  findings: Finding[],            // level, rule, subject, message, facts, derivation, pack, provenance?
  completeness: { required, satisfied, missing: subjects[] },
  consistency:  { violations: n },
  judgments:    { confident, review, unknown },
  buildable: boolean,              // no hard violation, no missing, no blocking unknown
  actionable: boolean              // same, but soft and advisory ignored
}
```

`diff(a, b)` over two snapshots returns the semantic delta (added, removed, changed nodes and links) and which findings appeared or resolved, as `diffModels` does now.

## Packaging

One npm package, TypeScript, no runtime dependencies beyond `yaml` in the loader adapter, runs in Workers and Node.

```
@bropilot/ontology-engine
  meta/        meta-schema, template loader, TemplateForm check
  graph/       canonical graph types, YAML directory adapter, JSON adapter
  rules/       moved verbatim from @artyfact/rules
  evaluate/    toFacts, core packs, Readiness, diff
  judge/       provider interface, fake, policy, candidate resolution
```

Recommended home: `packages/ontology-engine` in this repository, published to npm, with `artyfact-cf` depending on it and deleting `packages/rules`, most of `packages/model` and the generic half of `packages/semantic`. artyfact keeps its templates, its question catalogue, its YAML files and its hooks and gates. The Rust `world-core` is not on the path: its template concepts are ported into `meta@1`, and a wasm build is a later step only if a non-JS host needs it.

## Migration from artyfact-cf

1. Move `@artyfact/rules` into the engine unchanged. Its tests move with it.
2. Write `meta@1` and express the current artyfact node kinds, relation enum and `Template` zod shape as a `template.meta.artyfact-genome@1` template that other artyfact templates `extend`. Prove form validity on the six bundled templates.
3. Write the YAML directory adapter so `loadSystem` output maps onto the canonical graph without loss. Compare `toFacts` old and new on the Peopling example; the diff must be explainable by relations that moved into the template.
4. Port `metamodel@1` and `readiness@1` to the engine-owned packs. The remaining packs (`authorization`, `journeys`, `theory`, `topology.private-pairs`) become template packs.
5. Move the provider, fake, policy and judgment runner into `judge/`; the artyfact question catalogue becomes template `questions`.
6. Switch `apps/platform` and `packages/cli` to the engine. Readiness output for the example must match the old findings set, rule for rule.

## Acceptance criteria

- Same template, same instance, same packs give byte-identical `Readiness` on Node and Workers.
- A template that fails form validity cannot be used to evaluate an instance; the error names the rule and the template hash.
- Every finding carries a derivation whose leaves are EDB facts or a judgment with provenance.
- No finding reaches `pass` or `error` from a judgment below the confident threshold.
- The Peopling example reproduces its current findings through the adapter.
- A second template with kinds and relations that do not exist in artyfact evaluates without touching engine code.

## Implementation notes (milestone 1, 2026-10-12)

`packages/ontology-engine` holds the rules engine (moved verbatim), `meta@1`, the canonical graph, generic fact emission, the three core packs, the template form check, `evaluate` and `diff`. The judgment layer and the YAML adapter are not built yet. Where the implementation sharpened the design above:

- Packs are TypeScript modules exporting `.dl` source strings, so no file reads or raw imports are needed on Workers.
- `node(Id, Kind, Parent)` with `""` for a root. `relEndpoint(Rel, Side, Kind)` and `relCard(Rel, Side, Min, Max)` with `Max = -1` for unbounded; `Side` is `out` (links per source) or `in` (links per target). Lower bounds are completeness (`missing`), upper bounds are consistency (`violation`).
- Extra EDB relations beyond the list above: `fieldType`, `typeAccepts`, `kindFieldEnum`, `requiredField`, `relation`, `relInverse`, `relCertainty`, `forbiddenCycle`, `incompatible`, `incompatibleSize`, `exclusive`, `exactlyOne`, `completeScope`, `criterion`, `criterionGate`, `criterionHook`, `question`, `graphTemplate`, `templateRef`, `evidence`. `src/evaluate/edb.ts` is authoritative.
- Output relations carry `(Rule, Subject)`, so a completeness obligation is per node and rule; the missing field or relation is visible in the derivation. `completeness@1` also emits `obligation/2` to count required versus satisfied.
- Mutually exclusive relations are disjoint on the same `(from, to)` pair. Exactly-one groups give `missing` on zero and `violation` on two or more. A declared-complete scope requires `declared(node, "complete")` on each node of the listed kinds. Contradictory certainty is an `observed` link to a different target than a `declared` link on a relation whose out maximum is one.
- Inverse is metadata; inverse links are not materialised.
- Template packs run in a second `run()` after the core packs and may read only EDB relations and what they derive; `meta@1` enforces this.
- Severity maps hard to `error`, soft to `warning`, advisory to `info`. `actionable` is no `error`, no `missing` and not `incomplete`. `buildable` additionally requires no `warning` and no open semantic candidate. Advisory never blocks.
- `meta@1` also checks unknown inverse, parent, field, relation, constraint and extends references, unsatisfiable required children, and prefilled nodes of unknown kind.
- `extends` merges wholesale per key: kinds and relations replace by name, everything else by id, child wins. Template, node and link schemas are strict.
- `evaluate` caches template form by hash and throws `TemplateFormError` (`rule`, `templateHash`, `findings`) on an invalid template.

## Implementation notes (milestone 2, 2026-10-12)

`src/judge/` and `src/adapters/artyfact/` are built. The six artyfact rule packs are ported: `facts` and `metamodel` stay on `template.meta.artyfact-genome@1`, the domain packs live in the `packages/templates` templates, and the Peopling example reproduces artyfact's findings rule for rule against them.

- A question matches a candidate when the question id equals the candidate's rule id. The slice is structured (`parents`, `hops`, `direction`, `rels`, `kinds`, `fields`), so it is hashable and `meta@1` can reject slices naming unknown kinds or relations.
- Levels `review` and `pass` exist and come only from judgment. A confident answer the policy does not map stays `unknown`. Provenance records provider, state hash, question hash and thresholds, never timing.
- `buildable` also blocks on `review` and on any semantic finding without a confident judgment. `evaluate` stays synchronous; `judge` and `evaluateAndJudge` are async.
- Ported packs are named `artyfact.*` and read `a`-prefixed relations derived by `artyfact.facts@1`, because `node`, `criterion` and `ref` already exist in the generic EDB. Rule ids and messages are verbatim. The dialect has no lowercase, so topology text rules match case-insensitively with generated character classes.
- Adapter mapping: criterion hooks, hook criteria, `satisfies`, claim activities, step requirement refs and step next objects stay as list fields; `stepNext` links exist alongside. Unresolved step targets are fields. Required but unpinned kits and artifacts are nodes. Lost on load: a cross link's `label` and `source`, whether `refines` came from a field or a link, and whether a thing's sections were defaulted from its template.
- The generic core adds `node.provisional` missing findings on Peopling that artyfact does not have, so the example is actionable but not buildable under this engine. That is the intended stricter reading, not a parity failure.
- The reference for parity tests is artyfact's own `toFacts` and `validate`, vendored under `test/vendor/artyfact/` with only import lines changed.

## Implementation notes (milestone 3, 2026-10-12): other vocabularies

Two more adapters prove the acceptance criterion that a template with kinds and relations unknown to artyfact evaluates without touching engine code. No engine source file changed; only adapters, templates, fixtures and tests were added.

**World snapshots** (`src/adapters/world/`), this repository's Rust kernel fixtures in `packages/contracts/fixtures/`, with `evaluate_readiness` as the oracle via `test/fixtures/world/regen.mjs`. All 11 snapshots and 37 single-change mutations of `assistant-valid` match Rust as sets of (code, severity, object ids); every Rust finding code is reproduced. Status mapping: Rust `ready` is engine `actionable`; `blocked` is not actionable with at least one error; `unknown` is not actionable with no error and at least one missing. `buildable` is stricter than `ready` because Rust shapes list only required properties, so every other property is a `field.unknown` warning. Four asserted differences: an empty required property (Rust ready, engine blocked, because empty strings are dropped as fields); an unknown-kind object owned by a Thing gains a `link.endpoint` error; a parent cycle (Rust ready, engine `tree.cycle`); a required relation whose endpoints exclude the subject kind is a template form error here and a per-subject blocker in Rust. Template data (required relations, scopes, endpoint pairs, rule pack pins) become prefilled template nodes so derivation leaves stay EDB facts. Active constraints are one boolean field per constraint on a single node because the incompatibility check groups by field name.

**Product specs** (`src/adapters/product/`), the uip and lfp prototype graphs and the older spaces-schema graph from spafax-graph-app, as `template.meta.product-spec@1` and `template.meta.bropilot-spaces@3`. Real graphs evaluate with exact per-rule finding counts pinned; lfp's own invariant checker agrees on the shared rules. lfp's `graph.json` is structurally identical to the uip bropilot graph. Three things the `meta@1` constraint language could not express, each handled in a template rather than the engine: graph-wide counts (both loaders add a synthetic `spec` root so "exactly one name" is a child cardinality), needs filtered by the far end's kind (`product.needs@1` pack), and either-or reachability (`product.checks@1` pack). lfp's gating of needs by answered questions is not modelled.

**Open design point.** The engine's `provisional` flag yields a `missing` finding, and any `missing` makes a graph not actionable. For a spec whose only purpose is `proposed`, that means "not actionable", while the prototypes treat it as workable but not shippable. The product adapter therefore reports uncommitted status as a template warning (actionable, not buildable) and only sets the engine flag on request. Whether `provisional` should block actionability or only buildability is a decision to take before artyfact-cf switches over.

## Implementation notes (milestone 4, 2026-10-12): content quality

Two layers now look at what nodes say, not only whether they exist.

**Deterministic text checks** (`text@1` core pack, always on). Kind fields may declare `minLength`, `minWords`, `placeholders`, `distinctFrom` and `pattern`; a template-level `textDefaults` block applies a default placeholder list to `description` and `title` when a template opts in. Rules: `text.empty` (whitespace-only required field; an empty string is still `field.required`, so one blank field gives exactly one finding), `text.short`, `text.placeholder` (wins over short), `text.sameAsId`, `text.sameAsField`, `text.pattern`. One finding per node per rule; the field is in the derivation. Degraded copies of Peopling and tidepool prove the rules fire on exactly the ten planted nodes each. With defaults on, the only hit on real content is Peopling's `binding.d1`, whose genuine description contains the word "placeholder"; it is pinned, not suppressed.

**Semantic probes and providers** (`src/judge/`). `openRouterProvider` targets the OpenRouter decisions API with `perplexity/pplx-decider-v1-27b` as default model behind the `SystemOne` interface; `providerFromEnv` picks fake, OpenRouter or off. A reusable catalogue offers `text.vague`, `text.unmeasurable`, `pair.contradiction` and `criterion.unfalsifiable`; the `semantic.probe@1` pack emits candidates, with pair candidates encoded as `(A, B)` because the dialect cannot concatenate strings, and `judge` rewriting the judged subject to `A|B`. Fixtures plant 14 natural-language problems and 5 controls across the three vocabularies. A live suite runs only when `OPENROUTER_API_KEY` is set and records every answer to an auditable results file; one run makes 261 calls. Live results (2026-10-12, 261 calls per run, about 35 s wall, zero provider errors after retries were raised to three with exponential backoff and a one-second floor on 429) are recorded in `test/fixtures/semantic/live-results.<model>.json`:

| Model | Planted found at or above 0.9 | Landed in review | Controls flagged |
|---|---|---|---|
| `perplexity/pplx-decider-v1.1-27b` (default) | 12 of 14 | 2 | 0 |
| `cloudflare/clef` | 8 of 14 | 6 | 0 |

The OpenRouter id `perplexity/pplx-decider-v1-27b` no longer exists; the default is `v1.1`. Both models leave "handles any errors properly" at review rather than vague, and both lean "no contradiction" on the owner-only policy versus a goal effect shared with all contacts, which suggests the pair slice shows the policy too thinly. All three planted unmeasurable outcomes are caught by the Perplexity model. The vague probe over-fires on structural one-liners (section descriptions, "Bindings and deployment surface.") and also flags the real Peopling theory claims T1 to T4, which are genuinely soft; which kinds to probe is a template choice, and the test vocabularies currently probe every node with a description. The live test keeps the strict expectation (level and confidence at or above 0.9) and therefore fails on the review items by design; review is the engine's correct output when a model is unsure.

## Implementation notes (milestone 5, 2026-10-13): defect ontology and question funnel

The single "is this vague?" probe is replaced by a walk over an internal **defect ontology**. `defects@1` (`src/judge/defects.ts`) is a versioned TypeScript constant of five families (instance, specificity, testability, consistency, coherence), each with four or five categories, each with four or five leaves; `instance.otherKind` grows one leaf per glossary kind at load time. Every defect carries a scope (node, set, pair, whole), a short label used as the choice key on the wire, a one-sentence criterion the decision model sees as that option, and a level (warning by default; contradiction, scope clash and a contradicting summary are errors). Templates may `disable` subtrees or override `levels`; the merged taxonomy is mirrored into EDB facts (`defect`, `questionDefect`, `questionNext`) so `meta@1` form-checks question and policy references.

**The walk.** Every non-leaf defect yields one generated choice question `which:<id>` whose options are its children plus `none`; each policy entry names the chosen child as `defect` and `next` points at the child's own question when it is not a leaf. Only the stage-1 entry questions are hand-written: per node a kind yes-no, a 0 to 4 tangibility score, measurability or falsifiability for the kinds that need it, and purpose fit; per set (a parent with two or more texted children) "can all of these hold at once?" plus its polarity partner and a parent summary check; per root "can all sections hold at once?" plus a section pick; per term found in two or more sections a usage check. Stage-1 questions for one subject are batched into one provider call. Follow-ups spawn only on confident answers unless a question lowers `minStatus` to review. A flagged set narrows to one member, then to pairs ordered by the regex pre-filters (modal clash, same-thing overlap, shared terms) and capped, then a single `pair.relation` choice (compatible, contradiction, tension, duplicate, circular, scope clash, unclear) and the matching leaf question. A clean node costs one call; a defective node at most three. The bounded loop (`src/judge/funnel.ts`) records round, stage, batch and path per judgment, drops a parent finding to info with `narrowedBy` once a leaf is confirmed, and marks whatever the budget cannot reach as unknown with provider `budget` and `provenance.truncated`. Defaults: 6 rounds, 500 calls, 6 pairs per set, 12 sections, 10 cross pairs, 5 terms, 10 explanations.

**Explainer seam** (`src/judge/explain.ts`). A confirmed consistency or coherence leaf at warning or error is sent once to a cheap chat model that says in at most three sentences which statements clash and why, quoting node ids. Default `openai/gpt-6-luna` (listed on OpenRouter on 2026-10-13 at $0.10 per million input tokens), overridable with `OPENROUTER_EXPLAIN_MODEL`, off with `EXPLAIN=0`. The text lands on `judgment.explanation` and is never read for level or status. Shared fetch, retry and key redaction live in `src/judge/http.ts`.

**Criteria from the ontology.** The user's clarification (2026-10-13): an ontology's criteria are the author's checklist of what a good node of each kind must contain, for example "each use case is described in Given/When/Then", "a screen states explicit signifiers, affordances and feedback", "a component declares an empty state", "non-static data has a loading state". Templates declare `kinds.<k>.checks` and `rootChecks`: each check has an id, its text, a scope (node, children, pair), an optional `when` condition, a level, a defect, an optional `na` for conditional criteria, and an optional regex `pattern` that makes it deterministic. The `checks@1` pack emits one candidate per node per applicable check; the catalogue turns each judged check into its own question batched with the node's stage-1 questions; findings carry the rule `check:<kind>.<id>` so reports group by criterion. The generic noun, instance, grounded and testable wording is a separate general layer on the same kinds. The shipped artyfact and product templates carry six checks; the degraded fixtures plant one violation and one control per check, and the live run found all six confidently (0.98 to 1.00), the Given/When/Then one without a model call. The guide `docs/writing-an-ontology.md` is written around these checklists.

**Compatibility.** `semanticCandidate` keeps arity 3; `semantic.probe@1`, `text.vague` and `pair.contradiction` stay exported for templates that pin them; `semantic.probe@2` emits only stage-1 candidates. Evaluation output without a semantic pack is byte-identical to milestone 4.

**Live results** (2026-10-13, about 25 s wall, zero batch splits, budget never exhausted, 4 explanations). Recorded in `test/fixtures/semantic/live-results.v2.<model>.json`. The fixtures now plant 20 problems across the three vocabularies (9, 7, 4) and 9 controls. Review counts as detection when the finding's defect is on the planted defect's branch; a review-status answer on the benign side carries the question's family defect so the subject is still pointed at. The one miss is the artyfact "handles any errors properly" operation, scored 2 with the probability mass split 0.47 against 0.53 for 3 or above, so it settles as unknown; the live test keeps the strict zero-miss assertion and therefore fails on it by design. The first run of the same suite recorded 7 misses because member and section picks just under 0.9 spawned no pairs, benign review answers carried no defect, and a failed member pick ended the set; navigation now proceeds at review with a pre-filter fallback. The gpt-6-luna explanations named the sign-in link contradiction, the five-versus-all cap and the offline-versus-GPS clash correctly from the set-level findings.

| Model | Calls | Planted confident | Planted in review | Missed | Controls flagged |
|---|---|---|---|---|---|
| `perplexity/pplx-decider-v1.1-27b` | 153 | 7 of 20 | 12 | 1 | 0 |
| `perplexity/pplx-decider-v1.1-27b`, with per-kind checks | 183 | 13 of 26 | 12 | 1 | 0 |
| `cloudflare/clef` | 138 | 2 of 20 | 9 | 9 | 0 |

## Implementation notes (milestone 6, 2026-10-13): routing a change request

The same chained-choice pattern that narrows a defect also narrows where a user's message lands. The user's framing (2026-10-13): a System One decision tree identifies which part of the system is affected with increasing depth, and only then does an LLM translate the message into changes, or ask a question when unclear, so a small model with a small slice can replace a large model reading the whole graph.

**Chain** (`src/route/`): intent (add, update, remove, link, question, answer, unclear) → space (lfp kernel spaces for the product vocabulary via `PRODUCT_SPACES`; top-level sections for the world vocabulary) → kind present in that space → node of that kind, options capped at 12 and ordered by term overlap with the message, plus `none` and `new`; up to three node picks. Each question sees only the message and the current level's options with example titles, as lfp's chained questions do. Review or unknown stops the chain and the status propagates. At most eight calls per message.

**Translator seam** (`src/route/translate.ts`): given the message, the route and a bounded slice (targets, parents, one hop), return ops (`add`, `update`, `remove`, `link`, `unlink`) or a question. `validateOps` checks ids, kinds and relation endpoints deterministically. Implementations: OpenRouter chat (default `openai/gpt-6-luna`), fake, off.

**Dataset and evaluation.** Gold cases live in `test/fixtures/route/*.cases.json` (24 on tidepool, 10 on the world assistant snapshot), written by Claude as the reference translator with intent, space, kind, nodes, ops or question, difficulty and notes. The harness scores each level, end-to-end routed rate, calls, and loose op precision and recall; an oracle provider proves the chain can reach every gold target; the live test records a report per decider and translator model so models can be compared on the same cases.

**Live results** (2026-10-13, Perplexity decider, both orders, 170 s wall for four runs). Recorded in `test/fixtures/route/results.<decider>[.<translator>].<order>.json`.

| Decider | Order | Fixture | Routed | Intent | Space | Kind | Node | Mean calls |
|---|---|---|---|---|---|---|---|---|
| oracle | either | tidepool / assistant | 24/24, 10/10 | | | | | 4.7 / 3.6 |
| `perplexity/pplx-decider-v1.1-27b` | intent-first | tidepool | 11/24 | 17/24 | 17/21 | 15/21 | 12/21 | 3.8 |
| `perplexity/pplx-decider-v1.1-27b` | intent-first | assistant | 3/10 | 7/10 | 8/9 | 5/9 | 4/9 | 3.8 |
| `perplexity/pplx-decider-v1.1-27b` | intent-last | tidepool | 11/24 | 16/24 | 15/21 | 14/21 | 14/21 | 4.0 |
| `perplexity/pplx-decider-v1.1-27b` | intent-last | assistant | 6/10 | 8/10 | 9/9 | 6/8 | 6/9 | 3.6 |
| `perplexity/pplx-decider-v1.1-27b` | shortlist-first (default) | tidepool | 13/24 | 17/24 | 18/21 | 16/21 | 19/21 | 3.8 |
| `perplexity/pplx-decider-v1.1-27b` | shortlist-first (default) | assistant | 7/10 | 8/10 | 9/9 | 8/9 | 8/9 | 3.8 |

With the gpt-6-luna translator on the routed slice, op precision is 0.67 to 0.83 and recall 0.56 across the four runs, every gold question case produced a question, and `validateOps` reported one error in 68 cases. The first run routed 6 of 24 and 1 of 10 because the chain stopped at the first review-status answer and asked intent before any node was in view; navigation now continues at review and the default order asks intent last with the picked item's text in the question. What remains: the space level is the weakest step (five unknowns and three wrong picks on tidepool under intent-last), while a node pick, once reached, is right at 0.85 to 1.0. Spaces are an abstraction the message rarely names. The shortlist-first order, now the default, pre-filters the whole graph by term overlap into one node choice and falls back to the space chain only when nothing matches: node targeting rises to 19 of 21 and 8 of 9, and the remaining misses are almost all the intent label (add versus update, link versus update, question versus add), which the translator settles with the picked node in view. With gpt-6-luna translating on the shortlist-first route, op precision is 0.67 and 0.86, recall 0.64 and 0.67. The three orders stay selectable so other deciders can be compared on the same cases.

## Decisions

Recorded in `decision_log.md` on 2026-10-12: the package lives in this repository as `packages/ontology-engine`; the `@artyfact/rules` Datalog dialect is the rule language; artyfact-cf keeps YAML behind the loader adapter and the canonical instance format is the JSON graph. On 2026-10-13: the defect funnel decisions (chained choices over the defect tree, confident-only follow-ups with a per-question knob, full three-level taxonomy, gpt-6-luna as explainer) and the extension of the funnel to change routing with a gold dataset and per-model evaluations.
