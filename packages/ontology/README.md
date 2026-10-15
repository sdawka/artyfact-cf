# @artyfact/ontology

Copied from bropilot `packages/ontology-engine` at commit `cb1599c` (MIT, see `LICENSE`); artyfact owns and maintains it from here on.

A template-independent ontology engine. A template declares kinds, relations, constraints, criteria, rule packs and questions against the versioned meta-schema `meta@1`. The engine checks that the template is well formed, then evaluates an instance graph against it and reports readiness with a derivation for every finding. The design is `docs/ontology-engine-library.md` and the guide for template authors `docs/writing-an-ontology.md` (both in this package); how artyfact stores Genomes as node trees and drives intents is `docs/design/ontology.md` at the repository root.

TypeScript ESM. The runtime dependencies are `@artyfact/rules` (the Datalog engine), `zod` and `yaml`. Hashing is synchronous, so the same code runs in Node and Workers. Only `@artyfact/ontology/artyfact/node` touches the file system. The main entry exports the engine and the artyfact adapter; the product and world adapters are `@artyfact/ontology/product` and `@artyfact/ontology/world`.

## What exists

| Module | Contents |
|---|---|
| `@artyfact/rules` | The Datalog engine, imported from `packages/rules` (the bropilot copy was that package moved verbatim and is deleted here). |
| `src/codec/` | The Genome v2 tree codec: `parseTree` and `readTree` (node tree -> `Graph`, template nodes from the meta@1 sources), `applyOps` (ops -> file changes through the `yaml` Document API), `mintId`, `formatNodeFile`. `@artyfact/ontology/codec/v1` is `convertV1`, the one-time v1 -> v2 converter behind `artyfact convert-genome`; its Peopling output is `examples/peopling-system`, converted from the v1 copy in `test/fixtures/artyfact/peopling-system` (regenerate with `UPDATE_GENOME_FIXTURE=1`). |
| `src/genome/` | Genome v2 contract: `node.yaml` schema (`NodeFileSchema`, inline criteria and hooks), the legacy v1 check, directory slugs, and template view hints (`KindViewSchema`, `TemplateViewSchema`, `resolveKindView`, `checkViewHints`). |
| `src/meta/` | `meta@1` zod schemas, cardinality grammar (`1`, `0..1`, `1..*`, `0..5`), `loadTemplate` with `extends` resolved through a `TemplateStore`, `templateHash`, `instantiateNodes` for `$self`, and `checkTemplateForm`. |
| `src/graph/` | The canonical JSON graph (`template`, `nodes`, `links`, `declarations`, `evidence`), `parseGraph` and `graphHash`. |
| `src/evaluate/` | `toFacts`, the engine-owned packs `metamodel@1`, `completeness@1`, `consistency@1`, `text@1` and `meta@1`, `evaluate` returning `Readiness`, `diff` and `diffFindings`. |
| `src/judge/` | The System One provider interface, `httpSystemOne`, `typeSafeProvider`, `openRouterProvider` and `providerFromEnv`, `fakeSystemOne` with `#s1low`, `#s1no`, `#s1pick:`, `#s1harm`, `#s1:<qid>=<key>` and `#s1low:<qid>` directives, `offSystemOne`, `S1Error`, the confidence policy, `buildSlice`, the funnel and pre-filters, `judge` and `evaluateAndJudge`, the reusable semantic question catalogue with the generated `which:` questions, and the `semantic.probe@2` pack (`@1` on request). |
| `src/adapters/artyfact/` | The `template.meta.artyfact-genome@1` base template, `loadArtyfactSystem` for an artyfact system directory, `loadArtyfactTemplate` and `artyfactMetaStore` for artyfact templates, and the generic `facts` and `metamodel` packs. The kinds carry legal `parents` and view hints (`ARTYFACT_KIND_VIEWS`, `ARTYFACT_VIEW`). The domain packs (readiness, theory, journeys, authorization, topology) are owned by the templates in `packages/templates`. |
| `src/adapters/product/` | `template.meta.product-spec@1` for the uip/lfp product graphs with `productGraphToGraph`, and `template.meta.bropilot-spaces@3` for the older spaces graphs with `spacesGraphToGraph`. |
| `src/adapters/world/` | `template.meta.world@1` with `world.readiness@1`, `worldTemplateToMeta` and `worldSnapshotToGraph` for world-core `WorldSnapshot`s, and `toWorldFindings` and `worldStatus` to read a readiness in world-core's terms. |

## Judgment

`evaluate` stays synchronous and leaves semantic candidates as `info` findings with rule `semantic:<rule>`. `judge(readiness, template, graph, provider, opts?)` resolves each candidate through the template question whose `id` is the candidate's rule. The question's `slice` names what the provider sees: the subject with its fields, its parent chain (`parents`), and nodes up to `hops` links away, filtered by `direction` (`out`, `in`, `both`), `rels` and `kinds`. `fields` limits every node to the named fields. The slice and the question are hashed into the provenance.

| Provider answer | Status | Level |
|---|---|---|
| Confidence at or above `thresholds.confident` (default 0.9) | `confident` | The question's policy level for that answer, else `unknown`/`info` |
| Confidence from `thresholds.review` (default 0.5) up to `confident` | `review` | `review` |
| Lower confidence, an unreadable answer or no policy entry | `unknown` | `info` |
| No question for the rule | `unknown`, provider `off` | `info` |
| Provider throws | `unknown`, provider `error` | `info` |

Provenance records the provider, model, `stateHash`, `questionHash` and thresholds. `readiness.judgments` counts findings by status, plus `calls`, `rounds`, `gated`, `budget` (`ok` or `exhausted`) and `explained`; `evaluate` returns them all at zero. It carries no timing, so the judged `Readiness` JSON is reproducible with the fake provider.

A yes-no question with exactly two `choices` sends them on the wire as the `true` and `false` criteria; otherwise both criteria repeat the question text.

Slices also take `children` (default `false`): the direct children of the subject and counterpart, filtered by `kinds`, shown as `state.members`. `textCap` (default 600) cuts every string field value to that many characters. A question may also declare:

- `defect`: the defects@1 id a harmful answer stands for; a policy entry's own `defect` wins.
- `byKind`: per subject kind, a plain noun or a JSON object `{"noun", "instanceOf", "grounded"}` substituted for `{noun}`, `{instanceOf}` and `{grounded}` in the text and choices. The question hash therefore differs per kind.
- `batchWith`: companion questions asked in the same call over the same slice.
- `next`: follow-ups `{answer?, maxScore?, minStatus: "confident" | "review", ask, over: "self" | "members" | "pairs" | "sections" | "crossPairs"}`.

### The funnel

`judge` runs a bounded round loop (`src/judge/funnel.ts`). Each semantic candidate with a question becomes a stage-1 item. In every round, items about the same subject whose slices are equal share one provider call, together with their `batchWith` companions. A yes-no question whose companion is a yes-no question of the opposite `benign` is decided by `combine` over both answers, each read against its own `benign`, so `set.allHold` with `set.inconsistent` passes only when both agree. The combined side is mapped back to each question's own answer, and both questions' `next` entries follow it. Any other companion, such as `parent.summary` or `sections.which`, raises no candidate. When its answer is harmful or in review, it becomes a finding of its own with stage `companion` and follows its own `next`. That finding clones the subject, derivation, facts and pack of the item that brought it, takes rule `semantic:<companion id>`, and shares that call's round and `batch` provenance. A companion answer that passes or is unknown emits no finding, so a clean subject adds nothing to the counts or verdicts, and an unreadable companion never blocks `buildable` by itself. A follow-up that an item, its partner or its companions would each fire is walked once. A batch the provider answers with `bad-response` is asked again one question at a time, and those answers carry `provenance.batch.split`.

A judged step fires each `next` entry whose answer matches and whose status reaches `minStatus` (default `confident`). A navigation step, the pick of a `choicesFrom` question, fires at `review` as well; the catalogue's `set.member`, `sections.section` and `sections.other` entries say so explicitly. An entry matches its `answer`, or any score at most `maxScore`, or any non-benign answer when it names neither. An entry without `answer` never fires on a step whose level is `pass`, so a score that passes under the kind's `passFrom` is not narrowed. Members without statement text are never paired. `over` decides what is asked next:

| `over` | Follow-up items |
|---|---|
| `self` | The same subject with the follow-up's own slice; it refines the same finding |
| `members` | One new finding per member of the step's slice |
| `pairs` | Member pairs: the picked member with every other one when the answer was a member id, else all pairs; ordered by the pre-filters and capped at `maxPairsPerSet` |
| `sections` | One pair of the two sections picked on the path, sliced with `children: true` so both sections' members are shown |
| `crossPairs` | Pairs of texted descendants of the two picked sections, ordered by the pre-filters and capped at `maxCrossPairs`; a section without texted descendants stands for itself |

A pair drawn by `pairs`, `sections` or `crossPairs` is worded with the kind of the node it was drawn under: the set for member pairs, the root for section pairs. That kind's own `pairs` criterion (`childPairs` in its `byKind` wording) fills `{pairs}`. Without one, and for entry pairs from `probePairs`, the first subject's kind words the question with the `pairs` it inherits from its declared parents. The wording kind is part of the memo and batch keys. A node is a member or section only when one of its statement fields is non-empty; a title alone does not count. The statement fields are `opts.texts`, else the `probeText` fields of the template's `semantic.probe` pack, else `description`, so the funnel and the pack agree. A root's sections are ordered by pre-filter relevance (the sum of `pairScore` against the other sections, then id) and capped at `maxSections`. The rest are counted in `gated` once per root. A `choicesFrom` (`members` or `sections`) question offers the slice members, or the sections not yet picked in that order, before its declared choices. Its pick is a navigation step: it is on the path but never describes the finding. When the pick is unknown, below `review`, unreadable or `none`, so none of its entries fire, the walk does not stop. The pair question it leads to (found through `self` steps) is asked over pairs from the pre-filters alone. A member pick falls back to all member pairs, capped at `maxPairsPerSet`. A section pick falls back to statement pairs across the root's sections, anchored on a section already picked on the track when there is one, capped at `maxCrossPairs`. A follow-up is asked once per question, state and options, so a pair reached twice is asked once. When the catalogue has `term.usage`, every root whose questions walk sections also gets one item per term the pre-filters find in at least two sections, capped at `maxTerms`. The pre-filters in `src/judge/prefilter.ts` (`modalClash`, `sameThing`, `sharedTerms`, `termsAcross`) only order, cap and pick; they never raise or drop a finding.

`judgment.path` lists every step from the entry question to the deepest one. The finding's top-level `question`, `answer`, `confidence`, `status` and `defect` come from the deepest confident step that does not pass, else from the entry step. A passing answer records no `defect`, even when its question declares one. A step in `review` without a defect of its own, such as a benign answer at middling confidence, records its question's family defect: the question's `defect`, else the root of its policy defects (`consistency` for `pair.relation`). The review finding is thus counted under its family. Score questions also record `bandedConfidence`, the mass on the chosen side of the pass boundary. Once the loop ends:

- A parent whose follow-ups confirmed a defect drops to `info`, with `judgment.narrowedBy` naming each confirmed `<defect>@<subject>`.
- A flagged parent whose follow-ups all passed confidently goes to `review`.
- A parent whose follow-ups are unknown, in review or cut keeps its level.
- An item the budget cut before it was asked becomes `unknown` with provider `budget` and error code `budget`, so the readiness is not buildable. A finding whose queued follow-up was cut keeps its earlier step and carries `provenance.truncated: true`.
- A duplicate candidate (same question, subject and slice) is asked once, and its finding mirrors the first one.

`opts.limits` bounds the loop. Gated items are those the pair, section and term caps drop.

| Limit | Default |
|---|---|
| `maxRounds` | 6 |
| `maxCalls` | 500 provider calls, split retries included |
| `maxPairsPerSet` | 6 |
| `maxSections` | 12 |
| `maxCrossPairs` | 10 |
| `maxTerms` | 5 |
| `maxExplanations` | 10 |

With `opts.explainer`, confident `error` and `warning` findings whose defect lies under `consistency` or `coherence` are explained, errors first, up to `maxExplanations`. The text goes to `judgment.explanation` and the call's provider, model and usage to `provenance.explained`. A failed or throwing explainer leaves the finding unchanged apart from those two fields. Provenance also records the `round` and `stage` (`entry`, `self`, `members`, `pairs`, `sections`, `crossPairs` or `terms`) of the ask that settled the finding, and the `batch` size.

The fake provider takes per-question directives, which funnel tests put in node text so each slice carries its own: `#s1:<qid>=<key>` answers question `<qid>` with a choice key, `yes` or `no`, or a score level, and `#s1low:<qid>` makes that answer low-confidence. They win over the global `#s1low`, `#s1no`, `#s1pick:` and `#s1harm`. `test/judge/funnel.test.ts` walks a flagged set to a member, a contradicting pair and the `modal` leaf this way.

### Defects

`src/judge/defects.ts` holds `defects@1`, a three-level taxonomy of the ways a filled template can be wrong. Its five families are `instance`, `specificity`, `testability`, `consistency` and `coherence`. Each defect has an `id` (`family.category.leaf`), a `scope` (`node`, `set`, `pair`, `whole`), a `label`, a one-sentence `criterion` that serves as a choice option, and a `level`. The level defaults to `warning`, and children inherit their parent's scope and level. A template adjusts it with a `defects` block, merged across `extends`: `disable` is the union and `levels` are won by the nearest template.

```yaml
defects:
  disable: [coherence.termDrift]        # drops the defect and its subtree
  levels: { specificity.abstract: error }
```

`meta@1` rejects an unknown id in `defect`, a policy `defect`, `defects.disable` or `defects.levels`. It also rejects a `next.ask` or `batchWith` that names no declared question, a `next` cycle, and a `byKind` kind the template does not declare. `instance.otherKind.<kind>` counts as known for every declared kind.

## artyfact adapter

`loadArtyfactSystem(files, { templates })` takes a map of relative path to YAML text, so it runs in Workers; `readDir(root)` from `@artyfact/ontology/artyfact/node` builds that map in Node. Things, ontology nodes, externals, purposes, claims, requirements, criteria, hooks, journeys, steps (`<journey>/<step>`), evolutions, kits and artifacts become nodes. Cross links, beneficiaries, subjects, owners, source refs, acceptance criteria and resolved step targets become links; unresolved step targets stay as fields. Kits that are required but not pinned still become `kit` nodes.

The base template runs `artyfact.facts@1`, which derives `a`-prefixed artyfact relations from the generic graph, then `artyfact.metamodel@1`, `artyfact.readiness@1`, `artyfact.authorization@1`, `artyfact.journeys@1`, `artyfact.theory@1` and `artyfact.topology.private-pairs@1`. Rule ids and messages match artyfact. The dialect has no case folding, so the topology pack matches mixed-case patterns where artyfact lowercases text. The base template asks one question, `topology.multiRecipient`.

Not carried over: a cross link's `label` and `source`, whether `refines` came from a field or a cross link, and whether a thing's sections were defaulted from its template.

## Product specs

Two templates that share no vocabulary with artyfact, evaluated by the same engine without engine changes.

| Template | Loader | Input |
|---|---|---|
| `template.meta.product-spec@1` (`productSpec`) | `productGraphToGraph(json, opts?)` | A uip project graph or lfp `graph.json`: `{ nodes: [{id, kind, title, status, source, props}], edges: [{id, src, dst, type}] }` |
| `template.meta.bropilot-spaces@3` (`bropilotSpaces`) | `spacesGraphToGraph(json)` | The spaces schema of the bropilot-extract skill: `{ meta, nodes: [{id, kind, title, source, codeAlignment}], edges: [{srcId, dstId, type}] }` |

Both loaders add a synthetic root `$spec` of kind `spec` and make it the parent of every node, so "exactly one name" and "one purpose" are child cardinalities on `spec`. `source` is flattened into `source.kind`, `source.statements`, `source.reason` and `source.note`. `props` become `props.<key>` fields, because `props.status` exists on agents, tasks and test results alongside the node `status`. An edge status other than `committed` becomes the link's certainty. Edge ids, spaces edge labels and the lfp content version `v` are dropped.

`product-spec@1` takes its 42 kinds, prop enums and 24 edge types with their endpoint kinds verbatim from uip `src/data/ontology.json`. Its rules:

| Rule | Mechanism | Level |
|---|---|---|
| One `name`, one `purpose`, at most one `summary` and `design-system` | `spec` child cardinalities | `missing`, or `children.max` error |
| A purpose motivates an outcome; a test verifies a rule; a task targets a test | `requiredRel` | `missing` |
| Every rule is verified by a test | `verifies` in-cardinality `1..*` | `missing` |
| A term has a description | completeness field | `missing` |
| Evidence either supports or refutes, not both | `exactlyOne` | `missing` or error |
| `contains` has no cycles | `acyclic` | error |
| A bet references a metric, a module exposes an interface, a protocol is realised by a practice | `product.needs@1` | `missing` |
| An audience is served by a feature or capability, or has a flow | `product.checks@1` | `missing` |
| Status other than `committed` | `product.checks@1` `node.proposed` | warning |
| Self-loop, evidence verdict against its edge type, feature stages without a flow, a failing or missing test result no task targets | `product.checks@1` | warning or error |
| An outcome no metric monitors | `product.checks@1` candidate, question `outcome.measurable` | judged |

The question `outcome.measurable` asks System One whether the outcome is stated so that it can be measured. The slice is the outcome plus the purposes, problems, metrics and bets one link away. A confident yes passes and a confident no is a warning. An outcome that a metric monitors is decided by structure and never asked about.

`node.proposed` keeps an uncommitted node actionable but not buildable. `productGraphToGraph(json, { provisionalFlag: true })` also sets the engine's `provisional` flag, which makes such nodes `missing`.

`bropilot-spaces@3` is deliberately small. Its edges connect any kinds, `contains`, `extends` and `depends_on` are acyclic, `name` and `purpose` each need a `has` link, and `spaces.checks@1` reports `codeAlignment: broken` as a warning and `roadmap` as info.

## World snapshots

`src/adapters/world/` evaluates a world-core `WorldSnapshot` (bropilot `crates/world-core`; the contract types are copied into `src/adapters/world/contracts.ts`) and uses the Rust `evaluate_readiness` as its oracle.

`worldTemplateToMeta(snapshot)` turns the snapshot's World Template and Thing Templates into `template.world.<id>@<version>`, which extends `template.meta.world@1`. A non-numeric World Template version becomes meta version `0`.

| World Template | meta@1 |
|---|---|
| Object shape | Kind with `ws.title`, `ws.sourceKind`, `ws.sourceRef` and each required property as a required string field |
| Allowed relation endpoints | One relation per relation kind with the union of its entries' kinds, plus a `ws.endpoint` node per entry |
| Required relation | `requiredRel` with cardinality `1..*` on the subject kind, plus a `ws.requirement` node holding object kind and scope |
| Required relation scope | A `ws:scope:<id>` node; the constraint `core.mandatory-scope-incomplete` requires every `ws.scope` to be declared complete |
| Forbidden cycle | `forbiddenCycle` constraint with the Rust rule id |
| Incompatible constraint | `incompatible` on `ws.activeConstraints`, whose boolean fields are the constraint names the template mentions |
| Required Rule Pack | A `ws.requiredPack` node |
| Thing Template | A `ws.thingTemplate` node |

`template.meta.world@1` also carries the compiled Rule Pack catalogue as `ws.compiledPack` nodes, mirroring `compiled_rule_pack_catalog()`.

`worldSnapshotToGraph(snapshot)` keeps object ids, kinds, parents and properties. Relations become links, and a relation's source kind becomes the link certainty. Things, Rule Pack pins, the purpose, the environment, theory claims and the active constraints become `ws.*` nodes. Purpose beneficiaries and outcomes, the environment model and claim references become links that world-core checks by target kind. Completeness declarations become declarations on `ws:scope:<id>`. The template's prefilled nodes are included, so every derivation ends in EDB facts. The graph is a set, so the loader records each duplicated id as a `ws.duplicate` node. Lost on load: relation ids and sources, moves, and `ws.` as a usable prefix for World kinds and relations, which the converter rejects.

`world.readiness@1` reproduces every world-core check the core packs do not cover under the Rust finding code. `toWorldFindings(readiness, snapshot)` folds core and world findings into world-core's `(ruleId, severity, objectIds)`. A key is a `blocker` if any engine finding behind it is an `error`, else `unknown`. Findings with no world-core code are returned as `unmapped`.

| world-core status | Engine |
|---|---|
| `ready` | `actionable` |
| `blocked` | not `actionable`, at least one `error` |
| `unknown` | not `actionable`, no `error`, at least one `missing` |

`buildable` is stricter than `ready`. A world-core object's properties are open, and a meta@1 kind declares only the required ones, so every other property is a `field.unknown` warning.

The oracle files were generated in bropilot by `test/fixtures/world/regen.mjs` (not copied: it builds the Rust `bropilot-query`) and are frozen here; the snapshots are copies of bropilot's `packages/contracts/fixtures` in `test/fixtures/world/snapshots/`. It evaluated the eleven assistant snapshot fixtures and 37 single-change mutations of `assistant-valid` from `mutations.json`, and writes `expected/*.readiness.json`. `assistant-impact-evidence.json` holds evidence bindings, not a snapshot. `test/world.test.ts` requires the same `(ruleId, severity, objectIds)` set and the same status for every case, except these documented differences:

| Case | Engine | Why |
|---|---|---|
| An empty required property | Blocked by `core.shape-required-properties` | world-core tests key presence; the engine drops empty strings when it emits fields |
| An object of unknown kind with a Thing | Also `link.endpoint` on `ws.ofThing` | The link starts at a kind the relation does not list |
| A parent cycle | Blocked by `tree.cycle` | world-core does not check containment |
| A required relation whose endpoints exclude the subject kind | Form error `kind.relationUnsatisfiable`, no evaluation | world-core evaluates and reports a blocker per subject |

Untested edge cases where the two can differ: duplicate objects with different parents add `tree.multiParent`; a duplicated world object is one node, so `core.world-root` relies on `core.ids-unique`; an empty `worldId` or requirement field disables the rules that read it; and a relation with both endpoints missing is reported at both ends.

## Usage

```ts
import { checkTemplateForm, evaluate, loadTemplate, memoryStore } from "@artyfact/ontology";

const template = loadTemplate(rawTemplate, memoryStore([rawBaseTemplate]));
const form = checkTemplateForm(template);          // { valid, findings, hash }
const readiness = evaluate(template, graph);        // throws TemplateFormError if the form is invalid
for (const f of readiness.findings) console.log(f.level, f.rule, f.subject, f.message, f.pack);
```

## Fact relations

Graph set: `graphTemplate/1`, `node(Id, Kind, Parent)` with `""` for roots, `field(Node, Field, Value)`, `fieldType(Node, Field, Type)`, `parent/2`, `link(From, Rel, To, Certainty)`, `known/1`, `ref(From, Via, To)`, `declared(Scope, Status)`, `provisional/1`, `evidence(Id, Subject, Kind)`, and the text measurements `fieldLen(Node, Field, Chars)`, `fieldWords(Node, Field, Words)`, `fieldPlaceholder(Node, Field, Token)`, `fieldSameAs(Node, Field, OtherField)` (`OtherField` may be `"id"`) and `fieldPatternMiss(Node, Field)`, and, when the template declares checks, `checkCandidate(Rule, Subject, Text)` and `checkMiss(Rule, Subject, Severity)` (see "Criteria from the ontology"), which `checks@1` runs on beside the core packs.

Template set: `templateRef/1`, `kind/1`, `kindField(Kind, Field, Type, Required)`, `kindFieldEnum/3`, `kindParent/2`, `requiredField/2`, `requiredChild(Kind, Child, Min, Max)`, `requiredRel(Kind, Rel, Min, Max)`, `relation/1`, `relEndpoint(Rel, Side, Kind)`, `relCard(Rel, Dir, Min, Max)`, `relAcyclic/1`, `relInverse/2`, `relCertainty/2`, `forbiddenCycle/2`, `incompatible/4`, `incompatibleSize/2`, `exclusive/2`, `exactlyOne/4`, `completeScope/2`, `criterion/4`, `criterionGate/2`, `criterionHook/2`, `question/2`, `defect(Id, Parent, Scope, Level)` (the merged taxonomy, `""` for roots), `questionDefect/2`, `questionNext/2`, `typeAccepts/2`, `textMinLen(Kind, Field, N)`, `textMinWords(Kind, Field, N)`, `textDistinct(Kind, Field, Other)`, `textPattern(Kind, Field)`.

Form set, used only by `meta@1`: includes `questionSliceKind/2`, `questionSliceRel/2` and `templateNodeLink/2`, so a slice or a prefilled node that names an unknown kind or relation is a form error, and `textBound/4`, `textPatternInvalid/2`, `textDistinctDecl/3` and `textDefaultDistinct/2`, the text constraints as written, and `checkIdDuplicate/1`, `checkDefect/2`, `checkWhenField/3`, `checkPatternInvalid/1` and `checkLevelUnknown/2`, the checks as written.

The exact declarations are `EDB_DECLS`. An unbounded maximum is `-1`. Field values are encoded as `sym`: numbers and booleans as their string form, objects as canonical JSON, and each list element as its own `field` row. A link without `certainty` takes the relation's default, else `declared`.

Template rule packs run in their own evaluation after the core packs. They may read the relations above and relations they derive themselves, and they must `.decl` what they read. They output `violation(Rule, Subject, Severity)`, `missing(Rule, Subject)`, `warning(Rule, Subject)` or `semanticCandidate(Rule, Subject, Text)`.

## Text quality

A graph whose nodes exist but whose text is blank, placeholder or lazy is incomplete without any model. A kind field may declare, and `text@1` checks on every evaluation:

| Key | Meaning | Rule | Level |
|---|---|---|---|
| `required` (existing) | A whitespace-only value is blank | `text.empty` | `missing` |
| `minLength` | Trimmed length in code points | `text.short` | `missing` |
| `minWords` | Whitespace-separated tokens with a letter or digit | `text.short` | `missing` |
| `placeholders` | Case-insensitive tokens or phrases; the trimmed value equals one or contains it as a whole word | `text.placeholder` | `missing` |
| `distinctFrom` | Other fields of the kind or `"id"`; equal after lower-casing and collapsing every run of non-letters and non-digits | `text.sameAsId`, `text.sameAsField` | soft, `warning` |
| `pattern` | A JavaScript regular expression source, no flags, tested against the trimmed value | `text.pattern` | hard, `error` |

A template opts into defaults with `textDefaults`, which takes the same keys and applies to every declared `string` field named `description` or `title`. `textDefaults: {}` turns on the engine placeholder list (`DEFAULT_PLACEHOLDERS`: tbd, todo, tba, fixme, xxx, ???, lorem ipsum, placeholder, n/a, none yet, to be defined, to be determined); `placeholders` replaces it. A field's own keys win key by key. A default `distinctFrom` keeps only `"id"` and fields the kind declares, never the field itself. Through `extends`, the nearest `textDefaults` wins wholesale. Without `textDefaults`, only what fields declare applies.

The Datalog dialect has no string functions, so `toFacts` computes the measurements. Length and words are emitted for every non-empty scalar string in a constrained or required field; placeholder, sameness and pattern facts only for constrained fields that are not blank. Findings name the node, once per rule; the field and the measurement are derivation leaves.

One blank field gives one finding. An empty string is not emitted as a field, so `field.required` from `completeness@1` reports it. A whitespace-only value is a field, so completeness is satisfied and `text.empty` reports it. Every other text rule needs a non-blank value, and a placeholder is not also reported as short. A blank optional field is silent, like an absent one. `text.empty` needs no opt-in: it applies to every required field.

Form errors in `meta@1`: `kind.textBoundNegative`, `kind.textPatternInvalid`, `kind.textDistinctUnknown` and `kind.textDistinctSelf`, and `template.textBoundNegative`, `template.textPatternInvalid` and `template.textDistinctUnknown` for `textDefaults`, where an unknown field is one no kind declares.

`test/text.test.ts` runs degraded copies of Peopling's `ontology.yaml` and of `tidepool.graph.json` (`test/fixtures/text/degrade.mjs` regenerates them) under test-local templates with the defaults on. On real content the only hit is Peopling's `binding.d1`, whose description is "Template placeholder, superseded by binding.contactsStore": a whole-word match on prose that describes a placeholder node.

## Semantic probes and providers

Some problems need judgment rather than structure: an item that is not what its kind says, a statement too abstract to build, an outcome nobody can measure, parts that cannot all hold. `src/judge/catalogue.ts` holds the reusable `meta@1` questions and `src/judge/probe.ts` the `semantic.probe@2` pack that emits their stage-1 candidates. The judgment funnel walks from a stage-1 answer down the defects@1 tree through `next`.

A template includes them with `withSemanticProbes(source, options)`, which appends the hand-written questions, one generated `which:` question per non-leaf defect, and the configured pack; questions or a pack the template already declares under the same id win. The pack fires a rule only when the template declares its question, so `rules` narrows the hand-written set.

```ts
import { loadTemplate, productSpec, withSemanticProbes } from "@artyfact/ontology";

const template = loadTemplate(withSemanticProbes(productSpec, {
  texts: ["description"],                        // fields holding statements; each list element is one statement
  fields: ["title", "description"],              // what every slice node shows the provider
  kinds: {                                       // the glossary: asked node.kind, and node.tangibility unless tangible: false
    outcome: {
      noun: "outcome",                           // {noun} in the question text
      instanceOf: "An outcome is a change in the world the product aims for, not something the team delivers.", // {instanceOf}
      grounded: "It names who changes, how, and how the change would be observed.", // {grounded}, in score level 4
    },
    claim: { noun: "claim", minScore: 2 },       // node.tangibility passes from 2 for this kind (default 3)
    summary: { noun: "summary", tangible: false }, // section-like: no tangibility score
  },
  measurable: ["outcome", "goal", "hypothesis"], // kinds asked text.unmeasurable
  criteria: ["rule", "test"],                    // kinds asked criterion.unfalsifiable
  purposeKinds: ["feature", "capability", "outcome"], // kinds asked node.purpose, shown the "purpose" nodes (purposeAnchors)
  sets: ["*"],                                   // kinds whose nodes with >= 2 texted children are asked set.allHold
  sections: true,                                // a root with >= 2 children is asked sections.allHold (and is not a set)
  probePairs: [],                                // relations whose two ends are asked pair.relation; also its slice rels
  defects: { disable: ["coherence.termDrift"], levels: { "consistency.tension": "error" } },
}));
```

Defaults: `texts: ["description"]`, `measurable: ["outcome", "claim", "criterion"]`, `criteria: ["criterion"]`, the glossary the template's kind `criteria` declare (see below), and no sets, sections, purpose kinds or pairs. The glossary compiles into `byKind` (a JSON `{noun, instanceOf?, grounded?, testable?, children?, pairs?, summary?}` per kind) and `minScore` into `passFrom` on `node.tangibility`; `passFromOf(question, kind)` and `decide(question, answer, thresholds, kind)` read it. The glossary also adds one `instance.otherKind.<kind>` leaf per kind. `defects` merges into the template's own block; a question whose own defect is disabled is dropped, a policy entry for a disabled defect passes, and `next` or `batchWith` references to dropped questions are removed.

Stage-1 questions (the probe raises candidates for these only):

| Rule | Asked of | Answer | Benign | Harmful answers | Next |
|---|---|---|---|---|---|
| `node.kind` | Statements of glossary kinds | yes-no: a genuine `{noun}`? | yes | no: `instance` | `which:instance` |
| `node.tangibility` | Statements of tangible glossary kinds | score 0-4, level 4 takes `{grounded}` | 4 | 0-2: `specificity` (below `passFrom`) | score <= 2: `which:specificity` |
| `text.unmeasurable` | Statements of `measurable` kinds | yes-no: measurable as stated? | yes | no: `testability.unmeasurable` | `which:testability.unmeasurable` |
| `criterion.unfalsifiable` | Statements of `criteria` kinds | yes-no: unfalsifiable? | no | yes: `testability.unfalsifiable` | `which:testability.unfalsifiable` |
| `node.purpose` | Statements of `purposeKinds`; slice anchors the purpose | on-purpose / implied / off-purpose | on-purpose | off-purpose: `coherence.purposeDrift` | `which:coherence.purposeDrift` |
| `set.allHold` | Parents of `sets` kinds with >= 2 texted children; batched with `set.inconsistent` and `parent.summary` | yes-no | yes | no: `consistency` | `set.member` |
| `sections.allHold` | The root with >= 2 children when `sections`; batched with `sections.inconsistent` and `sections.which` | yes-no | yes | no: `consistency` | `sections.section` |
| `pair.relation` | Ends of a `probePairs` link, smaller id first | compatible / contradiction / tension / duplicate / circular / scopeClash / unclear | compatible | each: `consistency.<answer>`; unclear is `review` | `which:consistency.<answer>` |

Follow-up and companion questions raise no candidate of their own: `set.inconsistent`, `parent.summary` (matches / omits / contradicts / overclaims / stale), `set.member` (options are the subject's members, `choicesFrom: "members"`, then pairs `pair.relation`), `sections.inconsistent`, `sections.which` (level 2 of consistency and coherence, or none), `sections.section` and `sections.other` (`choicesFrom: "sections"`, then `pair.relation` over the two sections), and `term.usage` (consistent / drift / unclear, candidates from the funnel's pre-filter, drift goes to `which:coherence.termDrift`, unclear is `review`). A `next` without `answer` or `maxScore` fires on any answer other than the benign one. A picker's policy maps `"*"` (any answer no other entry names) to `info`. A policy may map an answer to `review` (a person decides). `meta@1` warns with `question.choiceUnmapped` when a declared choice has no policy entry and no `"*"` entry, and errors with `question.benignInvalid` when `benign` is not yes or no (yes-no), not an integer level index within `choices` (score), or not a declared choice (choice without `choicesFrom`).

`generatedQuestions(defects)` builds `which:<id>` for every non-leaf defect without a deterministic rule (so not `instance.placeholder`): a choice over the children's labels plus `none`, each option sent with the child's criterion (`criteria`, at most 255 characters), `none` passes, each child maps to its level with `defect: child.id`, and `next` descends into non-leaf children. The slice follows the defect's scope: node `{parents, hops: 0}`, set `{parents, children}`, pair `{parents, hops: 1, rels: probePairs}`, whole `{children}` without parents. `toWire(question, kind?, resolved?)` sends per-option `criteria` and, for a `choicesFrom` question, the resolved options (ids, or ids mapped to criteria) followed by its declared `choices`.

`text.vague` and `pair.contradiction` remain as v1 entries. `withSemanticProbes(source, { version: "1", siblings, ... })` gives the v1 catalogue (`SEMANTIC_RULES_V1`) and `semantic.probe@1`, which asks `text.vague` of every statement, `text.unmeasurable` and `criterion.unfalsifiable` as above, and `pair.contradiction` of same-parent siblings of the `siblings` kinds and of `probePairs` ends.

A pair rule's id starts with `pair.`. The dialect cannot build strings, so the pack emits `semanticCandidate(Rule, A, B)` with `A < B` and the second node in the text column; `evaluate` reports the candidate on `A`. `judge` joins the two into the subject `A|B`, and `buildSlice` resolves a subject that is not itself a node but splits at `|` into two nodes: `subject` is `A`, `counterpart` is `B`, and parents and hops start from both.

### Criteria from the ontology

The template's criteria are the author's checklist. `kinds.<k>.checks` lists what a good node of the kind must contain, and `rootChecks` does the same for the nodes without a parent. Each check is applied as its own check at its level:

| Check | Applied to | Finding |
|---|---|---|
| `scope: "node"` (default) | every node of the kind where `when` holds and the field (default `description`) has text | `check:<kind>.<id>` on the node |
| `scope: "children"` | every node of the kind with at least one matching child, the children as members | on the parent |
| `scope: "pair"` | every two matching children of one node of the kind | on the pair, `a\|b` |

A check with `pattern` is deterministic: `checks@1` reports a miss as `check:<kind>.<id>` at the check's `level` (default warning), with no provider call; children and pair scope test each matching child. A check without `pattern` becomes a `semantic:check:<kind>.<id>` candidate. `withSemanticProbes` (and `checkQuestions(template)` on its own) adds one question per such check, "Does state.subject, a {noun}, satisfy this criterion: <text>?", whose failing answer maps to the check's level and defect (default `instance`, or `consistency` for children and pair scope). `na: true` adds a passing `notApplicable` answer, and the judged finding carries `judgment.check`. Node checks share the node questions' slice and children checks the set questions' slice, so the funnel batches them per subject. `when: { kind?, field?, pattern? }` limits where a check applies; for children and pair scope it filters the children. Checks merge by id through `extends`. `meta@1` reports `check.idDuplicate`, `check.defectUnknown`, `check.whenFieldUnknown`, `check.patternInvalid` and `check.levelUnknown`. A template without checks keeps its hash and does not run `checks@1`. `productSpec` carries `PRODUCT_KIND_CHECKS` and `artyfactGenome` carries `ARTYFACT_CHECKS`.

The general layer's wording also comes from the template. Each kind may declare `criteria`, and the template may declare `rootCriteria`; each value is one sentence (`meta@1` warns with `criteria.tooLong` past 255 characters and errors with `criteria.minScoreRange` when `minScore` is outside 0 to 4).

| Key | Token | Worded into |
|---|---|---|
| `noun` | `{noun}` | `node.kind`, `node.tangibility` (default: the kind name) |
| `instanceOf` | `{instanceOf}` | `node.kind` |
| `grounded` | `{grounded}` | `node.tangibility` level 4 |
| `tangible`, `minScore` | | whether `node.tangibility` is asked, and its pass boundary |
| `testable` | `{testable}` | `text.unmeasurable`, `criterion.unfalsifiable` |
| `children` | `{children}` | `set.allHold`, `set.inconsistent` asked of a node of this kind |
| `summary` | `{summary}` | `parent.summary` asked of a node of this kind |
| `pairs` | `{pairs}` | `pair.relation` asked of two children of this kind (kinds declared through `parents` or `completeness.children`) |
| `rootCriteria.sections` | `{sections}` | `sections.allHold`, `sections.inconsistent` |
| `rootCriteria.terms` | `{terms}` | `term.usage` |

An absent criterion substitutes as nothing and the generic stem is sent unchanged. The defect criteria of `defects@1` stay the answer options; the ontology's criteria shape the question. Kind criteria merge key by key through `extends`. Without a `kinds` option, the glossary is every kind whose criteria declare `noun` or `instanceOf`; a `kinds` option chooses the glossary kinds and overrides their wording key by key (`kindGlossary`, `compileKinds(kinds, templateKinds)`). `productSpec` (`PRODUCT_CRITERIA`, `PRODUCT_ROOT_CRITERIA`), `artyfactGenome` (`ARTYFACT_CRITERIA`) and `worldTemplateSource` (`WORLD_KIND_CRITERIA`) carry their criteria. How to write checks and criteria: `docs/writing-an-ontology.md` in this package.

### Providers

`openRouterProvider({ apiKey, model?, fetch?, concurrency? })` calls the OpenRouter Decisions API, `POST https://openrouter.ai/api/alpha/decisions` with `{ model, state, questions }`. The default model is `perplexity/pplx-decider-v1.1-27b`. Yes-no questions go as `noul`, choice as `choice` and score as `score`. A score comes back as an expected value, so the provider reports the most probable level, which is what policy keys match. Timeouts, 429 and 5xx are retried; an error body, a non-JSON body or an answer that does not fit its primitive is an `S1Error`, which `judge` records as an unknown judgment with provider `error`. Requests in flight are capped at `concurrency` (default 4) because `judge` asks every candidate at once. The key is used only in the `Authorization` header. It is never part of a reply, provenance or the provider object, and it is redacted from error messages.

`workersAiProvider(ai, model?)` runs Cloudflare Clef through a Workers AI binding: `ai.run("@cf/cloudflare/clef", {model: "clef", state, questions, images?})`. It accepts `@cf/cloudflare/clef-flash` as the 9B model. It shares stripping, caching and retries with the HTTP providers. It is the one provider with `images: true`, and it sends `AskOptions.images` as `{content_type, base64}` entries. `checkImages` enforces Clef's limits: at most 4 images, PNG, JPEG or WebP, 4 MiB each and 8 MiB in all. Every other provider refuses images with an `unsupported` `S1Error` instead of answering without them.

`providerFromEnv(env)`: `FAKE_S1=1` gives the fake provider. `S1_PROVIDER` then names one (`clef`, `jev`, `openrouter`, `fake`, `off`); a named one without its key or binding is `offSystemOne(reason)`, never another provider. `jev` is TypeSafe (`JEV_MODEL` or `jev-latest`) with `TYPESAFE_API_KEY`, else OpenRouter's Decisions API (`JEV_OPENROUTER_MODEL`, `typesafe/jev-1.13`) with `OPENROUTER_API_KEY`. `simulatedSystemOne()` is the fake recorded as provider `simulated` (the hosted demo). Unset or `auto` follows artyfact's precedence: `TYPESAFE_API_KEY` gives TypeSafe (`https://api.typesafe.ai/v1/systemone`, `jev-latest`), then an `AI` binding gives Clef (`CLEF_MODEL` or `@cf/cloudflare/clef`), then `OPENROUTER_API_KEY` gives OpenRouter with `OPENROUTER_MODEL` or the default, else the provider is off. `visionProviderFromEnv(env)` keeps the selected provider when it reads images or is off, and otherwise picks Clef when `AI` is bound. Absent keys never select the fake. Real providers strip fake directives (`#s1…`) from the state they send.

### Explanations

An explainer turns one confirmed finding into at most three sentences that name the inconsistent statements by node id. It is advisory only: an explanation is never read for a finding's level or status, and an explainer never throws, so a failed call comes back as a result with provider `error`. `judge` calls it through `opts.explainer` (see the funnel above).

`openRouterExplainer({ apiKey, model?, fetch?, concurrency?, maxTokens?, timeoutMs? })` posts to OpenRouter chat completions with temperature 0, 200 output tokens, a 10 second timeout and two requests in flight by default. It shares timeouts, retries, key redaction and caching with `openRouterProvider`. The default model `openai/gpt-6-luna` must be checked against the OpenRouter model list before the first live run. `fakeExplainer()` and `offExplainer()` need no network.

`explainerFromEnv(env)` reads these variables:

- `EXPLAIN=0` turns explanations off, whatever else is set.
- `FAKE_S1=1` gives the fake explainer.
- `OPENROUTER_API_KEY` gives OpenRouter, with the model from `OPENROUTER_EXPLAIN_MODEL` or the default.
- With none of these, explanations are off.

### Live suite

`test/fixtures/semantic/` holds degraded copies of the three vocabularies with planted problems and clean controls: the Peopling YAML directory, tidepool's product graph and the `assistant-valid` world snapshot. Each `*.expectations.json` names every planted problem's rule, subjects, expected level and expected defect (an id or a list of alternatives), the controls, and `calls`, the provider-call envelope for one run. A plant on one of the template's checks names it in `check` and counts only through that check's own finding; a pattern check's plant is found without a provider. A plant reached through a set or the sections root names that stage-1 `entry`; so does a plant on a companion question such as `parent.summary`, which settles as its own finding when its answer does not pass. `test/semantic/vocabularies.ts` sets the probe options per vocabulary: `SETTINGS` (v2, with each vocabulary's glossary) and `SETTINGS_V1`. Without a key, `test/semantic/probe.test.ts` pins the v2 stage-1 candidate counts per fixture and rule, check candidates included, and checks that every plant has a stage-1 route. It also checks that the v1 pack emits exactly the candidates its options select. `test/judge/catalogue.test.ts` checks the generated questions and that each vocabulary's v2 template passes `meta@1` with no findings.

`test/semantic/live.test.ts` is skipped unless `ONTOLOGY_LIVE=1` and `OPENROUTER_API_KEY` are both set (`pnpm run test:live` sets the first), so `pnpm test` never calls a paid API because a key happens to be in the environment. It judges each degraded fixture through the v2 funnel with default `limits`, taking the provider from `providerFromEnv` and the explainer from `explainerFromEnv`. Detection works per plant:

- **Confident** means a finding on the planted subject or subjects carries the planted defect at the planted level. A prefix match counts, so a plant of `specificity` matches `specificity.abstract.intentOnly`.
- **Review** means a finding on the planted subjects, or on its `entry`, is in review. It must also have a harmful answer on the planted rule or on any step of its `judgment.path`, or carry a defect on the planted defect's branch. The branch includes ancestors, because a review finding stops at its question's family defect: `instance` on a `node.kind` plant of `instance.otherKind`, or `consistency` on a `pair.relation` plant of `consistency.contradiction`. Confident detection keeps the strict rule.

The suite asserts that no plant is missed and that no control is at `warning` or `error`. Controls that land in review are recorded, not failed. The call envelope is a soft assertion.

Results go to `test/fixtures/semantic/live-results.v2.<model>.json` with `model`, `explainModel`, `startedAt`, `finishedAt`, `thresholds`, `limits`, `ask`, `calls`, `verdicts`, `detected`, `answers` and `explanations`. `detected` holds `confident`, `review` and `missed` per vocabulary. Each answer records its call, question, subject, statement, batch size, probabilities, confidence, round, stage, defect, banded confidence, path length, latency, model and input tokens. Each verdict holds the funnel's calls, rounds, gated count, budget and explanations, plus every plant's detection and every control's flagged and review findings. The `live-results.<model>.json` files without `v2` are the v1 audit records and stay as committed.

| Variable | Effect |
|---|---|
| `ONTOLOGY_LIVE=1` and `OPENROUTER_API_KEY` | Run the suite; without both it is skipped |
| `OPENROUTER_MODEL` | Decision model, default `perplexity/pplx-decider-v1.1-27b` |
| `OPENROUTER_EXPLAIN_MODEL` | Explainer model, default `openai/gpt-6-luna` |
| `EXPLAIN=0` | Turns explanations off |

```sh
OPENROUTER_API_KEY=… pnpm --filter @artyfact/ontology test:live
OPENROUTER_API_KEY=… OPENROUTER_MODEL=cloudflare/clef pnpm --filter @artyfact/ontology test:live
```

The committed v1 run made 261 calls before retries: 233 for Peopling, 18 for tidepool and 10 for the world snapshot. The v2 plants added since raise the v1 counts to 236, 21 and 11, which `probe.test.ts` pins. Those requests totalled about 430,000 characters, roughly 110,000 input tokens. Decision models bill input tokens only, so a v1 run cost about half a cent on `perplexity/pplx-decider-v1.1-27b` at $0.04 per million and about three cents on `cloudflare/clef` at $0.24 per million.

## Routing changes

`route(graph, template, message, s1, opts)` in `src/route/` finds which part of the graph a user message concerns with a few small System One choice questions, each showing only one level's options, so a small model never sees the whole graph. Product graphs are split into spaces by `PRODUCT_SPACES`, the lfp kernel's kind-to-space map. World snapshots use the root's sections, plus the root itself for top-level additions. A route records every question, answer and distribution, its target space, kind and nodes, and a status, which is the lowest status of its deciding steps. It makes at most 8 calls.

There are three orders.

- **`shortlist-first` (default):** one question over the 12 nodes sharing the most words with the message (title, description and kind name). A picked node fixes the space and kind, and the intent comes last. For an add, one more question asks the new item's kind. With no shortlist, or `none`, it falls back to the intent-last chain. In that fallback, an unknown space falls back to a kind question over every kind, and a low-confidence `new` is settled by the anchor question.
- **`intent-last`:** space, kind and node, then the intent with the picked nodes' titles and descriptions in view. For an add with nothing picked, one more question picks the anchor in the space.
- **`intent-first`:** the intent first, then space, kind and node. A `question` or `unclear` intent ends the route there.

In every order, navigation goes on past `review` answers and stops on `unknown` unless `continueOnReview: false` is set.

A `Translator` turns the message and route into ops (`add`, `update`, `remove`, `link`, `unlink`), a question or an answer. It sees only the targets, their parents and one hop. `openRouterTranslator` defaults to `openai/gpt-6-luna`, and `translatorFromEnv` reads `TRANSLATE=0`, `FAKE_S1` and `OPENROUTER_TRANSLATE_MODEL`. `validateOps` checks proposed ops against the template and graph.

The gold sets in `test/fixtures/route/*.cases.json` drive `evalRoute`, which scores intent, space, kind, nodes and translated ops per case and difficulty. Oracle mode replays the gold through a scripted provider and must route every case in every order. `npm run test:route:live` writes `results.<model>[.<translate-model>].<order>.json` for each order, and `ROUTE_ORDER` narrows which orders run.

## Readiness

Levels are `error`, `missing`, `warning`, `review`, `info` and `pass`; `review` and `pass` come only from judgment. Severity `hard` maps to `error`, `soft` to `warning` and `advisory` to `info`. `actionable` means no `error` or `missing` finding. `buildable` additionally requires no `warning`, no `review` and no semantic candidate without a confident judgment. Both are false when evaluation stops at `maxIterations` (`incomplete: true`).

## Tests

```sh
pnpm --filter @artyfact/ontology test
pnpm exec tsc -b packages/ontology
```
