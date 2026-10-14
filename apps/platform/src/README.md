# SPA contracts (apps/platform/src)

What the view slices (Map, Journeys + Theory, Code, Work/Review/Evaluations/Changelog/Compare, Deployments, Overview, Home) code against.
Design source: `docs/design/ui.md` §C. Theme rules: `theme/README.md` (tokens only, CSS Modules,
`.u-brackets` / `.u-segments`, only `pass` is green).

## Ownership

| Path | Owner |
|---|---|
| `app/`, `api/`, `model/`, `components/`, `inspector/` (except new body files), `testing/`, `fixtures/` | shell slice |
| `views/<name>/**` | that view's slice. Replace `index.tsx`; add any files beside it |
| `inspector/bodies/<Kind>Body.tsx` | any slice (add a new file; never edit `index.ts`/`registry.ts`) |
| `graph/**` | Map slice |
| `theme/**` | read-only |

## Routes and params

`/` is **Home** (`views/home`, outside the System shell: own header, `h1 Systems`, one card per System).
`/s/:systemId/r/:rev/{overview|map|journeys|theory|code|work|review|evaluations|changelog|compare|phenome}`, each also under
`…/things/:thingId/`; `phenome` is labelled "Deployments". `/s/:id` and `/s/:id/r/:rev` open the sole Thing's workspace when the System
has one Thing, else the overview; `…/history` redirects to `…/changelog` and `…/work?panel=promote` to `…/review`, both keeping
every search param and the hash; `/style` is the style sheet; anything else shows
`RouteError` with an "Open Home" link. The `/s/:systemId/r/:rev` loader prefetches the model bundle (`modelQuery`) and does
not re-run on search-param changes. View params: `code?repo=genome|app&path=&panel=commit`,
`changelog?commit=&evolution=&panel=new`, `compare?from=&to=&level=system|genome|files&path=`, `evaluations?criterion=`,
`phenome?deployment=&build=`, `work?panel=new|intent|start&anchor=&proposal=&evolution=&realization=`,
`review?evolution=&realization=` (a candidate review) or `review?panel=promote&evolution=` (the promotion desk). The UI says `rev`/`repo`; the client maps them to the API's `ref`/`scope`.

Global params, kept by every nav link: `focus` (any indexed id), `layer`
(`genome|proteome|phenome`, default `genome`), `candidates` (csv). View-specific params (`journey`,
`step`, `evolution`, `realization`, `panel`, `evaluation`, `commit`, `repo`, `path`, `from`, `to`, `level`, ...) belong to
their view and are dropped when the view changes. `useSystemRoute().systemId` is `""` outside `/s/`.

**View module contract:** `views/<name>/index.tsx` default-exports a component taking no props.
It is lazy-loaded inside `<main>`, under a `ModelProvider`, so `useModel()` and `useSelection()`
work. Use `<h1>` for the view title.


`views/phenome` (Deployments): builds, deployments, runtime events grouped by version key, observation criteria. `views/work/BuildChip` shows a candidate's build status (literal "unknown" when none); `views/overview/DeployCard` reads `useDeployments()`.
## Model (`model/`)

`useModel()` returns `ModelApi` (throws outside the provider; `useModelOptional()` returns null):

| Member | Returns |
|---|---|
| `bundle` | `UiBundle` = `ModelBundle` with `model: ModelJson` and `source` (`'api' \| 'fixture'`) always set |
| `index` | the pure `ModelIndex` (also has `model` and `entries`, every indexed object in declaration order) |
| `byId(id)` | `IndexEntry \| undefined`, which is `{ id, type, kind, name, item }` (`item` is the raw model object) |
| `children(id)` / `parent(id)` / `siblings(id)` | `IndexEntry[]` / `IndexEntry \| undefined` / `IndexEntry[]` (containment) |
| `descendants(id)` | `string[]`: `id` plus all descendants, depth-first |
| `crossLinks(id, dir?)` | `LinkRef[]` = `{ from, rel, to, certainty, label? }`, with `direction: in` already flipped. `dir`: `out \| in \| both` (default) |
| `criteriaFor(id)` / `criteriaOwnedBy(id)` | `Criterion[]` by `subjectId` / `ownerId` |
| `hooksFor(criterionId)` | `AssayHook[]` |
| `journeysFor(id)` | `Journey[]` (step screen/operation/external/requirementRefs plus journey requirements/features) |
| `requirementsFor(id)` | `Requirement[]` (by `subjects`) |
| `path(id)` | `IndexEntry[]` from the System root down to `id`; `[entry]` outside containment; `[]` if unknown |
| `scope` | `VerdictScope` `{ source: 'selected' \| 'promoted' \| 'revision', candidates }`: whose evaluations count (see below) |
| `evaluations` | every loaded `Evaluation` (unscoped; never show a verdict from it without `scope`) |
| `verdictOf(criterionId)` | `UiVerdict` within `scope` |
| `rollup(id)` | `Rollup` `{ pass, fail, unknown, stale, notRun, waived }` over non-deferred criteria in the subtree, within `scope` |

Containment: System → things → nodes by `parent`; journeys → steps. Purposes, claims, features, commitments and journeys
sit under the node whose directory holds them (v2 `origin`), else under the System. **Steps are indexed as
`<journeyId>/<stepId>`**, e.g. `J.connect/s4` (`stepId(j, s)` in `model/index.ts`, same as the model
package's `stepKey`). Use that form in `?focus=` and anywhere a step is named; rule findings about
steps use it too, so they open in the Inspector.
`buildIndex(bundleOrModel)` is pure. Use it directly in tests and in derived hooks such as
`useMapGraph`.

`ModelJson` (`model/types.ts`) is `@artyfact/model`'s `SystemModel` without `index` (and with
`templates` optional). Domain types in `model/types.ts` are aliases of the model package's
`schema` types. The bundle comes from the loader, so defaulted fields are always present.

`useSelection()` returns `{ focusId, setFocus(id | null, { view? }), layer, setLayer, candidates,
setCandidates(ids), clear() }`. `setFocus` with a `view` navigates there and keeps the global
params; `clear()` removes `focus`, which closes the Inspector. Helpers: `useKeepParams()` returns
`href(viewOrPath, extra?)` (`null` in `extra` removes a param); `useSystemRoute()` returns
`{ systemId, rev, view }`; `viewPath(systemId, rev, view)`.

`status.ts`: `verdictOf(criterionId, evaluations, scope, offTrigger?)` returns
`'pass'|'fail'|'unknown'|'stale'|'not-run'|'waived'`, folding the in-scope rows like the promotion
gate (`shared/verdict.ts`, also used by the Worker's readiness report): the latest row per hook
counts, any fail is fail, and pass needs every hook's row pass and `completed`. No in-scope
evaluation means `not-run`; `not-run|queued|running|deferred` mean `not-run` and `error` means
`unknown`. Not-run rows of `offTrigger` hooks (never run before promotion) are ignored. Other exports:
`rollup(index, nodeId, evaluations, scope)`, `verdictTone(v)` (`pass|fail|subtle`),
`promotedCandidates(commits, rev)` and `verdictScope(selected, commits, rev)`.

**Verdict scope (binding):** with `?candidates=`, only those candidates' evaluations count.
Without it, on `head`/`canonical` or a System commit id, only candidates promoted into that
revision count (from History: `commits[].candidates` from that commit back). If there are none,
every verdict is `not-run`, so an unpromoted candidate's pass never shows green on the canonical
view. Any other `rev` is treated as a candidate id and scopes to itself. `ModelProvider` derives
the scope; prefer `useModel().verdictOf` and `useModel().rollup`.

`kinds.ts`: template view hints (`docs/design/ontology.md` §3), the one place the SPA reads them. The Worker resolves
the System's composed template once and ships it as the model's `views` map (`serializeModel` / `modelViews`:
`{ kinds, layers }`); `useKindView(kind)` / `useKindViews()` and the pure `kindViews(model)` read it
(`{ of(kind), declares(kind), layers }`: `label`, `plural`, `glyph`, `colour`, `layer`, `fields`, `title`, `summary`), with
bare defaults only for a model without the map.
`titleOf` / `summaryOf(entry, view)` read the hinted fields (`fieldValue` also reads a v2 node's `fields` map); `kindColour(view)`
sets `--kind` for glyphs. No code in `src/` branches on a kind name (`no-kind-switch.test.ts`); kinds are plain strings.
Also `bestViewFor(entryType)`, `VIEW_KINDS` (Journeys needs `journey`, Theory `claim`; SideNav hides a view whose kind no
template declares), `VIEWS`, `VIEW_LABELS`, `VIEW_GLYPHS`, `VIEW_GROUPS` (Overview, then Genome · Proteome · Phenome, each with its `question`), `LAYER_QUESTIONS`, `GO_KEYS`.
`time.ts`: `relTime(iso, now)`, `shortSha(hash)`, `useNow(ms)` (literal "unknown" for missing values).
`revisions.ts`: `RevisionOption`, `shortRev(ref)`, `revisionGroups(options, value?)`.

## API (`api/`)

DTOs: `shared/api.ts` re-exports `Verdict, Execution, Evaluation, Finding, Readiness, Criterion,
AssayHook, Journey, Evolution, Realization, CandidateManifest, SystemCommit` from `@artyfact/model`.
`ReadinessReport.modelReadiness.findings` carries model `Finding`s (`rule`, `level`, `subject?`).
`ModelBundle.source?` is set by the client.

`client.ts` keeps every route in `paths` (all under `/api/systems/:id/...`; iteration-2 paths come from
`shared/api.ts` `routes`). Reads: `getSystems, getModel(systemId, rev) → UiBundle, getReadiness, getEvolutions,
getCandidates, getEvaluations(systemId, {candidate?}), getConflicts, getHistory, getRevisions, getChangelog(systemId,
{limit?, before?}), getChangelogEntry, getCompareSystem / getCompareGenome(systemId, {from?, to}), getCompareFile(systemId,
{repo, from?, to, path}), listFiles(systemId, {repo, rev?}), getFile(systemId, {repo, rev?, path}), getBuilds(systemId,
{commit?, kind?, realization?}), getDeployments, getPhenomeEvents(systemId, query), getClientMode() → 'api' | 'fixture'`.
Writes: `startWork, promote` (a 409 rejects with `StaleBaseError { currentHead }`), `acceptAmendment`, `rejectAmendment`,
`createEvolution(systemId, body, adminToken)`, `commitFiles(systemId, realizationId, body, token)` (token = the realization
secret or the admin token; all send `Authorization: Bearer`). Intents (admin, `docs/design/ontology.md` §5): `createIntent`,
`getIntent`, `replyIntent`, `acceptIntent` (a 409 is `StaleBaseError`; a platform without intents answers 501).
`subscribeEvents(systemId, onEvent)` uses an EventSource (`SSE_TYPES`) and falls back to `{type:'poll'}` every 3 s.

**Fixture fallback:** fixture mode means the API is **unreachable** (network error or non-2xx on `/api/systems`). A
reachable API with no Systems is a real empty platform: Home shows "No Systems yet." with an init link. In fixture mode
`getModel` serves `fixtures/peopling.model.json` with `source: 'fixture'`, `listFiles`/`getFile` serve the Genome
from `fixtures/peopling.files.json` (app scope is empty), `getRevisions` returns head only, other list reads return
empty lists, entry/compare reads 404 and writes throw `FixtureModeError`. The TopBar and Home header then show "fixture
data" and "Retry API" (`resetClientMode()` + refetch); the cause is logged with `console.warn`. The fixture summary
zero-fills the iteration-2 `SystemSummary` fields. Both fixture files are generated from `examples/peopling-system`
by `npm run build:fixture -w @artyfact/platform` (`scripts/build-fixture.ts`).

`queries.ts` (TanStack Query 5). Hooks read `systemId`/`rev` from the route (iteration-2 hooks are disabled outside
`/s/`): `useSystems, useClientMode, useModelBundle, useReadiness, useEvolutions` (polls every 5 s),
`useCandidates(evolutionId), useEvaluations({candidate?})` (→ `Evaluation[]`), `useConflicts, useHistory,
useRealizationsTouching(nodeId), useRevisions` (→ `RevisionOption[]`), `useChangelog({limit?})` (infinite: rows are
`data.pages.flatMap(p => p.rows)`, `fetchNextPage()`), `useChangelogEntry(commitId), useCompare({level: 'system'|'genome',
from?, to}), useCompareFile({repo, from?, to, path}), useTree({repo, rev?}), useFile({repo, rev?, path}),
useBuilds({commit?, kind?, realization?})` (→ `Build[]`), `useDeployments()` (→ `{production, history}`),
`usePhenomeEvents(query)`. Mutations: `useStartWork, usePromote, useAcceptAmendment, useRejectAmendment,
useCreateEvolution, useIntent(proposalId), useCreateIntent, useReplyIntent, useAcceptIntent, useManualCommit` (`{commit, realizationId?+token? | evolutionId? | newEvolution?, adminToken?}`:
create the Evolution if needed, start an `origin: 'editor'` realization, then `commitFiles` with its secret).
`useSystemEvents()` is mounted once by the Shell and invalidates per `SSE_INVALIDATIONS`. Keys are in `qk`; every key
starts with `[name, systemId]`, so `invalidateQueries({ queryKey: [name, systemId] })` reaches every variant.

## Components (`components/<Name>/<Name>.tsx`)

- `NodeChip { id, label?, kind?, showId?, size?: 'sm'|'md', onSelect?, interactive? }`: shows
  glyph + name, and clicking focuses the id. `interactive={false}` renders static text.
- `VerdictBadge { verdict: UiVerdict, label? }`: sets `data-verdict` and `data-tone`; only pass is green.
- `Tabs<T> { tabs, value, onChange, label, children? }`: `.u-segments` with arrow-key navigation.
- `Drawer { open, label, width, onWidthChange?, minWidth?, maxWidth?, children }`: becomes a bottom sheet at 640 px and below.
- `Derivation { finding } | { derivation }` (`components/Derivation`): collapsible outline of why a rule fired. `finding` is a
  model `Finding`; `derivation` is any `explain()` tree (`DerivationTree`, re-exported). Depth limit 6 then "…", EDB facts as
  `relation(args)` with NodeChips for known ids, "Copy as text" button. `derivationText(tree)` gives the same outline as a string.
- `Meter { title, headline, segments: {key,label,count,tone: pass|fail|warn|subtle}[], caption, asOf?, emptyText? }`: one segmented
  count bar per state; each has its own scale and is never summed with another.
- `Card { as?, title?, headingLevel?, actions?, state?, to?, children }`: the one card surface (opaque, subtle border, radius
  md, no shadow, never nested). `to` makes the whole card one `Link` with `u-brackets` (then no `actions`). `data-state`
  `attention` = apricot border, `unbuilt` = dashed.
- `StatusChip { status, label?, tone?: neutral|attention|fail|pass, glyph?, title? }`: bordered status word. `tone="pass"`
  renders only for `passed` / `pass`; `buildTone(status)` maps a build status to a tone.
- `RevisionPicker { id, label, value, onChange, options }`: labelled native select grouped Head · System commits ·
  Candidates (options from `useRevisions()`); an unlisted `value` stays selectable.
- `LineDiff { from, to, label, context? }`: unified line diff (`data-op add|del|ctx`, sign cells, 3 lines of context, longer
  unchanged runs behind "… n unchanged lines"); a null side means the file was added / removed. Pure core: `hunks.ts` `lineDiff()`.
- `CodeView { value, path, label, readOnly?, onChange? }` (default export; always `lazy()`-import it): CodeMirror 6 with line
  numbers, yaml/js/ts/json/md by extension and token colours; read-only sets `aria-readonly`. Tests: `@/testing/codemirror`
  `editorText(root)`, `typeInEditor(root, text)` (throws when read-only).
- `CopyButton { value, label? }` (announces "Copied" / "Copy failed"),
  `EmptyState { title, children?, action?, kind?: empty|error, onRetry?, headingLevel?: 2|3|4, live?, surface? }`: empty = "{Thing} yet." +
  how it fills + one action; `kind="error"` adds `role="alert"`, the title in the danger colour and "Try again" from `onRetry` (`live`
  adds `role="status"` to an empty state). One per region; `surface` only at page level. Never "— unknown.".
  `Breadcrumbs { ids, label? }`, `KeyValue { data, omit? }` (strings that are ids render as chips).
- `NodeChip` also takes `glyph?: boolean`; `<KindGlyphs hidden>` hides the kind glyph of every chip inside. Verdict rows hide
  it, so ✓ beside a verdict always means pass.
- `Button` (`components/ui`) also takes `reason?: string`: a reason disables the button and renders as visible `--type-meta` text
  beside it, linked by `aria-describedby`. A disabled primary uses `--color-primary-disabled-bg`. `aria-pressed` toggles are styled
  once (on = apricot border + one surface step; ghost toggles use the selection rule). Card padding is 20 (16 below 640px).

### Page primitives (UI refresh foundation)

Shape every view from these; see `/style` (each sample has `data-style-sample`) and `theme/README.md` for the rules.

- `PageHeader { title, purpose?, context?, primary?, secondary?, status?, variant?: standard|system|compact, titleId? = "view-title", titleRef?, children? }`
  (`components/PageHeader`): the view's only h1 (`tabIndex=-1`, focus target). One primary per view; it turns secondary while a Panel
  with its own primary is open. Actions wrap under the purpose below 640px, primary first. `system` sets the System name in
  `--type-system` (Overview); `compact` (canvas) puts the scope path inline and makes `purpose` the h1's accessible description;
  `children` is a toolbar row. `context` defaults to `useScopeContext()` (pass `null` to hide).
- `useScopeContext(): ScopeCrumb[]` (`{ label, to? }`, the last has no `to`): System / Thing / View inside a Thing workspace,
  Environment / System / … / node on a Map `?scope=`, else `[]`. `ScopePath { crumbs, label? }` renders it (plain links, current as
  text with `aria-current="page"`, never markers). The Shell still renders its own Thing breadcrumb until the shell slice removes it.
- `Section { title, headingLevel?: 2|3, description?, count?, actions?, surface?: none|panel, id? }`: a titled region (`section`
  labelled by its heading, `--type-h2`); sections are `--spacing-10` apart.
- `Panel { title, headingLevel?, primary?, secondary?, onBack?, backLabel?, autoFocus? = true }`: the container that replaces the region
  it is about. Focus moves to its h2 on open and back to the opener (else `#view-title`) when it unmounts. `backLabel` names the region
  ("Back to Work").
- `ListDetail { list, detail, listLabel, detailLabel?, hasSelection, onBack?, backLabel?, listWidth?: narrow|wide }`: list pane 20 / 24rem
  (sticky, own scroll) beside the detail. Below 900px only one pane shows (CSS): the detail when `hasSelection`, with the back link.
- `RowList { label, density?: standard|compact }` + `Row { to? | onSelect?, current?, tone?: neutral|attention|fail, title, meta?, status?, trailing? }`:
  registers, queues, ledgers. The whole row is the link or button (`aria-current="true"` when current: left rule + one surface step);
  `trailing` actions sit outside it. Rows are divided by `--color-border-faint`. Compact (36px) is for non-interactive rows.
- `MetaLine { items: { label?, value, code?, title? }[] }`: a `dl` of facts separated by space, never "·".
- `StatusText { status, label?, tone?: neutral|attention|fail|pass, glyph?, title? }`: inline glyph + word, no border (default glyphs
  ◔ × ✓ ○). `pass` only for `pass`/`passed`. `StatusChip` stays for headers (one per row).
- `Count { n, tone?: attention|neutral, hideZero?, srLabel? }`: tabular; attention is apricot and hidden at zero; `srLabel` makes a
  link read "Review, 2 waiting"; `null` is "unknown".
- `Kbd { keys, sequence? }`: `"Mod"` is ⌘ on Apple platforms and Ctrl elsewhere (`platformKey`, `isApplePlatform`).
- `Steps { steps: { id, title, state: done|current|todo, summary?, onEdit? }[], label?, children }`: Start only; children are the
  current step's body.
- Forms (`components/Form`): `Form`, `Field { label }`, `Check`, `FormActions`, `Reason { tone?: "error" }`, and `formStyles`
  (`box` is the former Work `.panel`). `Facts { items: { term, value }[] }`, `CommandBlock { title?, commands, copy? }`,
  `EntryLayout { header }` (pages outside the shell). No view imports another view's CSS module.

## Views added in iteration 2

- `views/changelog`: System commits newest first; a row expands into its `ChangelogEntry` (`?commit=` expands and marks one,
  `?evolution=` filters, `?panel=new` opens the New Evolution panel). `views/compare/genomeDelta.ts` joins an id-level
  `ModelDelta` with both sides' models for `SemanticDelta`.
- `views/compare`: two `RevisionPicker`s + Swap, levels System / Genome / Files (`?from=&to=&level=&repo=&path=`).
- `views/work/panels/NewEvolutionPanel.tsx`: admin form behind "+ Evolution" (Work and Changelog).
- `views/review/`: the decision queue (`queue.ts` `reviewQueue()`, pure; `useReviewQueue()` over the Work queries) beside
  `CandidateReview` or `PromotionPanel` from `views/work/panels`. `model/useReviewCount()` feeds the rail, Overview and Work cards.
- `views/work/intent/`: "Describe a change" (`?panel=intent`), opened from the Work header, a Home card, the Inspector and Code
  (`&anchor=<nodeId>`); while open it replaces the list and detail ("Back to Work" closes it). Message → proposal (`&proposal=`): routed path, provider label, the agreement tree
  (Agree, Reject or Defer per node, persisted by `decideIntent`), problems, inline replies, "Accept agreed" → commits the agreed Genome change and opens the candidate on Work.
  Fixture mode disables writes and shows `intent/sample.ts` read-only.

## Inspector (`inspector/`)

Open iff `focus` is set. Header: chip, kind, id + copy, containment breadcrumbs and "Open in"
buttons (`openInViews`). Focus (non-modal): opening moves focus to the title (`h2`, tabIndex -1).
If the focused element disappears while it is open, focus returns to the title. Closing restores
focus to where it was before opening, else to `<main>`. Tabs: What · Why · Dependencies · Changes · Rules & claims · Evidence.
Changes and Evidence are stubs wired to `useRealizationsTouching` / `useModel().verdictOf`.
Their slices replace them with `registerTab("changes" | "evidence", Component)` from
`@/inspector/tabRegistry`. Only the six `InspectorTab` ids are accepted (`what`, `why`,
`dependencies`, `changes`, `rules`, `evidence`); new tabs need a shell change. The component gets `{ entry }`. Call it at module
top level in the view module or in a file under `inspector/bodies/`.

**What-tab bodies:** Genome nodes use `inspector/NodeBody.tsx`: the kind's hint `fields` in order (lists of records as a
table), then the containment children; the header shows the hint `title` as the name and the `summary` field under it.
Model objects with their own shape (System, Thing, Section, criteria, claims, steps, ...) register a body in
`inspector/bodies/<Type>Body.tsx`:

```tsx
import { registerBody, type BodyProps } from "./registry";
function HookBody({ entry }: BodyProps) { /* entry.item is the AssayHook */ }
registerBody("hook", HookBody);
```

Every `.tsx` in `bodies/` is imported eagerly by `bodies/index.ts`, so no other edit is needed.
Calling `registerBody` from a view module also works; the Inspector re-renders when it loads.
Other unregistered objects use `GenericBody`, a key/value dump. Never register a body for a template node kind.

## Shell

SideNav: Overview, then three `role="group"` sections headed by the layer name (`aria-labelledby`) with its question as a
quiet subline (`aria-describedby`, `LAYER_QUESTIONS`): Genome (Map, Journeys, Theory, Code), Proteome (Work, Review,
Evaluations, Changelog), Phenome (Deployments), then Private Parts. Review shows `useReviewCount()` when above zero. Compare
is off the rail (`g x`, Changelog's "Compare with parent"). Each link keeps the global params; at 640 px and below labels
and questions become screen-reader only while the layer heads stay visible. The wordmark links to Home.
Map bands: with template `view.layers`, a scope's children are its nearest descendants whose kind is in a layer (undrawn
containers are looked through), drawn in one labelled band frame per layer in template order along the flow; the rail's
Filters list the layers. Without layers, every kind is drawn and children band by containment depth (no frames). The Layer switch lives in the Map
header (visual label "Overlay", `aria-label="Layer"`); `?layer=` stays global.

⌘K / Ctrl+K opens the palette. Esc clears focus. `[` / `]` move to the previous / next sibling.
`g` then `o m j t c w r e l x d` goes to Overview, Map, Journeys, Theory, Code, Work, Review, Evaluations, Changelog, Compare,
Deployments (`h`, the old History key, opens the Changelog). Shortcuts are ignored while typing in inputs
(`isTyping(target)`, exported from `app/Shell.tsx` for views' own shortcuts, e.g. the Map's Backspace).

## Tests

vitest + Testing Library (jsdom). Import `@/testing/render` and call
`renderApp(url, routes?, seed?)`. It cleans up, stubs `fetch` offline, polyfills cmdk's jsdom gaps
and preloads the fixture bundle. `routes` replaces the real route table. `seed(qc)` runs before
rendering to put more data in the cache, e.g. `qc.setQueryData(qk.evaluations(systemId), { evaluations })`.
It returns `{ router, qc, ...renderResult }`. E2E: `e2e/mockApi.ts` `mockApi(page, overrides?)` fulfils `/api/**`
from realistic data (two Systems, changelog, compare, files, builds, deployments, Phenome events) for populated visuals in
fixture mode. Tests may import `@/api/fixtures` directly; app
code must not import it statically, because `client.ts` loads it with `import()` to keep the
JSON out of the main chunk.
Navigation is async under the data router, so wrap URL assertions in `waitFor`.
