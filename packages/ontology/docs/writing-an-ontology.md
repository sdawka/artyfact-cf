> Copied from bropilot `docs/writing-an-ontology.md` @ `cb1599c` with the engine; maintained here since. Paths like `packages/ontology-engine` and `@bropilot/ontology-engine` now mean `packages/ontology` and `@artyfact/ontology`.

# Writing an ontology for the engine

An ontology here is a `meta@1` template: kinds, fields, relations, constraints, and the criteria the engine judges content against. The criteria are the author's checklist. For each kind, the template lists what a good node of that kind must contain. For each parent kind, it lists what the children of one such node must satisfy together. The engine applies every item as its own check at its own level: each node against its kind's checklist, each parent's children against the parent's checklist, and the top-level nodes against the template's root checklist.

Underneath the checklists sits a general layer that every template gets: whether a node is a genuine instance of its kind, how concrete it is, whether it is testable, and whether siblings fit together. The template words that layer too, but it is not where the author's own requirements go. This guide covers the checklists first, then the general layer, so that a small decision model, seeing one bounded slice at a time, reaches the verdict a careful reviewer would.

Reference: `packages/ontology-engine/README.md` ("Criteria from the ontology", "Semantic probes and providers", "Text quality").

## Criteria are checklists

A check is one requirement a node of a kind must meet. A web app's ontology might say:

- every use case is described in the Given / When / Then format;
- every screen states explicit signifiers, affordances and feedback for each control;
- every component that shows data declares an empty state;
- every component that shows non-static data declares a loading state;
- every feature names the user it serves and the trigger that starts it.

Each of these is written under its kind as an entry of `kinds.<kind>.checks`:

```ts
screen: {
  fields: [...],
  checks: [{
    id: "signifiers",
    text: "States explicit signifiers, affordances and feedback for each control: what can be acted on, how it looks actionable, and what the person sees after acting.",
    defect: "specificity.underspecified",
  }],
},
component: {
  fields: [...],
  checks: [
    { id: "emptyState", text: "Declares an empty state: what it shows when there is nothing to show.", when: { pattern: "\\b([Ss]hows?|[Ll]ists?|[Dd]isplays?)\\b" } },
    { id: "loadingState", text: "Declares a loading state when it shows non-static data.", when: { pattern: "\\b([Ss]hows?|[Ll]ists?|[Dd]isplays?)\\b" }, na: true },
  ],
},
usecase: {
  fields: [...],
  checks: [{ id: "givenWhenThen", text: "Is written as a Given / When / Then scenario.", pattern: "\\b[Gg]iven\\b[\\s\\S]*\\b[Ww]hen\\b[\\s\\S]*\\b[Tt]hen\\b" }],
},
```

The engine turns each check into its own finding, with rule `check:<kind>.<id>`:

- **A judged check** (no `pattern`) becomes a candidate for every node of the kind where it applies. The catalogue asks one question per check: "Does this node, a screen, satisfy this criterion: …?", with the node's text and its parents as context. The funnel batches it with the other questions about the same node, so a check adds a question to a call rather than a call of its own where it can. A failing answer is reported at the check's level, with its defect and `judgment.check` set to the check id.
- **A deterministic check** (with `pattern`) needs no model. The node passes when the field matches. A miss is reported straight away at the check's level, before any provider is asked.

A check applies to every node of its kind whose field (`description` unless `field` says otherwise) has text. A blank field is left to `completeness@1` and `text@1`, which already report it.

## How to write a check

- **One requirement per check.** "Declares an empty state and a loading state" is two checks. A failure then names exactly what is missing, and one can be marked not applicable without the other.
- **Observable in the text.** The check is asked of the node's statement and its context, not of the product. "States the empty state" can be answered from the description. "Is accessible" cannot, unless it names what the text must say about accessibility.
- **Say when it applies.** Use `when` rather than hoping the model skips irrelevant nodes. `when.pattern` limits the check to nodes whose field matches. `when.field` limits it to nodes where that field is filled. `when.kind` limits it to nodes of one kind, which matters for root and parent checks. When applicability needs judgment, set `na: true`. The question then offers a `notApplicable` answer that passes.
- **Prefer a pattern when the format is fixed.** Given / When / Then, a ticket reference, a unit after a number and a required heading are all formats. A `pattern` decides them for free and never disagrees with itself. Patterns are JavaScript regular expressions compiled without flags, so write case variants as `[Gg]iven` rather than `(?i)`.
- **State it as what holds.** "Declares an empty state" rather than "does not forget the empty state". The question asks whether the node satisfies the text, so a negative text reads as a double negative.
- **Name the defect it stands for.** `defect` is a `defects@1` id. A missing state, threshold or trigger is `specificity.underspecified`. A wrong format is often `testability`. The default is `instance` for node checks and `consistency` for parent checks.
- **Pick the level.** `error` blocks actionability, `warning` (the default) blocks buildability, and `info` only reports.
- **Keep it short.** One sentence that reads on its own. It is inserted into the question stem as written.

| Key | Meaning | Default |
|---|---|---|
| `id` | Unique within the kind; the rule is `check:<kind>.<id>`. | required |
| `text` | The requirement, one sentence. | required |
| `scope` | `node`: each node of the kind. `children`: each node's children together. `pair`: each two children of one node. | `node` |
| `field` | The field the check reads. | `description` |
| `pattern` | Makes the check deterministic: it passes when `field` matches. | judged |
| `when` | `{ kind?, field?, pattern? }`: applies only where this holds. For `children` and `pair` scope it filters the children. | always |
| `na` | Adds a `notApplicable` answer that passes. | off |
| `answer`, `choices`, `benign` | A `choice` or `score` question instead of yes or no; `benign` is the passing choice or the lowest passing score. | yes-no, benign `yes` |
| `level` | `error`, `warning` or `info`. | `warning` |
| `defect` | The `defects@1` id a failing answer stands for. | `instance` or `consistency` |

## Parent checks

A parent kind owns the checks on its children as a group. With `scope: "children"`, the check is asked once per parent, with its matching children as members: "Do the members of this screen together satisfy: …?" With `scope: "pair"`, it is asked of every two matching children of one parent. `when.kind` chooses which children count.

```ts
feature: {
  checks: [
    { id: "flowsCoverRules", scope: "children", when: { kind: "flow" }, text: "The feature's flows together exercise every rule the feature states." },
    { id: "rulesDistinct", scope: "pair", when: { kind: "rule" }, text: "Two rules of one feature constrain different things.", defect: "consistency.duplicate" },
  ],
},
```

A deterministic parent check is evaluated on each matching child, so the finding names the child that misses the pattern.

## Root checks

`rootChecks` is the checklist for the top-level nodes, the ones without a parent. Its rules are `check:root.<id>`. Use `when.kind` to aim a root check at one kind, and `scope: "children"` to check what the root's sections say together.

## Checks across `extends`

Checks merge by id along the `extends` chain. A child template that declares a check with the same id replaces the parent's; new ids are added. A template without checks keeps its hash and evaluates exactly as before, and `checks@1` is not run.

## What the engine checks without being told

These run on every template and every graph, whatever the checklists say.

| Layer | Pack | What it checks |
|---|---|---|
| Template form | `meta@1` | Relations, parents, children, constraints and questions name declared kinds and relations; cardinalities are satisfiable; `extends` resolves without cycles; rule packs parse and stratify; questions map every answer. For criteria: `criteria.minScoreRange` (error) and `criteria.tooLong` (warning, over 255 characters). For checks: `check.idDuplicate`, `check.defectUnknown`, `check.whenFieldUnknown`, `check.patternInvalid` and `check.levelUnknown`, all errors. An invalid template refuses to evaluate. |
| Structure | `metamodel@1`, `completeness@1`, `consistency@1` | Kinds and fields exist, required fields and child and relation cardinalities hold, forbidden cycles, incompatible values, exclusive relations, exactly-one choices. |
| Text | `text@1` | Blank required fields, short text, placeholder text, text equal to the id or another field, pattern mismatches. |
| Checklists | `checks@1` | Only when the template declares checks: a candidate per applicable node for each judged check, a finding per miss for each pattern check. |
| Judgment | `semantic.probe@2` and the funnel | The general layer below, and the check questions. |

Whatever code can decide, code decides. Put it in fields, cardinalities, constraints, text rules or a pattern check, not in a judged check.

## The general layer

The general layer asks the same questions of every template: is this node a genuine instance of its kind, how concrete is it, is it testable, can its siblings all hold, does its parent summarise them, and how do two statements relate. Each kind's `criteria` words those questions for the kind. They are not checks, and they are not where a requirement such as "has an empty state" belongs.

### Kinds

**Name each kind as a noun with an instance criterion.** `noun` is what a question calls a node of this kind; the check questions use it too. `instanceOf` says what makes a statement a genuine member, in one sentence that separates it from its neighbours: an outcome is a change in the world, not something the team delivers; a feature is user-facing functionality, not a capability independent of any screen.

**One statement per node.** A node's `description` is one claim, behaviour, rule or criterion. Several items in one node are reported as `instance.compound`, and they cannot be scored, tested, checked or paired on their own. Use child nodes for parts and list fields for enumerations.

**Mark structural kinds `tangible: false`.** Sections, summaries and groupings exist to hold other nodes. Scoring them for concreteness only produces noise. They still get `node.kind` and the set questions.

### Tangibility

`node.tangibility` scores a statement 0 to 4. It passes from 3 unless the kind sets `minScore`.

| Score | Meaning | What the kind needs |
|---|---|---|
| 0, empty | A slogan or filler; nothing to build or check. | |
| 1, abstract | An intent or quality without behaviour, actor, object or threshold. | |
| 2, partly concrete | The behaviour or object, with actor, trigger, threshold or scope left open. | Enough for a hypothesis: set `minScore: 2` on claim-like kinds. |
| 3, concrete | One behaviour or condition competent builders would build and check the same way. | The kind's `instanceOf` satisfied and its essentials named. |
| 4, grounded | Every actor, trigger, object and threshold is stated. | What `grounded` lists. |

Write `grounded` as the list of things a level-4 statement names. It is appended to the level-4 option. When one of those things is a hard requirement, also write it as a check, because a score of 3 passes without it.

### Testability

`testable` says what makes a statement of the kind checkable. It is added to `text.unmeasurable` for the kinds a template lists as `measurable`, and to `criterion.unfalsifiable` for the kinds listed as `criteria`. Outcomes need an indicator, a baseline, a target, a horizon and a source. Acceptance criteria and rules need the situation, the expected observable result and what counts as failing. Hypotheses need the evidence that would support and refute them.

### Parent wording

The set questions (`set.allHold`, `set.inconsistent`, `parent.summary`, `pair.relation`) are worded by the parent kind's `children`, `summary` and `pairs` sentences. `children` says what the children of one node share and what would make two of them incompatible. `summary` says what the parent's own description must say about its children. `pairs` says what a compatible pair of children looks like; it is attached to the child kinds declared under the parent through `parents` or `completeness.children`. `rootCriteria.sections` and `rootCriteria.terms` word the questions about the whole. These sentences tune the generic consistency questions. A specific obligation among children, such as "the flows exercise every rule", is a `children` or `pair` check.

### Writing general-layer criteria

- One sentence, at most 255 characters, readable on its own.
- Say what holds, not what to avoid. Name the actors, objects and conditions of the domain.
- No examples drawn from the graph being judged, because they anchor the model on that content.
- An absent criterion costs nothing: the generic stem is sent unchanged.
- Kind criteria merge key by key through `extends`.

## Relations that carry consistency obligations

Some relations say that two statements must be compatible. List them in `probePairs` so that their ends are asked `pair.relation`, and give them structural rules where code can decide.

| Relation | Obligation | Structural rule |
|---|---|---|
| `governs` | The rule and the thing it governs must not contradict or clash in scope. | Endpoint kinds. |
| `authorizedBy` | The operation must be permitted by the authorization it names, for the same actor and scope. | Typed endpoints; a required relation cardinality. |
| `dependsOn` | No circular dependency, and a dependency must be able to hold before its dependent does. | `forbiddenCycles` or `acyclic: true`. |

Relations that only say "related to" carry no obligation and should not be probed in pairs.

## Placeholders and deterministic text

Opt in with `textDefaults: {}` to catch TBD, TODO and similar on every `title` and `description`. Add `minWords` to fields that must state something, and `distinctFrom: ["id", "title"]` to descriptions that tend to repeat the title. A field-level `pattern` makes every value of a field match; a pattern check does the same for one requirement, with its own id, level and message.

## Worked example

```ts
const SHOWS_DATA = "\\b([Ss]hows?|[Ll]ists?|[Dd]isplays?)\\b";
const template: TemplateInput = {
  id: "template.example.webapp", version: 1, meta: 1,
  kinds: {
    feature: {
      fields: [{ name: "title", type: "string", required: true }, { name: "description", type: "string" }],
      criteria: {
        noun: "feature",
        instanceOf: "A feature is a user-facing piece of functionality the product provides.",
        children: "Use cases and screens of one feature serve the same users and trigger.",
      },
      checks: [
        { id: "userAndTrigger", text: "Names the user it serves and the trigger that starts it.", defect: "specificity.underspecified" },
        { id: "useCasesCover", scope: "children", when: { kind: "usecase" }, text: "Its use cases together cover the trigger it names." },
      ],
    },
    usecase: {
      fields: [{ name: "title", type: "string", required: true }, { name: "description", type: "string" }],
      parents: ["feature"],
      checks: [{ id: "givenWhenThen", text: "Is written as a Given / When / Then scenario.", pattern: "\\b[Gg]iven\\b[\\s\\S]*\\b[Ww]hen\\b[\\s\\S]*\\b[Tt]hen\\b", defect: "testability" }],
    },
    screen: {
      fields: [{ name: "title", type: "string", required: true }, { name: "description", type: "string" }],
      parents: ["feature"],
      checks: [{ id: "signifiers", text: "States explicit signifiers, affordances and feedback for each control.", defect: "specificity.underspecified" }],
    },
    component: {
      fields: [{ name: "title", type: "string", required: true }, { name: "description", type: "string" }],
      parents: ["screen"],
      checks: [
        { id: "emptyState", text: "Declares an empty state.", when: { pattern: SHOWS_DATA }, defect: "specificity.underspecified" },
        { id: "loadingState", text: "Declares a loading state when it shows non-static data.", when: { pattern: SHOWS_DATA }, na: true, defect: "specificity.underspecified" },
      ],
    },
  },
  textDefaults: {},
};

const probed = loadTemplate(withSemanticProbes(template));
```

With this template, a use case written as prose is reported as `check:usecase.givenWhenThen` without a model call. Every described screen is asked whether it states its signifiers, and every component that lists or shows something is asked about its empty and loading states, where a static one can answer `notApplicable`. Each feature is asked whether it names its user and trigger, and whether its use cases together cover that trigger.

The shipped templates follow the same pattern. `productSpec` carries `PRODUCT_KIND_CHECKS` (use case Given / When / Then, screen signifiers, feature user and trigger) and `artyfactGenome` carries `ARTYFACT_CHECKS` (screen signifiers, component empty and loading states). Their general-layer wording is `PRODUCT_CRITERIA`, `PRODUCT_ROOT_CRITERIA`, `ARTYFACT_CRITERIA` and `WORLD_KIND_CRITERIA`.

## Checklist

- [ ] Every requirement a good node of a kind must meet is a check on that kind, one requirement per check.
- [ ] Each check is observable in the node's text and says when it applies, through `when` or `na`.
- [ ] Fixed formats are pattern checks, not judged ones.
- [ ] Obligations among children are `children` or `pair` checks on the parent kind, with `when.kind` choosing the children.
- [ ] Each check names its `defect` and, where it should block, its `level`.
- [ ] Every kind a person writes prose for has `noun` and `instanceOf`; structural kinds are `tangible: false`; hypothesis-like kinds have `minScore: 2`.
- [ ] Parent kinds used as sets have `children` and `summary`; parents whose children are compared have `pairs`.
- [ ] Relations with a consistency obligation are listed in `probePairs` and have structural rules where code can decide.
- [ ] `textDefaults` is on, and descriptions that must say something have `minWords`.
- [ ] `checkTemplateForm` reports no errors and no `criteria.tooLong` warnings.
