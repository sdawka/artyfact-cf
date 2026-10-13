# @artyfact/templates

Versioned System and Thing **Templates** in the ontology engine's meta@1 form, bundled as strings so they load in Node, Workers and the browser. The exports are `metaTemplates` (the `TemplateStore` the model loader and the engine read), `loadMetaTemplate`, `metaTemplateRefs`, `metaTemplateSource` and `templateFile` (raw text of any bundled file, such as `scaffold.yaml`).

## Layout

```
system/<name>@<v>/template.yaml      meta@1 (the engine's format); extends template.meta.artyfact-genome@1
system/<name>@<v>/template.v1.yaml   the same template in the legacy artyfact shape, read only by `artyfact convert-genome`
thing/<name>@<v>/template.yaml       + template.v1.yaml, and optional criteria.yaml, scaffold.yaml
rule-packs/<id>@<v>.dl               the legacy-dialect packs the meta@1 templates were ported from
```

## meta@1 templates

`template.yaml` is a `meta@1` template (`docs/design/ontology.md` section 3). Kinds, relations, legal `parents` and the per-kind view hints (label, plural, glyph, colour token, Map layer, Inspector field order) are inherited from the base `template.meta.artyfact-genome@1` in `@artyfact/ontology`, which the UI renders from. Each template adds what is its own:

- `rules`: the domain packs. The System template owns `readiness`, `theory` and `topology.private-pairs` (with its `topology.multiRecipient` question); the Thing templates own `authorization` and `journeys`. The generic `facts` and `metamodel` packs stay in the base.
- `nodes` and `criteria`: the prefilled nodes (`$self` is the instantiating node), criteria and hooks. `files` on kinds, prefilled nodes and the template root are the defaults of the node-attached source map (globs are relative to the Thing's `root`; see docs/design/ontology.md §3).

```ts
import { composeTemplates } from "@artyfact/ontology";
import { loadMetaTemplate, metaTemplates } from "@artyfact/templates";

loadMetaTemplate("template.thing.vue-webapp@1");               // merged over its extends chain
composeTemplates({ template: loadMetaTemplate(systemRef), self: systemId },
  [{ template: loadMetaTemplate(thingRef), self: thingId }]); // the System template with its Things', for evaluate()
```

A test keeps `template.yaml` and `template.v1.yaml` in step (prefilled nodes, criteria, hooks, source globs) and checks that Keep in Touch yields artyfact's findings against the composed template. The v1 files are read only by the converter and by the tests (`test/v1.ts`); they go with the v1 readers once the migration has run (docs/design/ontology.md §2a).

## The `$thing` placeholder

Template nodes and criteria use `"$thing"` for `parent`, `owningThing`, `ownerId` and `subjectId` where they mean "the Thing that instantiates this template". The model loader rebases it to the Thing id. System templates use `"$system"` the same way.

## meta@1 templates

Templates with `meta: 1` are in the ontology engine's form (`loadTemplate`, `checkTemplateForm` from `@artyfact/ontology`). List them with `metaTemplateRefs()` and read the parsed source with `metaTemplateSource(ref)`.

Generic software-system templates, all `extends: template.meta.artyfact-genome@1`:

| Template | New kinds | Sections |
|---|---|---|
| `system/dev-platform.cloudflare@1` | none; carries pack `topology.services@1` | purpose, theory, description |
| `thing/cloudflare-worker-service@1` | endpoint, durable-object, workflow, queue, module (uses the base `binding`) | api, runtime, state, modules |
| `thing/ts-library@1` | export, module | api, modules |
| `thing/cli@1` | command, option, module | commands, modules |
| `thing/static-site@1` | page, asset | pages, build |

Relations added: `exposes`, `calls`, `deploys`, `implements`. `system`, `thing`, `section`, `binding`, `purpose`, `claim`, `feature`, `commitment` and `template`, the Map layers and `dependsOn` come from the base; the three templates with a `module` kind redeclare `dependsOn` so that modules can be its endpoints. New kinds show `name` and use the base layers. Evaluating a Genome that mixes templates needs their union, as `compose` in `test/dev-platform.ts` does.

`topology.services@1` reads the Thing's `pinned` link to its template: an `endpoint` must sit under a Thing pinned to `cloudflare-worker-service@1` (`topology.endpointOutsideWorker`, hard); `dependsOn` links, lifted from modules to their Things, must not cycle (`topology.thingCycle`, hard); a `ts-library` Thing no other Thing depends on is a `topology.unusedLibrary` warning.

## Adding a template or pack

1. Create `thing/<name>@<v>/template.yaml` (or `system/...`) as meta@1. A new template needs no `template.v1.yaml`.
2. Run `npm run build -w @artyfact/templates` to regenerate `src/generated/files.ts` (also runs on `prepare` and `pretest`) and commit the result.
3. Add or extend a test: templates must parse with `Template`; every rule in a pack needs a `.message` and a valid/invalid case in `test/fixtures/`.

**Versioning rule:** never edit a published `@<v>`. Make a new version directory or file (`@2`) and let Things and kits move to it explicitly.

## Fact relations the packs read

Packs are written against the relations `toFacts()` in `@artyfact/model` emits. Conventions the packs rely on:

- `known(Id)` holds every id in the model; `ref(From, Via, To)` every reference that must resolve; `link(From, Rel, To, Certainty)` is always in `out` orientation.
- Booleans are encoded as presence: `requirementEnabled(Id)`, `criterionDeferred(Id)`, `claimDeferred(Id)`, `claimIndicator(Id)` (only when non-blank), `provisional(Id)`. No bool constants appear in rules.
- `thing(Id, TemplateRef)` uses `""` when there is no template; `node(Id, Kind, Thing)` uses `""` for System-level nodes.
- `effectText(Node, Text)` and `nodeName(Id, Name)` are lowercased.
- The full per-pack list is the `.decl` block at the top of each `.dl` file.

Message templates use `{1}` for the finding's subject (the second tuple argument), as in `docs/design/rules.md` D.1.

Further conventions: `entityField(Entity, Name, Type)` carries the raw YAML type string (`ref:entity.Account`, `list<ref:entity.Account>`); `hasActor/1` and `hasEffects/1` mark affordances with a non-empty actor/effects; `kitRequired/1` comes from `kits.yaml` `required`, `kitPinned/2` from `kits`.

`kits.yaml` is `{ kits, rulePacks, required }`. `template.sectionMissing` keys on the Thing's declared `sections`; `template.criterionMissing` only fires when an instance overrides a template criterion with a different owner.

`topology.private-pairs@1` rules: `topology.recipientArray`, `topology.groupEnabled`, `topology.pairCardinality`, `topology.multiRecipient`. The pack derives `outgoingDirect/1` (an operation that writes an entity with an `ref:entity.Account` field, or an affordance invoking one) from `node`, `link` and `entityField`; `recipientArray` fires when such a node has `cardinality: many`.

## Tests

Packs run on the real `@artyfact/rules` engine. The tests read the v1 shape with the `Template` schema of `@artyfact/model`, a dev dependency (the model must not depend on this package). A test regenerates the bundle and fails if `src/generated/files.ts` is stale.
