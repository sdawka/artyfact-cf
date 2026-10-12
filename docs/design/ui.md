# Appendix C — UI design (apps/platform/src)

## C.0 Foundations
react-router 7 data mode; routes `/s/:systemId/r/:rev/{overview,map,journeys,theory,work,evaluations,history}`; global params `focus`, `layer`, `candidates` preserved by nav links; view-specific `journey`, `step`, `evolution`, `realization`, `panel`, `evaluation`, `commit`. TanStack Query 5 for all API calls (poll `/work` 5 s or SSE). `src/api/client.ts`: getModel, getEvolutions, getEvaluations, getHistory, getPacket, startWork, submit, promote; fixture fallback. `src/model/`: `useModel()` {model, byId, children, parent, crossLinks, criteriaFor, rollup}, `useSelection()` {focusId, setFocus(id,{view?}), layer, setLayer, candidates, setCandidates}, `status.ts` verdictOf/rollup (only pass → success colour). `NodeChip` kind→glyph for all kinds.

## C.1 Shell
TopBar: Wordmark (Brilon), SystemRevisionSelector (+ state pill canonical | candidate | deployed), PhaseBadge, LayerSwitch (tapered segments), ⌘K CommandPalette (cmdk over byId). SideNav Overview·Map·Theory·Work·Evaluations·History. Main Outlet. InspectorDrawer right 380px resizable, open when focus set; Esc closes; `[`/`]` siblings; `g m`/`g w` shortcuts. Grid `auto 1fr auto`.

## C.2 Map
Files `MapView, useMapGraph, layout/elk.ts, nodes/{SubjectNode,ExternalNode,BoundaryNode,GroupNode}, edges/{CrossLinkEdge}, HierarchyTree, Breadcrumbs, MapFilters, overlays/{PhenomeBadge,ProteomeBadge,CandidateHalo}`. Semantic zoom: focus + children + cross-links among them + touching Externals; double-click child = new focus; breadcrumb/Backspace out. elk layered RIGHT, `hierarchyHandling: INCLUDE_CHILDREN`, orthogonal edges, Externals partition 0 / internals 1, run in Web Worker, memoised per (focus, filters). Containment = nesting, not edges. Edge data `{type: serves|invokes|governs|reads|writes|storedIn|dependsOn|interactsWith, certainty: declared|assumed|proposed}` → solid/dashed/dotted; label chip; hover fan-out. Overlays: Genome plain; Proteome realization-count + apricot ring; Phenome 5 counters (pass green, fail danger, rest subtle); Candidates bracket halo, double bracket + "overlap" chip on shared nodes. HierarchyTree virtualised with keyboard; Breadcrumbs; filters kinds/link types/Externals/findings-only.

## C.3 Journeys (React Flow + elk, not Mermaid)
`JourneysView` (catalog left + canvas), `useJourneyGraph`, nodes Action/System/External/Wait/Decision/Terminal, legend. Lanes actor|system|external as elk partitions with translucent bands; failure/cancel edges dashed danger; branch labels; segments as tabs; provisional steps dotted with "?"; step click sets `?step=` and opens Inspector with jump links ("Open screen.people in Map").

## C.4 Theory
5-column CSS grid Purpose → Beneficiaries → Activities → Outputs → Outcomes (T1–T5); SVG bezier links from DOM rects; inspector shows mechanism/assumptions/indicator/method/horizon/observations; GapsSummary from findings `theory.*`; banner "hypotheses, not a validated causal model".

## C.5 Overview
PurposeCard; ThreeStatesRow (Model readiness · Implementation conformance · Outcome progress — never summed); ActiveEvolutionsCard; BlockersList (→ rule id, facts, next action); PhaseCard; DeployCard; timestamps; literal "unknown".

## C.6 Work
EvolutionBoard columns by state; EvolutionCard scope chips; RealizationRow (agent, role, local/hosted, status, fork + short sha, last checkpoint or "unknown", changed subjects, ConflictChips typed); StartWorkPanel → PacketViewer (markdown, copy, CLI line, token countdown); CandidateReview tabs Semantic delta / Files / Evaluations, "select for composition" → `?candidates=`; PromotionPanel (manifest hash, base vs current head, required coverage table, disabled-with-reason, 409 stale message).

## C.7 Evaluations + History
Filterable table → expand Question/Method/Raw observations/Interpretation/Limitations/Provenance. History vertical timeline of System commits (manifest hash, parent, Evolutions, repo commits, rationale, phase/deploy), filter by Evolution.

## C.8 Inspector
Header (NodeChip, id copy, Open in Map/Journeys/Theory/Work) + tabs What (kind body registry `bodies/index.ts`, each agent appends own file) · Why (sources, GD→S→C chain, Purpose/Theory, commitment bundles) · Dependencies (links grouped by type) · Changes · Rules & claims (owner / subject / target on three lines) · Evidence.

## C.9 Theme
`src/theme/{tokens.css, whimsy.css (data-attribute block rewritten to :root), fonts/Brilon-Regular.woff2 + @font-face with Georgia fallback, utilities.css, reactflow.css}`; vanilla CSS + CSS Modules. Utilities: `.u-brackets` (4 L-corners 4px outside, opacity/scale 180 ms, reduced-motion safe; `--on` persistent), `.u-segments` (tapered 2px lines above/below active tab via mask-image), `.u-marker` (apricot /0.22 highlight). Verdict tokens map pass→success, fail→danger, unknown/stale/not-run→text-subtle (stale dashed). React Flow overrides: surface-secondary nodes, border-subtle, radius-md, no shadow, no pills.

## C.10 Ownership
A shell/api/model/theme/components/inspector skeleton → B map + `src/graph/*` → C journeys + theory → D work/evaluations/history/overview. A lands the contract commit (hook signatures, NodeChip props, route stubs, theme, client with fixture fallback) first.

## C.11 Tests
vitest jsdom: model index (`screen.people` children, `entity.ContactRecord` storedIn), status (not-run ≠ pass), useSelection, useMapGraph, useJourneyGraph (J.connect: failure edges, 3 lanes), PromotionPanel disabled/stale. Playwright per route with axe: overview P1 + three meters; map deep link breadcrumbs + grey badges; journeys J.contacts failure edge + inspector; theory T1–T5; work evolution.1 Start work → packet; evaluations/history empty states never green.

