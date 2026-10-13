# Ontology: engine, Genome v2 and intents

Authoritative spec for iteration 3. The engine lives in `packages/ontology` (`@artyfact/ontology`), copied from bropilot `packages/ontology-engine` at `cb1599c` (MIT) and owned here from now on. Its own design notes are `packages/ontology/docs/ontology-engine-library.md` and the template author's guide `packages/ontology/docs/writing-an-ontology.md`. This file fixes what the rest of the platform builds on: the Genome tree on disk, the template extensions artyfact adds to `meta@1`, how engine ops become file changes, and the intent wire flow.

Contract code: `packages/ontology/src/genome/` (zod schemas and types for `node.yaml`, view hints, format detection) and `apps/platform/shared/api.ts` (intent wire types and routes). Where this text and those files disagree, the code is a bug to fix here first.

## 1. The engine package

| Entry | Contents |
|---|---|
| `@artyfact/ontology` | `meta@1` templates (`loadTemplate`, `checkTemplateForm`, `extends`), the `Graph`, `evaluate`/`diff`, the judge and funnel, routing (`route`, `routeSlice`, `routeVocabulary`), translators, `validateOps`, the artyfact v1 adapter (`loadArtyfactSystem`), the Genome v2 contract (`src/genome/`) |
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
3. **`translator.translate({message, route, slice, vocabulary})`** returns exactly one of `ops[]`, a `question` or an `answer`. `openRouterTranslator` uses `openai/gpt-6-luna` by default, temperature 0, 800 output tokens, a 30 s timeout and 2 retries, and an LRU cache. It never throws; failures come back as `provider: "error"`. `fakeTranslator` asks a question when the route is not confident. Otherwise it updates the first target's `description`, or adds a node of the route's kind (linked with `references`, which a template may not declare). `translatorFromEnv` order: `TRANSLATE=0` → off, `FAKE_S1=1` → fake, `OPENROUTER_API_KEY` → OpenRouter (`OPENROUTER_TRANSLATE_MODEL`), else off.
4. **`validateOps(ops, template, graph)`** runs deterministic checks and makes no calls. It returns `OpProblem {level, rule, op (index), subjects, message}`:
   - Errors: `op.unknownNode`, `op.unknownKind`, `op.unknownRelation`, `op.relationEndpoint` (endpoint kinds), and `op.duplicateTitle` (an `add` repeating a same-kind title).
   - Warnings: `op.unknownField` (an `update` field the kind does not declare; `title` and `description` are always allowed), `op.missingLink` and `op.duplicateLink`.
   - It does **not** check `parents` legality, completeness, or links left dangling by a `remove`.

Engine op shapes (`src/route/types.ts`):

```ts
{ op: "add"; kind; parent?; title; description?; links?: { rel; to? | from? }[] }   // no id: the platform mints one
{ op: "update"; id; fields: Record<string, unknown> }
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

**Evaluate and judge, for the gates (W5).** `evaluate(template, graph)` is synchronous and makes no calls. It returns `Readiness` with `actionable`, `buildable`, findings and derivations. `judge` and `evaluateAndJudge` resolve semantic candidates through the funnel, bounded by `limits`: `maxRounds` 6, `maxCalls` 500, `maxPairsPerSet` 6, `maxSections` 12, `maxCrossPairs` 10, `maxTerms` 5 and `maxExplanations` 10. Per-kind `checks` (checks@1) are one question per judged check, batched per subject. A check with a `pattern` makes no call. Gates run the funnel on changed nodes only (plan, W5).

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
    J.contacts/                    # a journey owned by the Thing
      node.yaml
      s1/node.yaml                 # its steps, in order of `fields.order`
  evolutions/evolution.1.yaml      # change records stay flat, same schema as v1
```

Rules:

- **One node per directory.** The `node.yaml` in a directory defines that node. The node of the enclosing directory is its parent. The root `node.yaml` is the System. Every other node sits below it.
- **The directory name is a slug, not the identity.** The `id` in `node.yaml` is authoritative and globally unique. A slug matches `[A-Za-z0-9_][A-Za-z0-9._-]*`, is at most 120 characters, and only has to be unique among its siblings. A writer names a new directory `slugOf(id)`: the id itself when that is a valid slug, otherwise the id with every other run of characters replaced by `-`. A journey step's directory may use the step's local id (`s1`). Renaming a directory does not change the node.
- **Reserved names.** `evolutions/` at the root holds `<id>.yaml` change records. They never hold a `node.yaml`, and they are not part of the tree. Directories without a `node.yaml`, dot-files and `README.md` files are ignored. A `node.yaml` whose parent directory has none is an error.
- **Legal nesting** is the template's business. A node's parent kind must be in its kind's `parents`; `metamodel@1` reports the violations. The codec does not refuse an illegal tree; evaluation reports it.
- **Format detection** (`detectGenomeFormat(paths)`) reads the root: `node.yaml` means v2, `system.yaml` means v1. Both at once, or neither, is an error. Old commits stay readable through the v1 adapter, and nothing rewrites history.

### `node.yaml`

Schema: `NodeFileSchema` in `packages/ontology/src/genome/node.ts`. It is strict, so unknown keys are errors. Optional collections are left out when empty, so a round-trip never grows keys.

| Key | Type | Meaning |
|---|---|---|
| `id` | string | Globally unique node id (`screen.people`, `C.…` only for criteria) |
| `kind` | string | A kind the template (chain) declares |
| `template` | `template.<kind>.<name>@<v>` | The template this node instantiates: the System and every Thing |
| `root` | repo-relative path | Prefix for the `files` of this node and all nodes below it (a Thing's app root) |
| `fields` | map | The kind's declared fields; `title` and `description` are always allowed |
| `links` | `{rel, to, certainty?}[]` | Outgoing typed links. `certainty` is one of `declared` (the default), `assumed`, `hypothesis`, `proposed`, `observed` or `derived`. Containment is never a link |
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

**System criteria** are the `criteria` of the root `node.yaml`. **Journeys** are nodes of kind `journey` under the System or the Thing that owns them. Each step is a child node of kind `step`. Its fields are the v1 step fields, with `order` giving the sequence, and its targets are links (`stepScreen`, `stepOperation`, `stepExternal`, `stepNext`), as in the engine's artyfact base template. Only things that span many nodes become nodes of their own; everything else is a field of the node it describes.

### From the tree to the engine `Graph` (W1 codec, W4 projection)

| Tree | `Graph` |
|---|---|
| A `node.yaml` | `{id, kind, parent: enclosing node's id (absent for the root), fields, provisional?}` |
| `links[]` | `{from: node id, rel, to, certainty}`. An absent `certainty` projects as `declared`, as the v1 adapter does, so v1 and v2 graphs compare equal |
| A criterion | A `criterion` node with no parent, exactly as the v1 adapter emits it (`criterionFields`), plus links `subject` → the declaring node and `owner` → the owning Thing or System |
| An inline hook | A `hook` node (`hookFields`) whose `criteria` field lists every criterion that declares or names it |
| `template` (root) | `graph.template` is the root's template ref. A Thing's `template` and `root` stay in the codec's tree index (source map, template resolution) and are not fields |
| `files` | Not in the graph; the node-attached source map reads them (W6) |
| `evolutions/*.yaml` | `evolution` nodes with no parent, plus `acceptance` and `affects` links, as in v1 |

Parity is the test. For Keep in Touch, the v1 adapter's graph and the v2 projection must give the same findings. The one intended difference is the `parent` of top-level items, which v1 left parentless and v2 nests under the System. So the templates (W2) list `system` in the `parents` of `purpose`, `claim`, `external`, `feature`, `commitment` and `journey`.

### v1 → v2 conversion (W1)

| v1 | v2 |
|---|---|
| `system.yaml` | Root `node.yaml`: `template` from `template`; `name`, `profile`, `phase`, `kits`, `rulePacks` and `required` as fields. `things` and `purposes` are implied by the tree |
| `purpose.yaml`, `externals.yaml`, `theory.yaml` | One node per purpose, external and claim under the root; `beneficiaries` become links |
| `description.yaml` | `narrative`, `alternatives` and `openQuestions` as root fields; one node per feature and per commitment under the root |
| `things/<t>/thing.yaml` | `<thing id>/node.yaml` with `template`, and `name`, `description`, `artifacts` and `sections` as fields; `purposeRefs` become `serves` links |
| `things/<t>/ontology.yaml` | Nested directories following `parent` (and `children`); cross links become `links` (`direction: in` is written on the other end) |
| `things/<t>/spec.yaml` requirements | A criterion or fields of the node it constrains, decided per requirement; `refines` is kept as a link |
| `criteria.yaml` (System, Thing) | `criteria` on the subject node's `node.yaml`, with hooks inline |
| `journeys/J.*.yaml` | Journey and step nodes under the owning Thing (the System when steps span Things) |
| `evolutions/*.yaml` | Unchanged |

Field names are kept as they are in v1. Nodes go on using `name` where v1 did, and view hints default the display name to `title`, then `name`. The engine's routing reads only `title` (`titleOf`), so on Keep in Touch it shows ids. W7 adds a `name` fallback, or the kind's `view.title`, to `titleOf`.

The engine's v1 adapter predates Parts, Composition and the Phenome. The converter reads v1 through `@artyfact/model`, which knows them, and emits the tree from that.

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

**`files` defaults** (`KindSchema.files`, `TemplateNodeSchema.files`, `TemplateSourceSchema.files`) are repo-relative globs.

- A node's effective globs are the union of four lists: its kind's `files`, its prefilled template node's `files`, the template's root `files` (only for the node that instantiates the template, the old `$thing` entries), and its own `files`.
- `{id}` and `{slug}` in a kind default stand for the node's id and directory name.
- Every glob is prefixed with the nearest `root` at or above the node (the Thing's app root); with no `root` it is relative to the app repo root.
- A nearer template's kind declaration replaces the whole kind, `files` included. The template-level `files` come from the nearest template that declares any.

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

- Template `view.layers: [{id, label, description?}]` are the Map bands, top to bottom. When the template chain declares layers, a kind is drawn on the Map only if its `view.layer` names one. With no layers, the Map bands nodes by containment depth and draws every kind.
- `kinds.<k>.view` merges key by key over `extends`, so a child template can recolour a kind without restating it. Template `view` comes from the nearest template that declares one.
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

Wire types are in `apps/platform/shared/api.ts`: `IntentRequest`, `Proposal`, `ProposalRouteStep`, `ProposedOp`, `ProposalQuestion`, `ProposalProblem`, `ProposalProvenance`, `IntentReply`, `IntentAccept`, `IntentAcceptResponse` and `NotImplementedResponse`. The route builders are `routes.intents`, `intent`, `intentReply` and `intentAccept`. Today all four routes are admin-only stubs that answer 501 `not-implemented` (`worker/routes/intents.ts`). W7 replaces them.

Mapping from the engine:

- **`route`**: `Route.path` → `{level, choice: answer ?? "unclear", confidence: confidence ?? 0}`, in order.
- **`ops`**: each engine op gets an id `op.<n>` in order.
  - `add` mints `node`; its `title` and `description` go into `fields`. Each entry of its `links` becomes a separate `link` op whose `dependsOn` names the add. A `from:` entry becomes a link op whose `node` is the other end and whose `to` is the new node.
  - `update`, `remove`, `link` and `unlink` map one-to-one; `node` is `id` (or `from`).
  - Accepting an op without the ops it depends on is a 422.
- **`questions`**: the translator's `question` (one per turn), plus the router's when the route status is `unknown` and no translation ran.
- **`answer`**: the translator's `answer`, when the message only asked for information.
- **`problems`**: `OpProblem` mapped to `{opId, severity: level, message}`. W7 adds the findings that applying the ops to a copy of the graph introduces (`diffFindings`), which covers illegal nesting and dangling links.
- **`provenance`**: router `{provider, model, calls}` and translator `{provider, model}`. `genomeCommit` is the head the proposal was computed on; accepting after the head moved is a 409 `stale-base`. `fake` is true when either side was fake, and the UI labels such proposals.

Providers are wired by W5 and W7. System One comes from TypeSafe (`TYPESAFE_API_KEY`) or OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`). The engine's `providerFromEnv` knows only fake and OpenRouter; W5 adds TypeSafe. The translator comes from `translatorFromEnv`. `FAKE_S1=1` selects the fake router and the fake translator for tests and fixture demos.

## 6. Where the engine and the plan disagree

| Topic | Engine today | Plan | Resolution and owner |
|---|---|---|---|
| Criteria in ops | `Op` has no criteria; `add` carries only `title` and `description` | Ops carry criteria and fields | `ProposedOp` carries both now. W7 extends the engine `Op` and the translator prompt (`add.fields`, `criteria` upserts) and keeps `validateOps` in step |
| Node ids on `add` | None | Ops name nodes | The platform mints ids (§4); `ProposedOp.node` carries them |
| Legality of a proposal | `validateOps` checks ids, kinds and relation endpoints only | Valid tree after accept | W7 runs `evaluate` on the applied copy and reports new findings as `problems` |
| Reparent | No op | Containment is the tree | Not in this contract: remove plus add (§4) |
| Routing depth | Spaces are the root's children; shortlist reaches any depth; up to 3 nodes; at most 12 options per question | Routed path through layers | Accepted. Depth comes from the shortlist and the kind and node questions. For deep v2 trees, measure on the Artyfact self-Genome (W11) before adding a per-depth level |
| "Kind-wide criteria" | `kinds.<k>.criteria` is question wording; checklists are `checks` | Template criteria per kind | §3: kind-wide means `checks`; acceptance criteria with hooks are per node |
| Criteria enums | `hard`, `soft`, `advisory` | `gate`, `hard`, `soft`; `model`, `code`, `observation` | Keep the v1 enumerations plus `gates[]` (§2) |
| Template refs | `template.<kind>.<name>@<v>` | `thing/<name>@<v>` in the example | Engine form |
| Display names | `titleOf` reads `title` only | Artyfact nodes use `name` | W7: fall back to `name` or the kind's `view.title` (§2) |
| Fake translator | Links adds with `references` | Templates declare their own relations | Fixtures and e2e must use updates or templates that declare `references`. W7 may make the fake read the vocabulary |
| System One providers | OpenRouter and fake | TypeSafe as well | W5 |
