# @artyfact/templates

Versioned System and Thing **Templates** and graph-consistency **Rule Packs** (`.dl`), bundled as strings so they load in Node, Workers and the browser.

```ts
import { templates, rulePacks, pack, packsFor } from "@artyfact/templates";

templates.get("template.thing.cloudflare-worker-webapp@1"); // parsed + validated Template, cached
packsFor([{ id: "readiness", version: "1" }]);              // [{ id, version, source }]; throws on unknown
```

## Layout

```
system/<name>@<v>/template.yaml
thing/<name>@<v>/template.yaml      + optional criteria.yaml, source-map.defaults.yaml, scaffold.yaml
rule-packs/<id>@<v>.dl
```

`templates.get` folds the sibling files into the `Template`: `criteria.yaml` (`criteria:` + `hooks:`), `source-map.defaults.yaml` (list of `{glob, nodes}`) and the `repo`/`path` of `scaffold.yaml`. Raw files are available through `templateFile(ref, name)`.

## The `$thing` placeholder

Template nodes and criteria use `"$thing"` for `parent`, `owningThing`, `ownerId` and `subjectId` where they mean "the Thing that instantiates this template". The model loader rebases it to the Thing id. System templates use `"$system"` the same way.

## meta@1 templates

Templates with `meta: 1` are in the ontology engine's form (`loadTemplate`, `checkTemplateForm` from `@artyfact/ontology`) and are invisible to the v1 `templates.get` and `templateRefs`. List them with `metaTemplateRefs()` and read the parsed source with `metaTemplateSource(ref)`.

Generic software-system templates:

| Template | Kinds | Sections |
|---|---|---|
| `system/dev-platform.cloudflare@1` | system, thing, section, purpose, claim, feature, commitment, template; carries pack `topology.services@1` | purpose, theory, description |
| `thing/cloudflare-worker-service@1` | endpoint, durable-object, workflow, queue, binding, module | api, runtime, state, modules |
| `thing/ts-library@1` | export, module | api, modules |
| `thing/cli@1` | command, option, module | commands, modules |
| `thing/static-site@1` | page, asset | pages, build |

Relations: `dependsOn`, `exposes`, `calls`, `deploys`, `implements`. Each Thing template declares only the kinds it owns plus `system`, `thing`, `section` (and `module` where it has one), declared identically everywhere. Evaluating a Genome that mixes templates needs their union (kinds and relation endpoints), as `compose` in `test/dev-platform.ts` does.

`topology.services@1` reads the Thing's `pinned` link to its template: an `endpoint` must sit under a Thing pinned to `cloudflare-worker-service@1` (`topology.endpointOutsideWorker`, hard); `dependsOn` links, lifted from modules to their Things, must not cycle (`topology.thingCycle`, hard); a `ts-library` Thing no other Thing depends on is a `topology.unusedLibrary` warning.

## Adding a template or pack

1. Create `thing/<name>@<v>/template.yaml` (or `system/...`, or `rule-packs/<id>@<v>.dl`).
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

`kits.yaml` is `{ kits, rulePacks, required }`; call `packsFor(model.kits.rulePacks)`. `template.sectionMissing` keys on the Thing's declared `sections`; `template.criterionMissing` only fires when an instance overrides a template criterion with a different owner.

`topology.private-pairs@1` rules: `topology.recipientArray`, `topology.groupEnabled`, `topology.pairCardinality`, `topology.multiRecipient`. The pack derives `outgoingDirect/1` (an operation that writes an entity with an `ref:entity.Account` field, or an affordance invoking one) from `node`, `link` and `entityField`; `recipientArray` fires when such a node has `cardinality: many`.

## Tests

Packs run on the real `@artyfact/rules` engine. The `Template` schema comes from `@artyfact/model` (which must not depend on this package). A test regenerates the bundle and fails if `src/generated/files.ts` is stale.
