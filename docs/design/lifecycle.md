# Genome lifecycle implementation

Accepted 2026-10-13. This specification implements the user-approved story and platform plan.

## Decisions and invariants

- An Evolution changes only the Genome. Approval commits the exact reviewed Genome delta. It does not implement, deploy, or change live flags.
- A Realization is implementation of a pinned accepted Genome revision. A new Realization can target an existing revision without a new Evolution.
- Realization -> Tasks -> agent attempts. A Task owns one artifact binding, one isolated fork, steps, dependencies, ontology read/write scope and checks. One writing attempt is active at a time; retries preserve work and replace credentials.
- Agents run in the user's local harness. Artyfact owns durable plans, scheduling constraints, review, provenance, and permissions.
- Task results integrate into one candidate per changed artifact binding and one reviewed implementation manifest. Promotion preserves the current accepted Genome and records the Genome actually realized per binding. Later overlapping Genome changes require explicit replan; disjoint advances must not silently retarget work.
- Native ontology packages and agent-converted sources are reviewed before acceptance. Domain vocabulary is open; effects/events/assays are an optional outcomes pack. Base Phenome supplies deployments, runtime/custom metrics and Cloudflare Flagship controls.
- Keep all existing historical records/IDs/routes readable. Do not reinterpret legacy implementation/mixed Evolutions as Genome amendments. New contracts are additive; UI names current agent-level realizations Task Attempts under new plans.
- Source scope includes artifact/repository identity, not just path. Missing scope evidence means independence unknown. Read/read sharing can be independent; writes, contracts, explicit dependencies and inherited scope determine interference.
- Preserve authorization, exact-candidate evidence, fail-closed checks, user changes, accessible UI and truthful capability labels. Never merge with red CI.

## Task 1: Lifecycle authority and shared contracts

Own packages/model/src/lifecycle.ts and its tests/exports, packages/model/src/schema.ts, apps/platform/shared/lifecycle.ts, apps/platform/shared/api.ts, apps/platform/worker/{service.ts,intents.ts,promotion.ts}, worker/do/*, worker/packets/*, worker/tasks/*, worker/routes/{evolutions,realizations,intents,lifecycle}.ts and focused backend tests. Reuse earlier committed task branch work only after inspecting it for these semantics. Do not import whole branches blindly.

Implement durable RealizationPlan, Task and TaskAttempt contracts, validation, task dependency/read-write/source-footprint analysis, leases and retry credential fencing, source-binding bases, integration and final multi-binding promotion. Extend intent proposals to have a durable linked Genome Evolution before approval; approval remains Genome-only. Existing legacy flows/history stay readable. New plans pin accepted Genome snapshots and implementation manifest; select task candidates and integrate all changed bindings with exact lineage. Add lifecycle route module but primary wires it centrally. Publish shared/lifecycle.ts early so downstream client and CLI can consume it. Provide route paths and examples in task report. Use focused failing regression tests first, then relevant unit and DO tests. Return report in .superpowers/sdd/lifecycle/task-1-report.md.

## Task 2: Open ontology import and optional outcomes pack

Own packages/ontology/**, packages/templates/**, packages/model/src/{genome.ts,ontology-package.ts}, new model tests for ontology packages, apps/platform/worker/ontology-packages/**, worker/routes/ontology-packages.ts, shared/ontology-packages.ts, and focused platform tests. Do not edit shared/api.ts, schema.ts, package manifests, or central routes without primary integration.

Implement immutable validated native ontology package import with version/hash pins and dependencies; support system-private scope using existing authorization/catalog conventions. Resolve user-provided templates via a bounded store alongside bundled templates without executing commands. Add preview/review/accept import flow and a minimal initial System path, preserving invalid import inspection. Extend source bindings with repository/artifact identity while keeping files defaults compatible. Supply a selectable outcomes ontology pack defining event contracts, expected effects and assay links, with executable event-payload validation helper for operations ingestion. Domain ontologies must work without it. Agent conversion stays local, emits native package, then follows same preview/accept flow. Publish shared/ontology-packages.ts early. Register exports and schemas through primary. Test custom kinds/relationships, pin/version collisions, unknown dependencies, privacy/auth, invalid imports, missing mappings, outcomes pack optionality. Report .superpowers/sdd/lifecycle/task-2-report.md.

## Task 3: Phenome metrics and Flagship operations

Own apps/platform/worker/operations/**, worker/routes/operations.ts, shared/operations.ts, dedicated platform tests, and apps/ci/src/deploy-config.ts plus directly corresponding tests. Coordinate with lifecycle owner before touching deployments.ts or phenome.ts; primary integrates hooks.

Implement authenticated System/binding-scoped Cloudflare GraphQL metrics provider (requests, invocation errors, CPU) and custom numeric measurements through existing authenticated ingestion, with bounded windows, timestamps/retention/unavailable states and authoritative output lineage. Implement Flagship list/detail/create/update/disable/targeting/percentage rollout with server-only configured credentials, explicit account/app/environment bindings, audited operational changes independent of Evolution. Use current official Cloudflare docs for APIs. Flagship native binding is flagship:[{binding,app_id}]; integrate CI allowlist/config validation. Use isolated provider interfaces and fixture fakes; local Flagship bindings access live apps, so CI must not make real calls. No resource provisioning or production changes. Add optional outcome-event validation through Task 2's helper; avoid asserting effects from raw counts. Publish shared/operations.ts early. Tests cover scope/auth, failures, aggregation and no fabricated lineage, flags fallback/targeting/update conflicts/audit. Report .superpowers/sdd/lifecycle/task-3-report.md.

## Task 4: Platform journey and local agent CLI

Own apps/platform/src/**, packages/cli/**, platform e2e journey tests and CLI tests. Consume shared contracts from Tasks 1-3; do not redefine wire shapes. Add start/import/build-with-agent journey, progressively expandable Genome Evolution proposal review, Realization plan/task dependency view, scoped claim/start/resume/checkpoint/submit/select/integrate CLI and agent guidance, combined implementation review, operational metrics and flags UI. Reuse current design system, route structure, focus and empty/error/loading patterns. Existing workflows remain readable and are labeled legacy where necessary. Agent returns durable review URLs. Executable CLI functions must match real server endpoints; no placeholders. Coordinate contract questions with primary. Report .superpowers/sdd/lifecycle/task-4-report.md.

## Task 5: Public explanation and integration

Primary owns apps/site/**, existing design/GRREAT docs, root routing, generated self-Genome integration, dependency manifests/lockfile and final verification. Explain whole lifecycle on homepage, model page and agent guide while preserving the self-referential model example, parallel views, layout/accessibility and Bring your agent. Publish instructions only for implemented capabilities. Update canonical mapping for added files and user decisions. Integrate workers without overwriting changes. Run full npm run ci -- --ultra-compact and site checks. Validate GRREAT and attempt only the configured versioned sync, leaving missing credentials/destination or existing conflicts pending. Independently review integrated branch, fix material findings, push and create PR. CI must be green before any merge; deployment evidence is separate.

## Acceptance

Custom ontology import and agent-authored proposals; Genome-only approval; independent tasks in parallel and downstream tasks in order; unknown/conflicting scope blocks automatic parallel launch; interrupted attempt resumes without a second writer; multi-artifact integrated review and stale-candidate protection; advancing Genome preserves realized lineage; runtime metrics and feature flags without outcomes pack; optional versioned event/assay evidence; isolated flag tests; desktop/mobile keyboard/reduced-motion/no-JS; full CI and vault validation. Hosted checks and live behavior must be reported separately from local verification.
