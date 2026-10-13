# @artyfact/model

The Genome model: Zod schemas, the `SystemModel` projected from the Genome v2 node tree, the model index,
`validate()` (the ontology engine's readiness run), semantic diff/overlap, and a Mermaid projection of journeys. Runs in Node, Workers and the browser. There is no file I/O: the caller passes files in as `Map<path, string>`.

## Layout

```
src/
  schema.ts       every Zod schema + inferred type (docs/design/model.md A.2)
  genome.ts       loadGenome, fromGraph, LegacyGenomeError, ModelParseError, TemplateStore
  model-index.ts  index(): byId, children, links, criteria/hooks/journeys/requirements lookups, path(), depthOf(), layerOf()
  validate.ts     validate(): the engine's evaluate over the composed template → Readiness; selectPacks, rulePacksOf
  diff.ts         diffModels, overlap
  mermaid.ts      toMermaid
  sha256.ts       synchronous SHA-256 (pack hashes)
test/
  fixtures/mini/  minimal v2 node tree (1 system, 1 thing, 2 screens, 3 components, ...)
  helpers.ts      the mini tree, its templates (built from the real packs) and edit helpers
```

## API

```ts
import { loadGenome, index, validate, diffModels, overlap, toMermaid } from "@artyfact/model";
import { metaTemplates } from "@artyfact/templates";

const m = loadGenome(files, { revision: "abc123", templates: metaTemplates });  // LegacyGenomeError | ModelParseError
m.index.path("affordance.NoteForm.save");   // ["system.mini","thing.app","section.ui","screen.edit",...]
const r = validate(m);                      // Readiness
const d = diffModels(a, b);                 // {added, removed, changed:[{id, fields}], affectedCriteria, affectedJourneys}
overlap(d1, d2, m);                         // {shared, viaCriteria, viaJourneys}
toMermaid(m.journeys[0]);
```

## Loading

`loadGenome(files)` reads the v2 tree with the ontology codec (`parseTree`, `projectTree`) and hands the graph to
`fromGraph`. The layout is `docs/design/ontology.md`: one `node.yaml` per node directory, `evolutions/*.yaml`. A
revision in the retired v1 layout (`system.yaml` at the root) throws `LegacyGenomeError` (code `legacy-genome`); the
platform answers 422 and Changelog/Compare mark it `legacyFormat`. A tree error throws `ModelParseError{file, issues}`.

`fromGraph` projects the graph into the collections the views use (`system`, `purposes`, `externals`, `claims`,
`description`, `kits`, `things`, `templates`, `nodes`, `requirements`, `criteria`, `hooks`, `journeys`,
`evolutions`), plus `origin` (id → the declaring `node.yaml` or evolution file), the `graph` itself, the composed
`template` (`composeTemplates` of the System template with its Things') and `index`. Siblings keep directory order,
except that a Thing's sections follow its `sections` list and journey steps run breadth-first from `start`. Template
nodes carry `fromTemplate`. After a JSON round-trip, rebuild the index with `index(model)`; `graph` and `template`
are not serialized by the platform.

## How readiness runs

`validate(m)` calls the engine's `evaluate` with the composed template and the graph. The engine's own packs
(`metamodel`, `completeness`, ... and the template's kind checks) always run and are reported as `engine.<id>@<v>`.
Template rule packs run when the System pins them in its `kits` field: a pin `{id, version}` selects pack `id` or
`artyfact.<id>` at that version, and is reported under the pin's name. Packs that derive no finding (facts) always
run. A pin no template declares yields a `rulePack.unavailable` warning. Derivation rule labels are renamed to the
reported pack names.

`Finding` keeps its shape (`level`, `rule`, `subject`, `message`, `facts`, `derivation`, `pack`). Findings are sorted
by level, rule, then subject. `derived` holds the output relations. `actionable` is true when there is no error and
the run is complete. `missing` findings for `node.provisional` do not block (see `isBlocking` in the platform's
`shared/verdict.ts`).
