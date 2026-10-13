# Ontology: engine, Genome v2 and intents

Authoritative spec for iteration 3. The engine lives in `packages/ontology` (`@artyfact/ontology`), copied from bropilot `packages/ontology-engine` at `cb1599c` (MIT) and owned here from now on. Its own design notes are `packages/ontology/docs/ontology-engine-library.md` and the template author's guide `packages/ontology/docs/writing-an-ontology.md`. This file fixes what the rest of the platform builds on: the Genome tree on disk, the template extensions artyfact adds to `meta@1`, how engine ops become file changes, and the intent wire flow.

Contract code: `packages/ontology/src/genome/` (zod schemas and types for `node.yaml`, view hints, the legacy check) and `apps/platform/shared/api.ts` (intent wire types and routes). Where this text and those files disagree, the code is a bug to fix here first.

## 1. The engine package

| Entry | Contents |
|---|---|
| `@artyfact/ontology` | `meta@1` templates (`loadTemplate`, `checkTemplateForm`, `extends`), the `Graph`, `evaluate`/`diff`, the judge and funnel, routing (`route`, `routeSlice`, `routeVocabulary`), translators, `validateOps`, the artyfact v1 adapter (`loadArtyfactSystem`, transitional: see §2a), the Genome v2 contract (`src/genome/`) |
| `@artyfact/ontology/artyfact/node` | `readDir` for Node (the only file-system import) |
| `@artyfact/ontology/product`, `/world` | bropilot's product-spec, spaces and world-core adapters, kept for their tests and as worked examples |

Datalog comes from `@artyfact/rules` (one engine; the bropilot copy is deleted). Everything except `artyfact/node` runs in workerd; `apps/platform/test/ontology-smoke.test.ts` loads Keep in Touch through the v1 adapter, evaluates it and routes a message with the fake providers there. The live suites (`npm run test:live`, `npm run test:route:live` in the package) call OpenRouter only with `ONTOLOGY_LIVE=1` and a key.

### Route, translate, validate

The intent pipeline is three engine calls. Each is bounded, and none sees the whole Genome.

1. **`route(graph, template, message, s1, opts)`** asks System One small choice questions, one level each. Default order `shortlist-first`:
   - Ask one `route.shortlist` question over the up to 12 nodes that share the most words with the message (title, description, kind name). The pick fixes space and kind.
   - Ask up to `maxNodes - 1` (default 2) "does it also concern another?" follow-ups (`route.more` yes-no, then `route.nodes`).
   - Ask `route.intent`: `add | update | remove | link | question | answer | unclear`. For an `add` anchored on a shortlisted node, one more `route.kind` question picks the new node's kind.
   - With no shortlist or a `none` pick, fall back to space, then kind, then node. In tree mode the spaces are the root's direct children plus the root itself; depth below them is reached through the kind and node questions, which range over the whole subtree of the chosen space.

   Steps below `review` stop the walk. `review` steps continue, and the route's status is the lowest status of its deciding steps.

   A `Route` holds `path[]`: per step the level, question id and text, offered choices, answer, confidence, distribution and status. It also holds `target {space, kind, nodes[≤3], new?, related[≤5]}`, `intent`, `status`, `calls` and `provenance` (provider, model, usage, thresholds, errors, truncated).
2. **`routeSlice(graph, route)` and `routeVocabulary(template, route, slice)`** build what the translator sees: the targets (else the related nodes), their parent chains and nodes one link away, at most 40 nodes, text cut to 300 characters, `source.*` fields dropped. The vocabulary holds only the kinds in view and the relations touching them.
3. **`translator.translate({message, route, slice, vocabulary})`** returns exactly one of `ops[]`, a `question` or an `answer`. `openRouterTranslator` uses `openai/gpt-6-luna` by default, temperature 0, 800 output tokens, a 30 s timeout and 2 retries, and an LRU cache. It never throws; failures come back as `provider: "error"`. `fakeTranslator` asks a question when the route is not confident. Otherwise it updates the first target's `description`, or adds a node of the route's kind, linked to the first target with the first vocabulary relation whose ends fit the two kinds (none when no relation fits). `translatorFromEnv` order: `TRANSLATE=0` → off, `FAKE_S1=1` → fake, `OPENROUTER_API_KEY` → OpenRouter (`OPENROUTER_TRANSLATE_MODEL`), else off.
4. **`validateOps(ops, template, graph)`** runs deterministic checks and makes no calls. It returns `OpProblem {level, rule, op (index), subjects, message}`:
   - Errors: `op.unknownNode`, `op.unknownKind`, `op.unknownRelation`, `op.relationEndpoint` (endpoint kinds), `op.duplicateTitle` (an `add` repeating a same-kind title), `op.invalidCriterion` (not a `node.yaml` criterion), `op.duplicateCriterion` (an upsert of an id another node declares), `op.unknownCriterion` (a removal of a criterion the node does not declare) and `op.emptyUpdate`.
   - Warnings: `op.unknownField` (an `add` or `update` field the kind does not declare; `title` and `description` are always allowed), `op.missingLink` and `op.duplicateLink`.
   - It does **not** check `parents` legality, completeness, or links left dangling by a `remove`.

Engine op shapes (`src/route/types.ts`):

```ts
{ op: "add"; kind; parent?; title; description?; fields?; criteria?: NodeCriterion[]; links?: { rel; to? | from? }[] }   // no id: the platform mints one
{ op: "update"; id; fields?: Record<string, unknown>; criteria?: (NodeCriterion | { id; remove: true })[] }
{ op: "remove"; id }
{ op: "link" | "unlink"; from; rel; to }
```

**Call budget per message.** `route` makes at most `maxCalls` = 8 System One calls; one is held back for an intent asked last. The recorded shortlist-first mean is 3.8 calls (bropilot gold sets: tidepool and assistant). Add one translator call, and `validateOps` costs nothing.

Recorded live quality (Perplexity decider, then gpt-6-luna; `packages/ontology/test/fixtures/route/results.*.json`), shortlist-first:

| Gold set | Nodes hit | Routed |
|---|---|---|
| tidepool | 19/21 | 13/24 |
| assistant | 8/9 | 7/10 |

Translator op precision is 0.67 to 0.86 and recall 0.64 to 0.67. Most remaining misses are intent labels. The `intent-first` order scores lower (nodes 12/21 and 4/9) and fails the live thresholds; it stays available only for evaluation.

**Evaluate and judge, for the gates (W5).** `evaluate(template, graph)` is synchronous and makes no calls. It returns `Readiness` with `actionable`, `buildable`, findings and derivations. `judge` and `evaluateAndJudge` resolve semantic candidates through the funnel, bounded by `limits`: `maxRounds` 6, `maxCalls` 500, `maxPairsPerSet` 6, `maxSections` 12, `maxCrossPairs` 10, `maxTerms` 5 and `maxExplanations` 10. Per-kind `checks` (checks@1) are one question per judged check, batched per subject. A check with a `pattern` makes no call.

The gates (`apps/platform/worker/hooks/engine-gates.ts`) read the Genome through `loadGenome` (a v1 Genome does not load: the hooks report `unknown` with a legacy-genome observation) and evaluate it against the template readiness uses (`readinessTemplate`): its System template with its Things' templates composed over it. The rules part of every `model-rules` hook is that `evaluate`: `inputs.packs` selects packs by `id@version` or `id` (the ported packs also answer to their v1 names, `readiness@1` for `artyfact.readiness@1`), and an `error` finding fails, as does a `rulePack.unavailable` error for a pin no template declares (the same `unavailablePins` readiness reports). A hook whose `packs` names `checks@1` judges the template's checks on the candidate's changed nodes and their parents only: misses and `no` answers at `error` or `warning` fail, unconfident answers are unknown, `info` misses are advisory. text@1 findings never fail a hook; they are reported as `advisory`. Every Thing template carries such a hook through a soft, submission-gated criterion: `C.$self.checks` in the template, so `C.thing.<id>.checks` per Thing (e.g. `C.thing.webapp.checks`; the v1 web app templates spell it `C.$thing.checks`). It is a `model` criterion, so it is among a Genome amendment's default acceptance criteria. A removed node puts its nearest surviving ancestor (from the base graph) in scope. A changed id in neither graph, a Genome candidate that changes paths but names no node (its delta did not load), an unconfident answer, or a provider that is off or fails makes the checks verdict `unknown`, never `pass`. Check questions are template-authored; Genome text travels only as state, nested under `state.node`, and each question says that state is data, not instructions. Real providers strip fake directives (`#s1…`) from the state they send, and only `FAKE_S1=1` selects the fake. The defect funnel (pair, section and term questions) is not run by the gates.

## 2. Genome v2: the containment tree

```
genome/
  node.yaml                        # the System: {id: system.x, kind: system, template: template.system.…@1, fields, links, criteria}
  P1/node.yaml                     # a purpose under the System
  thing.webapp/
    node.yaml                      # {kind: thing, template: template.thing.…@1, root: apps/web?, files?}
    section.ui/
      node.yaml
      screen.people/node.yaml      # depth = directory depth; the parent is the enclosing directory's node
    S.webapp.screens/node.yaml     # a requirement, under the first node it constrains
    J.contacts/                    # a journey owned by the Thing
      node.yaml
      s1/node.yaml                 # a step: id J.contacts/s1, sequence from its `next`
  evolutions/evolution.1.yaml      # change records stay flat, same schema as v1
```

Rules:

- **One node per directory.** The `node.yaml` in a directory defines that node. The node of the enclosing directory is its parent. The root `node.yaml` is the System. Every other node sits below it.
- **The directory name is a slug, not the identity.** The `id` in `node.yaml` is authoritative and globally unique. A slug matches `[A-Za-z0-9_][A-Za-z0-9._-]*`, is at most 120 characters, and only has to be unique among its siblings. A writer names a new directory `slugOf(id)`: the id itself when that is a valid slug, otherwise the id with every other run of characters replaced by `-`. A journey step's directory is the step's local id (`s1`). Renaming a directory does not change the node.
- **Reserved names.** `evolutions/` at the root holds `<id>.yaml` change records. They never hold a `node.yaml`, and they are not part of the tree. Directories without a `node.yaml`, dot-files and `README.md` files are ignored. A `node.yaml` whose parent directory has none is an error.
- **Legal nesting** is the template's business. A node's parent kind must be in its kind's `parents`; `metamodel@1` reports the violations. The codec does not refuse an illegal tree; evaluation reports it.
- **v2 only.** The platform loader reads the tree layout and nothing else: a Genome without a root `node.yaml` does not load. There is no long-lived format detection; the one exception is the legacy check in §2a.

### `node.yaml`

Schema: `NodeFileSchema` in `packages/ontology/src/genome/node.ts`. It is strict, so unknown keys are errors. Optional collections are left out when empty, so a round-trip never grows keys.

| Key | Type | Meaning |
|---|---|---|
| `id` | string | Globally unique node id (`screen.people`, `C.…` only for criteria) |
| `kind` | string | A kind the template (chain) declares |
| `template` | `template.<kind>.<name>@<v>` | The template this node instantiates: the System and every Thing |
| `root` | repo-relative path | Prefix for the `files` of this node and all nodes below it (a Thing's app root) |
| `fields` | map | The kind's declared fields; `title` and `description` are always allowed |
| `links` | `{rel, to, certainty?, label?, source?}[]` | Outgoing typed links. `certainty` is one of `declared` (the default), `assumed`, `hypothesis`, `proposed`, `observed` or `derived`. `label` (text) and `source` (`{doc, section?, quote?}`) annotate the link for people, as v1 cross links did. Containment is never a link |
| `files` | repo-relative globs | Source that realises this node, relative to the nearest `root` at or above it |
| `criteria` | `NodeCriterion[]` | What must hold for this node; see below |
| `provisional` | boolean | Added on a hypothesis; readiness treats it as the engine does |

```yaml
id: screen.people
kind: screen
fields: {title: People, description: Lists the owner's contacts.}
links: [{rel: serves, to: P1}]
files: [src/ui/people/**]
criteria:
  - id: C.webapp.screen.people
    claim: The People screen lists only the owner's contacts.
    severity: hard                   # hard | soft | advisory (default hard)
    target: artifact                 # model | artifact | runtime | observation (default model)
    gates: [candidate, promotion]
    hooks:
      - {id: hook.webapp.screen.people, assay: people fixture, tier: execution, engine: vitest, triggers: [candidate]}
```

**Criteria** keep the v1 `Criterion` fields except the four that placement now implies:

- The subject is the node the criterion is declared on.
- The owner is the nearest node at or above it that has a `template` (a Thing, else the System).
- `targetKind` becomes `target`.

Ids stay globally unique and start with `C.`, so evaluations, the Changelog and Evolution `acceptanceCriteria` keep referencing them. Hooks are declared inline under the criterion they check, with the v1 `AssayHook` fields minus `criteria` (implied by nesting) and with `target` for `targetKind`. A hook shared by several criteria is declared once, and the others name its id as a string.

The plan's draft wrote `severity: gate | hard | soft` and `target: model | code | observation`. The contract keeps the v1 enumerations instead (`severity` plus a separate `gates` list; `artifact` and `runtime` as targets), so the v1 conversion is lossless.

**System criteria** are the `criteria` of the root `node.yaml`.

**Journeys** are nodes of kind `journey` under the System or the Thing that owns them. Each step is a child node of kind `step`. Its id is `<journey id>/<local id>` (`J.contacts/s1`), the same id the engine graph uses today, and its directory is the local id. The sequence comes from each step's `next` (`[{to, when?}]`, local ids, projected as `stepNext` links), starting at the journey's `start`; there is no `order` field. A step's other fields are the v1 step fields. Its targets are links (`stepScreen`, `stepOperation`, `stepExternal`), as in the engine's artyfact base template.

**Requirements** stay nodes of kind `requirement`, with their ids unchanged (`S.…`), so journey `requirements`/`requirementRefs` and criterion `sourceRefs` keep resolving. A requirement sits under the first node it constrains (its first v1 subject); one with no subjects sits under the Thing named in its `thing` field. Every subject, the parent included, stays a `subject` link: `subject` is the base template's "constrains" relation, and keeping it keeps the graph unchanged. `refines` links to features are kept too.

Only things that span many nodes become nodes of their own; everything else is a field of the node it describes.

### 2a. The retired v1 layout

The v1 (by-concern) layout is dropped. The rules:

- **One-time migration.** The v1 reader exists only inside the converter (W1, `packages/ontology/src/codec/v1.ts`) and one transitional platform release. A System whose head is v1 cannot evolve on the platform: start work, the hooks and intents all load the head and answer 422 `legacy-genome`. So the prod Keep in Touch Genome is migrated outside the platform, in three steps (commands in `docs/deploy.md`):
  1. `artyfact convert-genome <v1 checkout> <v2 dir> --source-map <app source-map.yaml>` writes the node tree locally.
  2. `artyfact init --genome <v2 dir> --adopt --force` pushes it to the same Genome repo as a new commit on top of the v1 head (`--adopt`), and re-imports the System at that commit (`--force`).
  3. The import makes the converted commit the head. The v1 commits stay in the repo's history and in the Changelog as legacy entries.

  After the migration has run, the converter's v1 reader, the engine's artyfact v1 adapter (`src/adapters/artyfact`), its parity tests and v1 support in `@artyfact/model` are deleted. Old commits are never rewritten.
- **Legacy check.** `isLegacyGenome(paths)` (`src/genome/node.ts`) is true when the root has `system.yaml` and no `node.yaml`. It reads a file list only and never parses v1. It is the only v1 knowledge the platform keeps.
- **Model routes** (`model`, `readiness` and anything else that loads the Genome) at a legacy revision answer 422 `legacy-genome`, with a message that names the fix: "this revision predates the node-tree Genome format; convert it with `artyfact convert-genome` and push it with `artyfact init --adopt --force` (docs/deploy.md)". Model and changelog rows cached before the projection are versioned out (`MODEL_CACHE_VERSION`, `CHANGELOG_CACHE_VERSION`), so a cache never serves a v1-built model.
- **One notice.** The UI marks a legacy Genome with one string, "Genome v1 format — not comparable" (`views/compare/legacy.ts`).
- **Changelog.** A System commit whose Genome is legacy is listed with its row metadata (time, author, policy, rationale, Evolutions, candidates) and `legacyFormat: true`. Its `summary` counts files only, with the node counts 0. The row shows the notice, and its expanded entry shows the notice in place of the node delta and the "Open this revision in the Map" link. The changed files and their text diffs still show, because they are plain files.
- **Compare.** When a side's Genome is legacy, `SystemCompare.genome.legacyFormat` (and `GenomeCompare.legacyFormat`) lists that side and `delta` is null. The notice shows above the Compare tabs, whichever side is legacy. The app side compares as usual, and file compare (`compare/file`) works on any revision.
- **Other surfaces.** Map, Inspector, Journeys and the other views only ever load the head, which is v2 after the migration. A link to a legacy revision (`/s/<id>/r/<rev>/…`) redirects to its Changelog entry at head (`…/r/head/changelog?commit=<rev>`). A legacy head, before the migration, shows the route error with the 422 message.

### From the tree to the engine `Graph` (W1 codec, W4 projection)

| Tree | `Graph` |
|---|---|
| A `node.yaml` | `{id, kind, parent: enclosing node's id (absent for the root), fields, provisional?}` |
| `links[]` | `{from: node id, rel, to, certainty}`. An absent `certainty` projects as `declared`, as the v1 adapter does, so v1 and v2 graphs compare equal. A link's `label` and `source` are not projected: the engine `GraphLink` has no slot for them (the v1 adapter dropped them too), so they live only in `node.yaml` |
| A criterion | A `criterion` node with no parent, exactly as the v1 adapter emits it (`criterionFields`), plus links `subject` → the declaring node and `owner` → the owning Thing or System |
| An inline hook | A `hook` node (`hookFields`) whose `criteria` field lists every criterion that declares or names it |
| `template` (root) | `graph.template` is the root's template ref. A Thing's `template` and `root` stay in the codec's tree index (source map, template resolution) and are not fields |
| `template` (any node) | A `template` node and a `pinned` link. The node is the one the meta@1 template declares for itself in `nodes` (`{id: <ref>, kind: template}`), else `{kind, version}` from the ref |
| `files` | Not in the graph; the loader computes each node's effective globs (`SystemModel.files`, §3) and the platform's source map (`sourceMapFor`) groups them by glob |
| `evolutions/*.yaml` | `evolution` nodes with no parent, plus `acceptance` and `affects` links, as in v1 |

The projection also emits the nodes the v1 adapter derives from fields, so they compare equal: `kit` nodes with `pinned` and `requires` links from the root's `kits` and `required`; `artifact` nodes with `artifact` links from a Thing's `artifacts`; `template` nodes with `pinned` links from `template`.

The migration's acceptance test is parity. For Keep in Touch, the v1 adapter's graph and the converted tree's projection must be the same nodes, fields and links with the same findings, except for these three intended `parent` differences, all of which v1 left parentless:

1. `purpose`, `claim`, `external`, `feature` and `commitment` nodes have the System as parent.
2. `journey` nodes have the System or their owning Thing as parent.
3. `requirement` nodes have their first subject as parent, or their `thing` when they have no subject.

So the templates (W2) declare `parents`:
- `[system]` for `purpose`, `claim`, `external`, `feature` and `commitment`;
- `[system, thing]` for `journey`;
- every kind a requirement may constrain for `requirement`.

The test is deleted with the v1 reader.

### v1 → v2 conversion (W1)

| v1 | v2 |
|---|---|
| `system.yaml` | Root `node.yaml`: `template` from `template`; `name`, `profile`, `phase`, `kits`, `rulePacks` and `required` as fields. `things` and `purposes` are implied by the tree |
| `purpose.yaml`, `externals.yaml`, `theory.yaml` | One node per purpose, external and claim under the root; `beneficiaries` become `beneficiary` links; cross links on externals stay links |
| `description.yaml` | `narrative`, `alternatives` and `openQuestions` as root fields; one node per feature and per commitment under the root |
| `things/<t>/thing.yaml` | `<thing id>/node.yaml` with `template`, and `name`, `description`, `purposeRefs`, `artifacts` and `sections` as fields |
| `things/<t>/ontology.yaml` | Nested directories following `parent` (and `children`); cross links become `links` (`direction: in` is written on the other end) |
| `things/<t>/spec.yaml` requirements | `requirement` nodes (ids unchanged) under their first subject; `thing`, `title`, `text`, `enabled` and `source` as fields; `subject` links to every subject; `refines` links |
| `criteria.yaml` (System, Thing) | `criteria` on the subject node's `node.yaml`, with hooks inline |
| `journeys/J.*.yaml` | A journey node under the owning Thing (the System when its steps span Things), with fields `name`, `actorGoal`, `features`, `requirements`, `start`, `deferred` and `segments`. One child `step` node per step, with id `<journey>/<step>`, its directory the step id, and `next` kept as the sequence |
| `evolutions/*.yaml` | Unchanged |
| The app repo's `source-map.yaml` (`convert-genome --source-map`) | Each entry's glob onto the `files` of every node it names, in entry order; the pseudo-node `genome` is dropped and any other unknown node is an error |

Field names are kept as they are in v1. Nodes go on using `name` where v1 did, and view hints default the display name to `title`, then `name`. The engine's routing names nodes with `titleOf`: `title`, then `name`, then the field the kind's `view.title` names, then the id.

The engine's v1 adapter predates Parts, Composition and the Phenome. The converter reads v1 through `@artyfact/model`, which knows them, and emits the tree from that. Both readers go when the migration release has run (§2a).

## 3. Templates (meta@1 plus artyfact's extensions)

Templates stay `meta@1`. A template is checked by `checkTemplateForm`, extended by `extends` and stored as `packages/templates/<system|thing>/<name>@<v>/template.yaml`.

| Concern | Where |
|---|---|
| Kinds and their fields | `kinds.<k>.fields` (`name`, `type`, `required`, `enum`, text constraints) |
| Legal nesting | `kinds.<k>.parents` (kinds a parent may have) |
| Completeness | `kinds.<k>.completeness {fields, children[{kind, cardinality}], relations[{rel, cardinality}]}` |
| Relations | `relations.<rel> {from[], to[], cardinality {out, in}, acyclic?, inverse?, certainty?}` |
| Constraints | `constraints {forbiddenCycles, incompatible, exclusive, exactlyOne, complete}` |
| **Kind-wide checks** (every node of a kind, its children, or pairs of its children) | `kinds.<k>.checks[]` (checks@1): deterministic with `pattern`, else a System One question; `level` error, warning or info |
| Question wording | `kinds.<k>.criteria` (`noun`, `instanceOf`, `grounded`, `testable`, `children`, `pairs`, `summary`) and `rootCriteria`. The name is the engine's: these are sentences for System One, **not** acceptance criteria |
| Acceptance criteria every instance gets | Template `criteria[]` (`{id, owner, subject, severity, gates, hooks}`), with `subject: $self` or a prefilled node id. The codec places each on its subject node when the template is instantiated (`fromTemplate` set) |
| Prefilled nodes (`section.ui`, `binding.d1`, …) | `nodes[]` with `$self` for the instantiating node. Each gets a directory under it when the Thing is created |
| Rule packs | `rules[] {id, version, source}` (Datalog) |

So the plan's "kind-wide criteria" means `checks`. Hook-bearing acceptance criteria are per node: declared in `node.yaml` or stamped from the template's `criteria`.

**`$self` in prefilled ids.** A Thing template may be used by several Things in one System, so every prefilled node, criterion and hook that belongs to the instantiating node carries `$self` in its id (`$self.api`, `C.$self.checks`, `hook.$self.checks`). Instantiation replaces `$self` with the node's id in ids, fields and links (`C.thing.api.checks`, whose `hooks` name `hook.thing.api.checks`). The template's own `template` node is shared, so its `criteria` and `hooks` lists keep the pattern; the projection resolves each `$self` section and criterion per Thing as a `requires` link from the Thing (`thing.api requires C.thing.api.checks`, `thing.api requires thing.api.api`), and `template.criterionMissing` or `template.sectionMissing` fires when the Thing does not own it. Nothing creates `C.<thing>.checks` when a Thing is added from a template: `template.criterionMissing` is the signal, and the intent flow proposes the criterion. `composeTemplates` rejects two prefilled nodes with one id and different content (`TemplateCompositionError`, naming both Things and the id; the API answers 422 `template-composition`), so a template that prefills fixed ids (the webapp templates' `section.ui`, `binding.d1`, `C.webapp.exists`) can be used by one Thing per System. The legacy v1 shape writes the placeholder `$thing`.

**`files` defaults** (`KindSchema.files`, `TemplateNodeSchema.files`, `TemplateSourceSchema.files`) are repo-relative globs.

- A node's effective globs are the union of four lists: its kind's `files`, its prefilled template node's `files`, the template's root `files` (only for the node that instantiates the template, the old `$thing` entries), and its own `files`.
- `{id}` and `{slug}` in a kind default stand for the node's id and directory name.
- Every glob is prefixed with the nearest `root` at or above the node (the Thing's app root); with no `root` it is relative to the app repo root.
- A nearer template's kind declaration replaces the whole kind, `files` included. The template-level `files` come from the nearest template that declares any.
- A path maps to every node whose effective globs match it, across all Things; a path no glob matches is `unmapped:<path>`. A Task Packet permits the globs of the Evolution's affected nodes and their ancestors below the Thing. The node's own `files` are `declared` entry files, the defaults `assumed`. There is no repo-level `source-map.yaml`, and the Genome mirror `system/**` maps to no node (app candidates may not change it).

**View hints** (`KindViewSchema` and `TemplateViewSchema` in `src/genome/view.ts`, merged over `extends`) replace every `switch (kind)` in the UI:

| `kinds.<k>.view` | Default |
|---|---|
| `label` | The kind name in sentence case (`durableObject` → "Durable object") |
| `plural` | `label` + "s" |
| `glyph` (1 to 2 characters, never the only signal) | `•` |
| `colour`: `neutral`, `slate`, `blue`, `indigo`, `violet`, `pink`, `red`, `orange`, `amber`, `lime`, `green` or `teal`. The UI maps it to a themed `--kind-<token>` | `neutral` |
| `layer`: a Map layer id | None |
| `fields`: Inspector order | Declaration order; fields left out follow it |
| `title`: the field shown as the name | `title`, then `name`, then the id |
| `summary`: the field shown under the name | `description` |

- Template `view.layers: [{id, label, description?}]` are the Map bands, in layer order along the Map's flow (left to right: the Map lays out left to right, so each band is a labelled column). When the template chain declares layers, a kind is drawn on the Map only if its `view.layer` names one; a scope then shows its nearest drawn descendants, looking through undrawn containers. With no layers, the Map bands nodes by containment depth and draws every kind.
- `kinds.<k>.view` merges key by key over `extends`, so a child template can recolour a kind without restating it. Template `view` comes from the nearest template that declares one.
- **Where hints and `parents` are declared.** Declaring a kind in a child template replaces the whole kind (`fields`, `parents`, `completeness`, `checks` as a unit; only `criteria`, `checks` and `view` merge key by key), so a child cannot add a view hint or a parent to an inherited kind without restating it. The shared artyfact kinds therefore carry their `parents`, `view` and the Map `view.layers` in the engine base template (`template.meta.artyfact-genome@1`), and the ported System and Thing templates inherit them. They own `rules`, `nodes`, `criteria` and `files`. `view.layers` is nearest-wins, so a System mixing Thing templates needs W4's composition, where the System template's layer order wins.
- `resolveKindView(template, kind)` fills the defaults. `checkViewHints(template)` reports duplicate layers, undeclared layers and field names the kind does not declare.
- Absent hints leave the template hash unchanged.

## 4. Ops → file changes (W1 writer, W7 accept)

The writer edits the head tree and touches only the affected node directories. Text edits go through the `yaml` Document API, so comments, key order and flow style survive.

| Op | File change |
|---|---|
| `add {kind, parent, fields, criteria?, links?}` | Create `<parent dir>/<slugOf(id)>/node.yaml`. The id is minted as `<kind>.<slug of title>`, with `-2`, `-3`, … on collision. A parent-less add goes under the root. Prefilled template nodes of the new kind are not instantiated (only a new Thing or System instantiates a template) |
| `update {node, fields}` | Set each field in `fields` on the node's `node.yaml`; `null` deletes the key |
| `update {node, criteria}` | Upsert each criterion by id; `{id, remove: true}` deletes it. Inline hooks follow their criterion |
| `remove {node}` | Delete the node's directory with its whole subtree. Links from other nodes to any removed id are not rewritten: the proposal must carry the matching `unlink` ops, and evaluation reports what is left dangling |
| `link {node, link: {rel, to, certainty?}}` | Append to `links` of the `from` node, unless the link is already there |
| `unlink {node, link: {rel, to}}` | Remove the matching entry from `links` of the `from` node |

There is no move or rename op. A reparent is a `remove` plus an `add`; the engine's `link` intent text mentions "move one under another", but no op carries it yet. Criteria travel with their node. An Evolution's `affectedNodes` are the ids the accepted ops touched: the added, updated and removed nodes, plus the `from` end of each link change.

## 5. Intents

```
POST /api/systems/:id/intents {message, anchor?}             (admin) → 201 Proposal
  head Genome → Graph (codec) → route → routeSlice/routeVocabulary → translate → validateOps (+ evaluate on the applied copy)
  → Proposal stored in the System DO (`proposals`)
POST /api/systems/:id/intents/:pid/reply {answer, questionId?} (admin) → Proposal (revised: route and translate again with the answer)
POST /api/systems/:id/intents/:pid/accept {opIds}            (admin) → 201 {evolution, realization, candidate, commit}
  ops → tree codec → genome realization (startWork, origin editor) → commitEdit push → candidate → gates;
  Evolution affectedNodes = touched nodes; app packets take permitted paths from those nodes' files
GET  /api/systems/:id/intents/:pid                           (admin) → Proposal
```

Wire types are in `apps/platform/shared/api.ts`: `IntentRequest`, `Proposal`, `ProposalRouteStep`, `ProposedOp`, `ProposalQuestion`, `ProposalProblem`, `ProposalProvenance`, `IntentReply`, `IntentAccept` and `IntentAcceptResponse`. The route builders are `routes.intents`, `intent`, `intentReply` and `intentAccept`. The four routes are admin only (`worker/routes/intents.ts`, logic in `worker/intents.ts`).

How the platform runs them:

- **Head.** The head Genome's files go through the tree codec (`parseTree`, `projectTree`). The template is the root's `template` (else the engine base) with the Things' templates laid over it. A legacy head is a 422 `legacy-genome`.
- **One turn.** `route` (engine default budget, 8 System One calls) runs on the conversation: the message, the anchor's title and id when given, then every question and answer so far. A route with status `unknown` is not translated, and the router asks. Otherwise the translator runs once. A translator error is an `error` problem; an off translator is a `warning` problem.
- **Replies.** A reply appends `{question, answer}` to the conversation and runs a new turn on the current head. The proposal keeps its id and stays `open`, and its ops, questions, problems and provenance are replaced. A proposal takes at most 10 replies; the next is a 422 `too-many-turns`.
- **Adds.** An `add`'s title goes into the kind's name field: its `view.title`, else `title`, else `name` when the kind declares only that.
- **Storage.** Proposals live in the System DO's `proposals` table (`worker/do/proposals-store.ts`): the wire `Proposal` plus the conversation. Ids are `proposal.<n>`; questions are `q.<turn>`.
- **Accept.** The DO first moves the proposal from open to accepting in one step, and only while the head is still `genomeCommit`. Otherwise the accept is a 409: `invalid-state` when the proposal is not open (for example, another accept holds it), `stale-base` with `details.currentHead` when the head moved. A claim older than 5 minutes (`claimed_at`; its accept died) is taken over. The chosen op ids are checked against the revision the claim returned, since a reply re-mints them: an unknown id is a 400, and each chosen op needs its `dependsOn` (else 422 `missing-dependency`); either releases the claim. The fork is reserved with the proposal's commit as its expected base, so a head that moves after the claim is also `stale-base`. Any failure before the commit is pushed returns the proposal to open with the error recorded. Once it is pushed, the proposal is never reopened: if recording the accept fails, it is retried as `accepted` with the error kept, so a retry of the accept is a 409 and cannot push twice. If an Evolution was already created, it is deleted with its realizations and what they recorded. Their tokens are revoked and their registry entries removed, so a retry leaves exactly one Evolution. The ops go through `applyOps` (failure: 422 `invalid-ops`; nothing changed: 422 `no-change`). Then, in order:
  - a `genome-amendment` Evolution: the title is the message's first line, the intent the message, `affectedNodes` the touched nodes (added ones included) and the default criteria;
  - `startWork` with target `genome`, origin `editor` and agent `human:intent`. Its Task Packet also permits `<dir>/**` for each node the ops add, where `<dir>` is the directory `applyOps` wrote it to (`created`), since the base model has no origin for it and the scope gate would otherwise fail the commit;
  - `commitEdit` of the file changes (message: the title, why: the message), which pushes, checkpoints and submits the candidate;
  - the proposal becomes `accepted` with the Evolution, realization, candidate and commit recorded, and a second accept or reply is a 409 `invalid-state`.

Mapping from the engine:

- **`route`**: `Route.path` → `{level, choice: answer ?? "unclear", confidence: confidence ?? 0}`, in order.
- **`ops`**: each engine op gets an id `op.<n>` in order.
  - `add` mints `node`; its `title` and `description` go into `fields`. Each entry of its `links` becomes a separate `link` op whose `dependsOn` names the add. A `from:` entry becomes a link op whose `node` is the other end and whose `to` is the new node.
  - `update`, `remove`, `link` and `unlink` map one-to-one; `node` is `id` (or `from`).
  - Accepting an op without the ops it depends on is a 422.
- **`questions`**: the translator's `question` (one per turn), plus the router's when the route status is `unknown` and no translation ran.
- **`answer`**: the translator's `answer`, when the message only asked for information.
- **`problems`** come from two sources and map to `{opId?, severity, message}`, with `severity` one of `error`, `missing` or `warning`:
  - `validateOps` problems: `level` `error` → `error`, `warning` → `warning`; `opId` is the id of the op at the problem's index.
  - The findings that applying the proposal's ops to a copy of the graph introduces (`diffFindings` against the head's readiness). These cover illegal nesting, missing required fields and children, and dangling links. Finding levels map `error` → `error`, `missing` → `missing` and `warning` → `warning`; `review`, `info` and `pass` findings are dropped. `opId` names the op whose node is the finding's subject, and is absent when no single op owns it.
- **`provenance`**: router `{provider, model, calls}` and translator `{provider, model}`. `genomeCommit` is the head the proposal was computed on; accepting after the head moved is a 409 `stale-base`. `fake` is true when either side was fake, and the UI labels such proposals.

Providers are wired by W5 and W7. System One comes from `providerFromEnv`: `FAKE_S1=1`, then TypeSafe (`TYPESAFE_API_KEY`), then OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`), else off. `@artyfact/semantic` uses the same client. The translator comes from `translatorFromEnv`. `FAKE_S1=1` selects the fake router and the fake translator for tests and fixture demos.

## 6. Where the engine and the plan disagree

| Topic | Engine today | Plan | Resolution and owner |
|---|---|---|---|
| Criteria in ops | `Op` carries `add.fields`, `add.criteria` and `update.criteria` (upserts and removals); the translator prompt names them; `validateOps` checks them | Ops carry criteria and fields | Done (W7) |
| Node ids on `add` | None | Ops name nodes | The platform mints ids (§4); `ProposedOp.node` carries them |
| Legality of a proposal | `validateOps` checks ids, kinds and relation endpoints only | Valid tree after accept | W7 runs `evaluate` on the applied copy and reports new findings as `problems` |
| Reparent | No op | Containment is the tree | Not in this contract: remove plus add (§4) |
| Routing depth | Spaces are the root's children; shortlist reaches any depth; up to 3 nodes; at most 12 options per question | Routed path through layers | Accepted. Depth comes from the shortlist and the kind and node questions. For deep v2 trees, measure on the Artyfact self-Genome (W11) before adding a per-depth level |
| "Kind-wide criteria" | `kinds.<k>.criteria` is question wording; checklists are `checks` | Template criteria per kind | §3: kind-wide means `checks`; acceptance criteria with hooks are per node |
| Criteria enums | `hard`, `soft`, `advisory` | `gate`, `hard`, `soft`; `model`, `code`, `observation` | Keep the v1 enumerations plus `gates[]` (§2) |
| Template refs | `template.<kind>.<name>@<v>` | `thing/<name>@<v>` in the example | Engine form |
| Display names | `titleOf` reads `title`, then `name`, then the kind's `view.title` field | Artyfact nodes use `name` | Done (W7) |
| Fake translator | Links an add only with a relation the vocabulary declares for the two kinds | Templates declare their own relations | Done (W7) |
| System One providers | TypeSafe, OpenRouter and fake (`providerFromEnv`) | TypeSafe as well | Done (W5) |
| Old Genomes | v1 adapter included | Plan: `loadGenome` detects v1 or v2 (W4), and old commits stay readable | Superseded by the user: v2 only. v1 commits show the legacy notice (§2a), and the v1 readers are deleted after the migration release. W4 loads v2 only |
| Several web app Things | The webapp templates prefill fixed ids (`section.ui`, `binding.d1`, `C.webapp.exists`) | A System may hold any Things | Parked: one webapp Thing per System. A second one fails composition with 422 `template-composition` naming both Things and the id; moving those ids to `$self` renames Keep in Touch nodes |
