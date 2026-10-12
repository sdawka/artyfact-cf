<!-- grreat:record id=roadmap.next kind=roadmap_item status=active parent=goal.north-star -->
# Deliver Parts composition in one integration PR

- Intended outcome: Implement [[goals]] using the contracts in [model](../design/model.md), [backend](../design/backend.md), and [UI](../design/ui.md).
- Work: Primary owns architecture, shared DTOs, authority/schema/routing integration, canonical docs, lockfile, validation, and the single draft PR. Workers own only the paths below, must accommodate other edits, and do not spawn children or create PRs.
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

Own `apps/platform/src/**` and browser tests. Show separate Systems and reusable Parts sections, keep System-private Parts scoped, inspect package provenance and source/realized/runtime aspects. A single-Thing System enters the full Thing workspace with System breadcrumb/overview; adding another Thing preserves direct links. Depends on C2/C3 contracts.

### Task 7: C7 — public pages (medium)

Own `apps/site/**`. Update `/`, `/model`, `/connect-agent` and explorer/guide tests for optional Parts, Genome-only Things, source versus realized output, and examples. Keep Bring your agent primary. Preserve static/no-JS content, accessibility, mobile/reduced-motion behavior; do not advertise unimplemented commands. Can start with C1, finalize after C4.

### Task 8: C8 — integration review (reviewer)

Read-only whole-branch correctness/security/regression review. Primary fixes findings, runs repository gates, pushes and opens/updates one PR. Merge only with all CI green; release evidence is separate from local tests.

## Completion criteria

1. A Thing exists with Genome, zero Parts and no source yet; old templates and IDs still load.
2. An Astro-style source template plus overlapping component system requires declared replacement and adapts callers/config through an explicit recipe command; undeclared collisions fail without writes.
3. Nested/repeated Parts retain contribution identity; extraction masks actually exclude payload, source is unchanged; upgrade preserves customization or reports conflicts.
4. Shared and System-private catalogs enforce access and dependency visibility; published versions cannot mutate.
5. Multiple builds of the same source produce distinct realized outputs; deployments and Phenome evidence have authoritative Thing/source/Genome/output lineage; unknown history remains unknown.
6. Home shows Systems and Parts. Single-Thing entry and stable direct Thing links work across single-to-multiple transition; overview stays accessible.
7. Public pages and real CLI guidance agree; static and accessible pages remain usable.
8. Existing review gates, command allowlists, invalid-Genome review, criteria scoping, and changelog regressions pass; relevant tests, typecheck, builds, and browser checks pass against the integrated revision.

- First action: [[execution]]. Record exact evidence and remaining gaps in [[analysis]].
