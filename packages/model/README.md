# @artyfact/model

The Genome metamodel: Zod schemas, the loader (with template resolution), the model index, `toFacts()` for
`@artyfact/rules`, `validate()` (which runs the pinned Rule Packs), semantic diff/overlap, and a Mermaid projection of
journeys. Runs in Node, Workers and the browser. There is no file I/O: the caller passes files in as `Map<path, string>`.

## Layout

```
src/
  schema.ts       every Zod schema + inferred type (docs/design/model.md A.2, plus Template, Kit, file containers)
  load.ts         loadSystem, ModelParseError, TemplateStore, template resolution
  model-index.ts  index(): byId, children, links, criteria/hooks/journeys/requirements lookups, path(), layer()
  facts.ts        toFacts(): SystemModel → FactSet (EDB relations below)
  validate.ts     validate(): toFacts → rules.run(packs) → Readiness
  diff.ts         diffModels, overlap
  mermaid.ts      toMermaid
  sha256.ts       synchronous SHA-256 (pack hashes)
test/
  fixtures/mini/  minimal Genome (1 system, 1 thing, 2 screens, 3 components, …)
  fixtures/test-pack.dl  inline Rule Pack used by validate tests
  stubs/rules.ts  temporary stand-in for @artyfact/rules (see below)
```

## API

```ts
import { schema, loadSystem, index, toFacts, validate, diffModels, overlap, toMermaid } from "@artyfact/model";

const m = loadSystem(files, { revision: "abc123", templates });  // throws ModelParseError{file, issues}
m.index.path("affordance.NoteForm.save");   // ["system.mini","thing.app","section.ui","screen.edit",…]
const facts = toFacts(m);                   // FactSet {relations, hash}
const r = validate(m, [{ id: "metamodel", version: "1", source: dl }]);  // Readiness
const d = diffModels(a, b);                 // {added, removed, changed:[{id, fields}], affectedCriteria, affectedJourneys}
overlap(d1, d2, m);                         // {shared, viaCriteria, viaJourneys}
toMermaid(m.journeys[0]);
```

`SystemModel` holds the parsed collections (`system`, `purposes`, `externals`, `claims`, `description`, `kits`,
`things`, `templates`, `nodes`, `requirements`, `criteria`, `hooks`, `journeys`, `evolutions`), `origin` (id → the file
it was declared in, or the template ref it came from), and `index`. Every field except `index.path`/`index.layer` is
plain JSON. After a JSON round-trip, rebuild the index with `index(model)`.

### Genome files

| path | content |
|---|---|
| `system.yaml` | `SystemFile` (required) |
| `purpose.yaml` | `Purpose`, `Purpose[]` or `{purposes: []}` |
| `externals.yaml` / `theory.yaml` | `{externals: []}` / `{claims: []}` (or a bare list) |
| `description.yaml` | `Description` |
| `kits.yaml` | `{kits: [{id, version}], rulePacks: [{id, version}], required: [kitId]}`. A required kit missing from `kits` is unpinned |
| `criteria.yaml` | `{criteria: [], hooks: []}`, owned by the System |
| `things/<dir>/thing.yaml` | `Thing` |
| `things/<dir>/ontology.yaml` | `{nodes: []}`. Nodes may nest `children`; the loader flattens them and sets `parent`. Top-level nodes without a `parent` get the Thing id. `owningThing` defaults to the Thing |
| `things/<dir>/spec.yaml` | `{requirements: []}` |
| `things/<dir>/criteria.yaml` | `{criteria: [], hooks: []}`, owned by the Thing |
| `journeys/*.yaml`, `evolutions/*.yaml` | one `Journey` / `Evolution` per file |

The loader ignores other paths. Duplicate ids within a collection throw `ModelParseError`. File order never affects
the result.

## How templates resolve

A Thing's `templateRef` (and `system.yaml`'s `template`) is a pinned ref `template.<kind>.<name>@<version>`, looked up
in `opts.templates.get(ref)`. A missing template, or one of the wrong kind, throws `ModelParseError` naming the
referencing file. For each resolved template:

1. Template nodes are flattened (they may nest `children`, like ontology files).
2. **`$thing` placeholder.** In a Thing template, `parent: "$thing"` and `owningThing: "$thing"` on top-level sections and
   nodes are rebased to the instantiating Thing's id. Criteria `ownerId`/`subjectId` of `"$thing"` are rebased the
   same way. All template nodes get `owningThing` set to the Thing. A System template uses `"$system"` (`"$thing"`
   is accepted too) and is rebased to the System id.
3. Every template node, criterion and hook is stamped `fromTemplate: "<id>@<version>"`.
4. Template objects come first. An instance object with the same id replaces the template object at that position
   (no `fromTemplate`). Instance-only objects follow.

`toFacts()` then emits `thing(Thing, TemplateRef)`, `templateKnown(TemplateRef)`, `templateRequires(TemplateRef, Section)` and
`templateRequiresCriterion(TemplateRef, Criterion)`. Packs compare these against the Thing's sections (from
`Thing.sections`, emitted as `thingSection`) to catch missing sections. When `thing.yaml` omits `sections`, the template's are used. Two Things that instantiate the same Thing template would produce
colliding node ids; that case is not supported yet.

## Facts

The fact schema is `docs/design/facts.md` (derived from the Rule Packs' `.decl` blocks, which consume it). `toFacts()`
emits only those EDB relations (exported as `RELATIONS`). `factSet()` leaves out relations that have no tuples.
Tuples are deduped and sorted, and the hash is sha256 over the canonical form, so it does not depend on file or key
order.

Choices this package makes within that schema:
- `node(Id,Kind,Thing)` covers the System (Thing `""`), Things (Thing = itself), ontology nodes (Thing =
  `owningThing`) and externals (kind `external`, Thing `""`). `nodeName` and `effectText` are lowercased.
- `known(Id)` covers every declared id: system, things, nodes, externals, purposes, claims, GD features, commitments,
  requirements, criteria, hooks, journeys, steps (as `J.x/s1`, see `stepKey`), evolutions, resolved templates
  (`id@version`) and pinned kits.
- `ref(From,Via,To)` uses these `Via` values: `parent`, `refines` (nodes, requirements, criteria), `subjects`,
  `sourceRefs`, `beneficiaries` (purposes, claims), `acceptanceCriteria`, `links`, and `screen`/`operation`/`external`
  from step `J.x/s1`. Steps marked `unresolved` emit no `ref`; they still emit `stepRef`, which the journeys pack checks
  with `stepUnresolved` taken into account.
- `link` is in OUT orientation (`direction: in` is swapped). `parent(Thing, System)` is emitted for every Thing.
- `entityField` is emitted only for `entity` nodes and carries the raw YAML type. `policyMode` is emitted only for
  `policy` nodes with `mode`, and `hasActor`/`hasEffects` only for affordances.
- `criterionHook(C,H)` uses the union of `hook.criteria` and `criterion.hooks`, limited to hooks that exist.
- `thingSection` is the Thing's `sections`, or the template's `sections` when the Thing omits them.
- `kitPinned` comes from `kits.yaml` `kits` and `kitRequired` from `required`. `model.kits.rulePacks` is what callers
  pass to `packsFor()`.

## How packs run

`validate(m, packs)` parses each pack as program `<id>@<version>`, runs them all over `toFacts(m)`, and folds the
pack convention relations into `Finding`s:

| derived tuple | finding |
|---|---|
| `violation(Rule,Subject,"hard")` | `error` |
| `violation(Rule,Subject,"soft"\|"advisory")` | `warning` |
| `missing(Rule,Subject)` | `missing` |
| `warning(Rule,Subject)` | `warning` |
| `semanticCandidate(Rule,Subject,Text)` | `info`, rule `semantic:<Rule>` |

`message` is the pack's `.message` template rendered by `rules.render`, where `{n}` is the nth argument after the rule id (`{1}` = Subject). It is the rule id if the pack has no template.
`derivation` is `rules.explain(result, relation, tuple)`. `facts` holds the derivation's leaf facts as
`[relation, ...tuple]`, taken from the EDB nodes of the tree. `pack` names the program that derived the finding. `Readiness.packs[].hash` is the sha256 of
each pack's source. `derived` holds every output relation. `actionable` is true when there are no errors and the run
is complete. Findings are sorted by level, rule, then subject.

## `@artyfact/rules` stub (temporary)

The real engine is being built on branch `w0-rules`. Until it merges, `tsconfig.json` maps `@artyfact/rules` to
`test/stubs/rules.ts`, a naive evaluator with the same exported API. Test files that run the engine
(`facts.test.ts`, `validate.test.ts`) also `vi.mock("@artyfact/rules", …)` it. When the engine lands:
1. Delete `test/stubs/rules.ts`, the `paths` entry in `tsconfig.json`, and the two `vi.mock` lines.
2. Run the tests. They already pass against the engine on `w0-rules` (commit c44c96b), and `src/` typechecks against it.
`src/` imports only from `@artyfact/rules`.
