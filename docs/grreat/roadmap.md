<!-- grreat:record id=roadmap.next kind=roadmap_item status=active parent=goal.north-star -->
# Intent authoring and ontology integrity

## Active follow-up: local self-development bootstrap

- Intended outcome: one improvement planned in local Artyfact, implemented by a local agent, verified on Cloudflare, approved in Artyfact, then run by the local instance. Hosted operation follows later.
- Baseline: merged UI refresh #83 plus Task/model forks and Artifacts publisher #84. Reuse Work, Review, exact integrated fork references, and explicit model approval.
- Work: (1) verification-only Cloudflare Workflow with immutable source/model identity, test evidence and output digest, no deployment credentials; (2) trusted polling into local Review and promotion guards; (3) publish verified outputs without rebuilding and activate the approved source with persistent local state; (4) use that loop for development events, transactional outbox, authenticated K2 and explicit Basin analytics bridge.
- Acceptance: failed, stale, mismatched or forged CI cannot approve; explicit model approval names the accepted model; retries reuse the same output/release; local restart retains history; replay deduplicates by event ID. Prove the complete loop against real Cloudflare separately from local/fake-provider tests.
- Constraints: source remains at its approved Artifacts fork/commit; no required source-main synchronization. Development analytics stays separate from runtime observations. Approval is a human action. Hosting the operator is deferred.

## Earlier follow-up: intent and integrity foundations

The user approved the foundation scope and repairing/enriching Artyfact’s app System map. The user approved implementation of the [architectural design](../design/intent-integrity.md); the [implementation plan](../design/intent-integrity-plan.md) defines ownership, contracts, tests and acceptance. Canonical Markdown remains authoritative; preserve existing release evidence and the earlier work below.

## Earlier follow-up: app intention alignment

Accepted implementation plan, 2026-10-14. Close the six confirmed gaps in [[journals/2026-10-14-intention-spike]] and unify Review. Extend PR #77 with one commit per fix; keep local agents, optional Parts, Genome-only Things and separate Genome/implementation approval. Finish at a green review-ready PR; no merge or deployment is included.

| Commit | Owner | Acceptance |
| --- | --- | --- |
| 1. Fix acceptance contract drift detection | Lifecycle Sol | Criteria, hook, source-reference and automatically enforced gate changes require replan; disjoint advances preserve pinned provenance. |
| 2. Scope operational controls to the selected Thing | Runtime Sol | Only eligible Thing bindings can load metrics or mutate flags; scope changes clear editors synchronously; no-binding Things issue no operational requests. |
| 3. Complete the local agent onboarding handoff | CLI Sol | `ontology bootstrap --prepare-only` materializes reviewed files without provisioning; correct origin/credential placeholders and destination skill; minimal scaffold preparation, reviewed init, real node-scoped draft, no imaginary plan file. Genome-only is a valid stopping point. |
| 4. Scope runtime evidence and version summaries | Runtime Sol | Observations never become passes; implementation evidence is separately labelled and exactly associated; scope-matched totals never borrow heterogeneous lineage. |
| 5. Add scoped runtime event pagination | Runtime Sol | Exact Thing/build/output filters precede pagination; cursor loading and retry preserve evidence; scoped totals are stable and scope navigation resets pages. |
| 6. Offer recovery for expired task attempts | CLI Sol | Shared availability rules recommend resume while preserving dependencies, writer exclusion, credentials fencing and dirty work. |
| 7. Unify pending decisions in Review | Integration Sol | One inbox/count per decision, exact Task candidate diffs/evaluations, integrated review and safe promotion; Work retains execution. Errors never claim an empty inbox. |

Execution: primary owns orchestration and verification. Four isolated Sol worktrees; Runtime delivers 2 → 4 → 5 and CLI delivers 3 → 6 serially. Integration owns shared interfaces/root routes and applies the six worker commits before its Review commit. One writer per overlapping file; final lifecycle/CLI review-link edits follow their owners' completion. No worker PRs or child agents. Canonical notes have one primary writer.

Interfaces: optional exact `thing`, `build`, `output` Phenome filters; cursor affects rows but not scoped totals; no data migration. Dedicated Task-review and changed-file endpoints validate plan/task/candidate/path ownership and retain existing visibility. Review links use `?plan=&task=` for Task selection and `?plan=` for implementation promotion; execution remains in Work. Existing CLI JSON fields and legacy routes remain compatible. Custom ontology validation remains server-authoritative; local source preparation must not bypass Task-based feature implementation.

Validation: failing regressions before fixes; isolated baseline dependencies from the lockfile; focused unit/Worker/UI checks; complete fake-provider onboarding-to-runtime browser journey with direct links, error/polling states, mobile, keyboard and reduced motion. Independent Sol review, full `npm run ci -- --ultra-compact`, GRREAT validation and versioned sync attempt, then all hosted checks green on the final PR head. No production-write or real-Artifacts evidence is inferred from fake-provider tests.

## Earlier Parts delivery

- Intended outcome: Implement [[goals]] using the contracts in [model](../design/model.md), [backend](../design/backend.md), and [UI](../design/ui.md).
- Work: For this delivery, the primary only orchestrates Sol agents and owns final judgment. The Sol integration implementer owns shared DTOs, authority/schema/routing integration, canonical docs, lockfile, validation, and preparation of the single draft PR. Workers own only their assigned paths, accommodate other edits, and do not spawn children or create PRs.
- Dependency order: C1 and C7 start together. Once C1 contracts stabilize, C2/C3/C4 can run in parallel. C5 follows C3. C6 follows C2/C3. C7 finalizes executable guidance after C4. C8 reviews the integrated branch. No schedule estimates.

### Task 1: C1 — model and pure composition (hard)

Own `packages/model/`, `packages/templates/`, and directly affected rule-pack validation. Define immutable Part packages, pinned recipes, distinct contribution identity, output mappings, optional Parts/artifacts, safe deterministic composition/extraction/upgrades, and legacy adapters. No command execution in model loading. Tests cover nested/repeated Parts, collisions, scoped replacement, masking, parameterization, extraction, three-way upgrade conflicts, and legacy loading. Return exported contract names and test evidence early for dependents.

### Task 2: C2 — package catalog (medium)

Own `apps/platform/worker/parts/**`, `worker/routes/parts.ts`, and dedicated tests. Store/import immutable exact versions, enforce shared versus System-private visibility and dependency closure, authorize writes/read scope, and expose list/detail provenance. Primary integrates authority/schema/service/router/shared DTO changes. Depends on C1.

### Task 3: C3 — realized outputs and evidence (hard)

Own `worker/deployments.ts`, `worker/phenome.ts`, `worker/do/builds-store.ts`, `worker/do/phenome-store.ts`, related routes and dedicated tests. Preserve independent realized output and deployment identities, source/Genome lineage and verified Thing/source-binding association. Unknown historic lineage stays unknown; no commit-derived synthetic outputs. Primary owns shared DTO/schema/authority/service edits. Depends on C1 and primary contracts.

### Task 4: C4 — CLI authoring (hard)

Own `packages/cli/**`. Implement `parts` create/extract/validate/publish/compose/upgrade with previews, pinned inputs, safe filesystem paths, explicit local command execution, saved output/provenance and customization-preserving conflict reporting. Preserve existing realization `compose` and Genome/app review stages. Use catalog mocks until C2 integrates. Depends on C1 contracts.

### Task 5: C5 — CI lineage (medium)

Own `apps/ci/**` except primary-owned `src/contract.ts`. Report build/output/source/Genome identity; preserve command allowlists, authorization, and secret boundaries. Depends on C3.

### Task 6: C6 — application experience (medium)

Own `apps/platform/src/**` and browser tests. Show separate Systems and reusable Parts sections, keep System-private Parts scoped, inspect package provenance and source/realized/runtime aspects. System entry now opens the Map environment even with one Thing, superseding the earlier automatic Thing entry; explicit Thing workspaces retain System breadcrumb/overview and stable direct links when another Thing is added. Depends on C2/C3 contracts.

### Task 7: C7 — public pages (medium)

Own `apps/site/**`. Update `/`, `/model`, `/connect-agent` and explorer/guide tests for optional Parts, Genome-only Things, source versus realized output, and examples. Keep Bring your agent primary. Preserve static/no-JS content, accessibility, mobile/reduced-motion behavior; do not advertise unimplemented commands. Can start with C1, finalize after C4. The approved homepage illustration uses expressive cards in one luminous System container: recognizable Genome shape, solid Proteome application, and clearly illustrative Phenome activity, with scroll/manual view controls and readable static fallbacks.

### Task 8: C8 — integration review (reviewer)

Read-only whole-branch correctness/security/regression review. Primary fixes findings, runs repository gates, pushes and opens/updates one PR. Merge only with all CI green; release evidence is separate from local tests.

## Completion criteria

1. A Thing exists with Genome, zero Parts and no source yet; old templates and IDs still load.
2. An Astro-style source template plus overlapping component system requires declared replacement and adapts callers/config through an explicit recipe command; undeclared collisions fail without writes.
3. Nested/repeated Parts retain contribution identity; extraction masks actually exclude payload, source is unchanged; upgrade preserves customization or reports conflicts.
4. Shared and System-private catalogs enforce access and dependency visibility; published versions cannot mutate.
5. Multiple builds of the same source produce distinct realized outputs; deployments and Phenome evidence have authoritative Thing/source/Genome/output lineage; unknown history remains unknown.
6. Home shows Systems and Parts. System entry opens Map environment even with one Thing, while stable direct Thing links work across single-to-multiple transition; overview stays accessible. Product-wide luminous containers preserve state, accessibility and motion preferences without literal orbs.
7. Public pages and real CLI guidance agree; static and accessible pages remain usable. The homepage explains fullstack composition and explicit Button replacement, preserves source/output/runtime identity, and shows parallel views through native scrolling with keyboard, reduced-motion and short-viewport fallbacks.
8. Existing review gates, command allowlists, invalid-Genome review, criteria scoping, and changelog regressions pass; relevant tests, typecheck, builds, and browser checks pass against the integrated revision.

- First action: [[execution]]. Record exact evidence and remaining gaps in [[analysis]].

## Public model page follow-up

Revise `/model` to explain the System boundary, user-chosen Things and typed connections, form/content, optional Parts, Rule Packs, and Genome/Proteome/Phenome as parallel views. Use a clearly illustrative Artyfact change-scope feature; keep the homepage and backend unchanged. Verify static/no-JS, keyboard, reduced-motion, mobile, and homepage behavior before one site PR and site-only release.

Deferred capability gaps, outside this page revision: creation accepts a System with zero Things despite the one-or-more domain intent; design-system-specific rules and visual compliance are absent; runtime loads bundled Rule Packs rather than user-managed packs; change scope is manual without a separate intent-confirmation or automatic mapping step; external-agent handoff does not launch an agent; the illustrated acceptance test and event producers do not exist; transient workflow SSE is not a persisted Phenome stream. These require their own product and implementation decisions.

## Ontology Driven Development page revision

The accepted public-page direction now starts with six semantic-layer benefits, then explicitly introduces Artyfact’s meta ontology and retains the existing System-first example and explorer. Keep the site style, navigation labels and backend contracts. Done when section links, truthful labels, static/no-JS content, keyboard, reduced-motion, narrow layouts and all site gates pass; deliver one PR.

## Self-referential model page

Use the public model page itself as the canonical worked example, with an explanation purpose, nested page/component/affordance and accuracy, clarity and visual criteria. Explain single/composite Cloudflare mappings near the top. Preserve accessible static content, parallel views and truthful evidence boundaries; validate canonical Genome and desktop/mobile renders before one PR. Human comprehension remains unmeasured.

## Genome lifecycle implementation

The current approved follow-up is [the lifecycle specification](../design/lifecycle.md). Deliver shared lifecycle authority, ontology import and optional outcomes, metrics/Flagship, platform and CLI journey, then public-story integration. Lifecycle contracts own the integration boundary; ontology and operations can proceed independently. Completion is the specification's acceptance scenarios with independent review, full local/hosted CI and separately reported live evidence.

## System atlas follow-up

Map becomes the System front door with environment-first entry, true containment, a stable content-sized mosaic and quiet selection with explicit Details. No backend or ontology changes. Preserve explicit Thing links and specialized views.

Completion criteria: all declared externals appear at environment, including disconnected actors; template layers cannot skip real containers; grouped relationships retain original endpoint paths, direction, labels and certainty; scope/history and Details remain separate; one-hop outside context and offscreen links remain discoverable; pan, depth gestures, camera restoration, mobile, keyboard and reduced-motion paths work. Independent review and full local/hosted CI establish implementation evidence; deployment is separate.

Current atlas status: implementation and independent review fixes are complete; the camera replay regression and consolidated local CI pass. [PR #66](https://github.com/sdawka/artyfact-cf/pull/66) is open; review it and follow hosted CI on the PR before merge. No deployment is claimed. Evidence: [[journals/2026-10-13-system-atlas]].

## Application UI polish

Approved scope: application only; preserve colours, fonts, luminous identity, latest Atlas and all domain behaviour. Implement Radix Primitives through small CSS Module wrappers, spacious 44px controls, selected checks/grouped selectors and viewport-safe overlays. Keep native form/ref/name/required semantics, unknown revisions and explicit empty All filters; retain cmdk. Standard feedback/overlay/drawer tokens are 100/180/300ms, disabled by reduced motion or Effects off including portals.

Dependency order: shared wrappers and stable API → parallel shell/control adoption → Atlas selection/hover relation glow and anchored navigation transitions → independent review, integrated CI/browser checks and one PR. Shell uses a 256px desktop rail, labelled modal Menu below1024px, 32px/20px gutters, visible statuses, compact utilities and a bounded resizable Inspector that becomes a bottom sheet. Shared cards/states and /style use real components. Avoid graph/editor internal rewrites beyond the separately approved Atlas glow/navigation motion.

Completion: keyboard/ESC foremost overlay dismissal and focus restoration; form/selector runtime regressions; narrow admin overlay collision; 44px controls and readable desktop/mobile layout; effects/reduced-motion portals and Atlas navigation; preserved current graph/domain flows; independent review and all CI green. Hosted checks and deployed smoke remain separate evidence.
