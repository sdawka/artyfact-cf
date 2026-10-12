# artyfact design

artyfact is a System-centred collaboration platform on Cloudflare Workers and Artifacts: a typed model of a System (the Genome), views over it, and a multi-agent loop that realizes changes and promotes them by compare-and-swap.

- [model.md](model.md): metamodel, schemas, loader, validation, Keep in Touch encoding
- [backend.md](backend.md): Worker, Durable Object, Artifacts usage, agent protocol, hooks
- [ui.md](ui.md): views, routes, components, theme
- [rules.md](rules.md): Datalog engine and Rule Packs
- [semantic.md](semantic.md): System One question catalog and policy

## Execution model

**I do not write product code.** I orchestrate: write the task briefs (each self-contained: files owned, contracts to import, acceptance tests, done-criteria), spawn implementer subagents in isolated git worktrees, run reviewer subagents on their PRs, merge green PRs, and hold the integration points. Each implementer gets the relevant plan sections + appendices pasted into its brief (they don't share this conversation).

Model assignment (complex/contract-defining → **opus**; well-specified against fixed contracts → **sonnet**):
| Slice | Model | Why |
|---|---|---|
| 0.1 scaffold, docs/design | sonnet | mechanical |
| 0.2 rules engine | opus | semi-naive evaluation, stratification, derivations — correctness-critical |
| 0.3 model schemas/loader/toFacts/diff | opus | the shared contract everyone imports |
| 0.4 templates + rule packs | sonnet (packs reviewed by opus) | YAML + `.dl` against App. D |
| 0.5 semantic package | sonnet | thin client + catalogue from App. E |
| 0.6 platform skeleton + theme | sonnet | config + CSS vendoring |
| 1.1 Genome encoding | sonnet ×2 (split: ontology+spec+criteria / journeys+evolutions+rest) | transcription from the spec doc, verified by tests |
| 1.2 DO + Artifacts + routes | opus | CAS, idempotency, tree diffing |
| 1.3 hooks + queue | opus | engine composition, policy |
| 1.4 CLI + app scaffold | sonnet | well-specified |
| 1.5 UI shell/api/model hooks/inspector skeleton | opus | sets the UI contract |
| 2.1 Map | opus | elk + semantic zoom + overlays |
| 2.2 Journeys + Theory | sonnet | reuses 2.1's graph utils |
| 2.3 Overview + Inspector bodies + Derivation | sonnet | against fixed hooks |
| 2.4 Work/Evaluations/History | sonnet | against fixed API |
| 2.5 backend integration | opus | cross-seam debugging |
| 2.6 Amendment review UI | sonnet | against 1.3/1.6 outputs |
| 3.1 e2e + deploy | sonnet | |
| 3.2 README/video script | sonnet, then `humanizer` pass | |
Reviews: every PR gets a `feature-dev:code-reviewer` (opus) pass; silent-failure-hunter on hooks/DO. Sequencing: Wave 0 slices 0.2/0.3 first in parallel, 0.4–0.6 as soon as 0.3's schema types land; Wave 1 all five+1.1b in parallel; Wave 2 all in parallel; Wave 3 after merge.

## Waves (dependency graph for parallel agents)

Each task: own files only, TDD, vitest green, commit on a branch in its own worktree, PR. Wave N+1 starts when its listed dependencies have merged. Integrator (me) reviews/merges, never patches by hand — defects go back to the owning agent.

**Wave 0 — foundation (sequential, 1 agent, ~1–2 h)**
0.1 Repo scaffold: `git init`, workspaces, tsconfig, vitest workspace, LICENSE (Apache-2.0), README stub, `.gitignore`, move docx → `docs/source/`, write `docs/design/{model,backend,ui}.md` from Appendices.
0.2 `packages/rules`: `.dl` parser (relation decls, rules, `not`, `count`, `!=`, `contains/matches`), stratification check, semi-naive evaluator with derivation trees and iteration cap, `FactSet` with sha256 snapshot hash. Tests: ancestor closure, stratified negation, count, cycle detection, derivation shape, incomplete flag, parse errors. (Independent of 0.3; can run in parallel with it.)
0.3 `packages/model`: schemas incl. Template; `loadSystem` with template resolution; index; `toFacts()`; `validate()` = run pinned packs; `diffModels`; `overlap`; `toMermaid`; tests from App. A §5 against a *minimal* fixture (3 nodes) — the real example arrives in 1.1.
0.4 `packages/templates`: `template.system.social-networking.cloudflare@1`, `template.thing.cloudflare-worker-webapp@1` (sections ui/domain/authorization/runtime, base criteria C.webapp.exists/health + hooks, scaffold pointer, source-map defaults), `template.thing.vue-webapp@1` stub; rule packs `metamodel@1` (R1/R2/R10/R11 as rules), `readiness@1`, `topology.private-pairs@1`, `authorization@1`, `theory@1`, `journeys@1` (App. D); `index.ts` bundler; tests: each pack against a known-valid and a known-invalid mini model (spec §5 "test rule sets against known valid and invalid models").
0.5 `packages/semantic`: provider switch (typesafe/openrouter/fake/off, pattern from bropilot `system1.ts`), `ask()` with timeout/retry/cache, question catalog (App. E) as pure builders, `policy.verdict`, provenance record. Tests with `FAKE_S1=1` and recorded fixtures; one live smoke script gated on key presence.
0.6 `apps/platform` skeleton: wrangler.jsonc (App. B §1, + secret `TYPESAFE_API_KEY`), vite config, Hono `GET /api/health`, React "hello" with theme tokens vendored (`src/theme/{tokens,whimsy,utilities,reactflow}.css`, Brilon `@font-face` with Georgia fallback), `wrangler dev` boots. Types for API responses in `apps/platform/shared/api.ts`.

**Wave 1 — parallel (5 agents), depends on 0.x**
1.1 **Genome encoding** `examples/keep-in-touch-system/**` — every file per App. A §4 (ontology ~70 nodes, 8 requirements, 6+16 criteria, hooks, 7 journeys incl. J.control split into 4, 6 evolutions, kits with auth kit deliberately unpinned); thing.yaml uses the worker template. `loadSystem` → 0 errors; expected missing/warnings documented in a test. Also emits `apps/platform/src/fixtures/keep-in-touch.model.json` via a script.
1.2 **Backend core** `apps/platform/worker/{do,artifacts,routes/systems,evolutions,realizations,history}` — DO + SQLite, `walkTree/diffTrees` over the binding, `loadGenomeAt`, bootstrap/import, startRealization (fork, token, packet via `packets/task-packet.ts`), checkpoint, submit, promote CAS, history, SSE. DO tests with vitest-pool-workers and a mocked `ArtifactsRepo` interface.
1.3 **Hooks + Queue** `apps/platform/worker/hooks/*`, `worker/index.ts queue()` — engines manifest/diff/model-rules/system-one/http: exists, scope, overlap, genome-amendment (rules → Readiness → semantic review), interference, purposeMeasures, health; `source-map.ts` (picomatch); Evaluation + provenance recording; `events_seen` idempotency; pure unit tests with `FAKE_S1=1`. Depends only on model/rules/semantic packages + the DO RPC *signatures* from App. B (import a `SystemAuthorityLike` interface so 1.2 and 1.3 don't block each other).
1.6 **Readiness in the DO + API** (small; can be folded into 1.2) — `GET /systems/:id/readiness?rev=` returns the pinned `Readiness` (snapshot hash, pack versions, findings with derivations); DO caches per genomeCommit; `actionable` flag per Evolution scope = no hard violation among its affected nodes' obligations.
1.4 **CLI + app scaffold** `packages/cli/**`, `examples/keep-in-touch-app/**`, `scripts/bootstrap.sh` — CLI commands against a mock platform server + temp bare git repo; app scaffold: Hono + D1 (`migrations/0001_contacts.sql`), `GET /health` returning `{status:'ok', buildId}` from `wrangler.jsonc` var / git sha, `/people` skeleton, `source-map.yaml`, vitest with pool-workers, README with run instructions.
1.5 **UI shell** `apps/platform/src/{app,api,model,components,inspector/InspectorDrawer+Header+tabs skeleton}` + route stubs — App. C §0–§1 and §9 utilities; fixture fallback; tests for `useSelection`, `status.ts`, model index.

**Wave 2 — parallel (5 agents), depends on 1.1 + 1.5 (UI) / 1.2 + 1.3 (backend)**
2.1 **Map** `src/views/map/**`, `src/graph/{elk,useElkLayout}.ts` — semantic zoom, Externals partition + boundary, typed/certainty-styled edges, layer overlays, candidate halo (double bracket = overlap), HierarchyTree (virtualised, keyboard), breadcrumbs, filters. Publish `src/graph/elk.ts` first for 2.2.
2.2 **Journeys + Theory** `src/views/journeys/**`, `src/views/theory/**`, inspector bodies Step/Claim — React Flow + elk with 3 lanes, failure/cancel edges, segments, provisional steps; Theory 5-column logic model with SVG links, GapsSummary, banner.
2.3 **Overview + Inspector bodies + Readiness explorer** `src/views/overview/**`, `src/inspector/bodies/{Screen,Entity,Criterion,External,Operation,Policy,Thing,System}Body.tsx`, `src/components/Derivation.tsx` — three separate meters, blockers → rule id + contributing facts + collapsible derivation tree (which rule, which tuples), pack versions + snapshot hash shown, timestamps, literal "unknown". Inspector "Rules & claims" tab lists obligations derived for the node (e.g. `governedBy`) with derivations.
2.6 **Genome amendment review UI** `src/views/work/panels/AmendmentReview.tsx` — for a `target: genome` candidate: semantic delta, Readiness diff (findings resolved/added), System One signals per change (changeClass with probabilities, commitment contradictions, weakening, specificity), accepted-interpretation textarea, Accept/Reject (admin). Visual: probabilities as plain numbers + confidence bar; anything < 0.9 labelled "review", never auto-styled as pass.
2.4 **Work + Evaluations + History** `src/views/work/**`, `src/views/evaluations/**`, `src/views/history/**`, inspector Changes/Evidence tabs — board by Evolution state, RealizationRows with conflicts, StartWorkPanel → PacketViewer + CLI line + token countdown, CandidateReview (semantic delta / files / evaluations), PromotionPanel (coverage table, stale-base 409 handling), History timeline.
2.5 **Backend integration** — wire 1.2 + 1.3 + 1.4 end-to-end against remote Artifacts: `scripts/bootstrap.sh` run, `POST /systems/import`, start two realizations, push from two clones, confirm Queue + CLI submit both idempotent, overlap report appears, promote, history. Fix seams; write `docs/demo-runbook.md`.

**Wave 3 — integration & submission (2 agents + me)**
3.1 E2E: Playwright smoke per route (App. C §11) + axe; full `npm test`; `wrangler deploy` to a public URL (Brilon → Georgia unless licence confirmed); D1/R2/Queue resources created with `wrangler`.
3.2 README (vision, how Cloudflare is used, run instructions, architecture diagram), LICENSE check, demo video script following `docs/demo-runbook.md`; submission form fields drafted.

