# SPA contracts (apps/platform/src)

What the view slices (Map, Journeys + Theory, Work/Evaluations/History/Overview) code against.
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

`/s/:systemId/r/:rev/{overview|map|journeys|theory|work|evaluations|history}`. `/` redirects to
`/s/system.keep-in-touch/r/head/overview`; `/s/:id/r/:rev` redirects to its overview; `/style`
is the style sheet. The `/s/:systemId/r/:rev` loader prefetches the model bundle (`modelQuery`)
and does not re-run on search-param changes.

Global params, kept by every nav link: `focus` (any indexed id), `layer`
(`genome|proteome|phenome`, default `genome`), `candidates` (csv). View-specific params (`journey`,
`step`, `evolution`, `realization`, `panel`, `evaluation`, `commit`) belong to their view and are
dropped when the view changes.

**View module contract:** `views/<name>/index.tsx` default-exports a component taking no props.
It is lazy-loaded inside `<main>`, under a `ModelProvider`, so `useModel()` and `useSelection()`
work. Use `<h1>` for the view title.

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

Containment: System → things → nodes by `parent`; journeys → steps. **Steps are indexed as
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

`status.ts`: `verdictOf(criterionId, evaluations, scope)` returns
`'pass'|'fail'|'unknown'|'stale'|'not-run'|'waived'`, using the latest evaluation in scope. No
in-scope evaluation means `not-run`. `pass` counts only when execution is `completed`;
`not-run|queued|running|deferred` mean `not-run` and `error` means `unknown`. Other exports:
`rollup(index, nodeId, evaluations, scope)`, `verdictTone(v)` (`pass|fail|subtle`),
`promotedCandidates(commits, rev)` and `verdictScope(selected, commits, rev)`.

**Verdict scope (binding):** with `?candidates=`, only those candidates' evaluations count.
Without it, on `head`/`canonical` or a System commit id, only candidates promoted into that
revision count (from History: `commits[].candidates` from that commit back). If there are none,
every verdict is `not-run`, so an unpromoted candidate's pass never shows green on the canonical
view. Any other `rev` is treated as a candidate id and scopes to itself. `ModelProvider` derives
the scope; prefer `useModel().verdictOf` and `useModel().rollup`.

`kinds.ts`: `KINDS` / `kindInfo(kind)` (glyph + label for every kind), `bestViewFor(kind)`,
`VIEWS`, `VIEW_LABELS`.

## API (`api/`)

DTOs: `shared/api.ts` re-exports `Verdict, Execution, Evaluation, Finding, Readiness, Criterion,
AssayHook, Journey, Evolution, Realization, CandidateManifest, SystemCommit` from `@artyfact/model`.
`ReadinessReport.modelReadiness.findings` carries model `Finding`s (`rule`, `level`, `subject?`).
`ModelBundle.source?` is set by the client.

`client.ts` keeps every route in `paths` (all under `/api/systems/:id/...`). Reads: `getSystems,
getModel(systemId, rev) → UiBundle, getReadiness, getEvolutions, getRealization, getCandidates,
getEvaluations(systemId, {candidate?}), getConflicts, getHistory, getPacket`. Writes: `startWork,
submit, promote` (a 409 rejects with `StaleBaseError { currentHead }`) and `acceptAmendment`.
`subscribeEvents(systemId, onEvent)` uses an EventSource and falls back to `{type:'poll'}` every 3 s.

**Fixture fallback:** if `/api/systems` fails or is empty, `getModel` serves
`fixtures/keep-in-touch.model.json` with `source: 'fixture'`, list reads return empty lists and
writes throw `FixtureModeError`. The TopBar then shows "fixture data". The fixture is generated
from `examples/keep-in-touch-system` by `npm run build:fixture -w @artyfact/platform`
(`scripts/build-fixture.ts`: `loadSystem` + templates, readiness from `validate`).

`queries.ts` (TanStack Query 5). Hooks read `systemId`/`rev` from the route: `useSystems,
useModelBundle, useReadiness, useEvolutions` (polls every 5 s), `useRealization(id), useCandidates(evolutionId),
useEvaluations({candidate?})` (→ `Evaluation[]`), `useConflicts, useHistory, usePacket(id),
useRealizationsTouching(nodeId)`. Mutations: `useStartWork, useSubmit, usePromote,
useAcceptAmendment`. `useSystemEvents()` is mounted once by the Shell and invalidates queries per
event. Keys are in `qk`.

## Components (`components/<Name>/<Name>.tsx`)

- `NodeChip { id, label?, kind?, showId?, size?: 'sm'|'md', onSelect?, interactive? }`: shows
  glyph + name, and clicking focuses the id. `interactive={false}` renders static text.
- `VerdictBadge { verdict: UiVerdict, label? }`: sets `data-verdict` and `data-tone`; only pass is green.
- `Tabs<T> { tabs, value, onChange, label, children? }`: `.u-segments` with arrow-key navigation.
- `Drawer { open, label, width, onWidthChange?, minWidth?, maxWidth?, children }`: becomes a bottom sheet at 640 px and below.
- `CopyButton { value, label? }`, `EmptyState { title, children?, action? }`,
  `Breadcrumbs { ids, label? }`, `KeyValue { data, omit? }` (strings that are ids render as chips).

## Inspector (`inspector/`)

Open iff `focus` is set. Header: chip, kind, id + copy, containment breadcrumbs and "Open in"
buttons (`openInViews`). Focus (non-modal): opening moves focus to the title (`h2`, tabIndex -1).
If the focused element disappears while it is open, focus returns to the title. Closing restores
focus to where it was before opening, else to `<main>`. Tabs: What · Why · Dependencies · Changes · Rules & claims · Evidence.
Changes and Evidence are stubs wired to `useRealizationsTouching` / `useEvaluations`; their
slices may replace them by registering richer bodies or by proposing a change.

**What-tab bodies:** add `inspector/bodies/<Kind>Body.tsx`:

```tsx
import { registerBody, type BodyProps } from "./registry";
function ScreenBody({ entry }: BodyProps) { /* entry.item is the OntologyNode */ }
registerBody("screen", ScreenBody);
```

Every `.tsx` in `bodies/` is imported eagerly by `bodies/index.ts`, so no other edit is needed.
Calling `registerBody` from a view module also works; the Inspector re-renders when it loads.
Unregistered kinds use `GenericBody`, a key/value dump.

## Shell

SideNav has seven links: Overview · Map · Journeys · Theory · Work · Evaluations · History. Each keeps the global params.


⌘K / Ctrl+K opens the palette. Esc clears focus. `[` / `]` move to the previous / next sibling.
`g` then `o m j t w e h` goes to that view. Shortcuts are ignored while typing in inputs.

## Tests

vitest + Testing Library (jsdom). Import `@/testing/render` and call `renderApp(url, routes?)`.
It cleans up, stubs `fetch` offline, polyfills cmdk's jsdom gaps and preloads the fixture bundle.
Navigation is async under the data router, so wrap URL assertions in `waitFor`.
