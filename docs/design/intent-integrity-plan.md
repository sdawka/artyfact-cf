# Intent and Ontology Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reviewed agent-led intent authoring, truthful structural/semantic integrity, and Artyfact's enriched production System map.

**Architecture:** Shared pure model contracts describe intent sidecars, exact snapshots, integrity findings and human agreement. A System-scoped durable run store executes the existing ontology evaluator/judge with checkpointed provider calls. CLI and browser use the same API and status rules; real import preserves reviewed snapshots and provenance.

**Tech Stack:** TypeScript, Zod, existing ontology/Datalog engine, Cloudflare Durable Objects, Hono, React, Vitest/Playwright and the existing CLI.

**Spec:** [intent-integrity.md](intent-integrity.md), approved by the user's instruction to proceed to implementation.

## Global Constraints

- No hosted agent runner, automatic implementation, mandatory source repository, mandatory Part, or automatic semantic approval.
- Canonical sidecars are `intent/brief.md` (64 KiB) and `intent/manifest.json` (128 KiB); preserve byte/content hashes and safe relative references.
- Full-check statuses are blocked / needs-review / passed; automated integrity is separate from immutable human dispositions and agreement.
- Budget: default 200/max 500 calls, 64 KiB checkpoint rows, 10 MiB checkpoints/run and 512 KiB report; partial checks never imply exhaustive proof.
- Use accepted System-scoped package closure and existing provider policy; preserve IDs, source lineage, user files and separate implementation approval.
- One integration PR; no merge with failing checks or bypass flags. No unreviewed production overwrite. Record exact local, hosted, real-provider and production evidence separately.

## Review Focus

- A new idea has no source: permit a Genome-only preview/import and do not fabricate an app binding (Tasks 2/4).
- The intent sidecar changes but nodes do not: invalidate agreement/report identity and preserve exact round trips (Tasks 1/2/4).
- A worker dies after a model response: bounded retry may repeat a paid call, but durable checkpoints reuse known answers and stale leases cannot finish runs (Task 2).
- An unrelated private package is accepted: closure identity stays stable and does not leak another System's vocabulary (Tasks 1/2).
- A model is unavailable or only part of the graph was checked: no green success; findings or report-level limitations require explicit human agreement (Tasks 2/5).

## Shared ownership and interfaces

T1 owns `packages/model/src/intent.ts`, `integrity.ts`, their exports and dedicated tests. It publishes `IntentManifest`, `IntentSources`, `readIntentSources(files)`, `createIntegritySnapshot({systemId,files,templates})`, `IntegritySnapshot`, `IntegrityReport`, `IntegrityFinding`, `IntegrityDisposition`, `integrityStatus(report)` and `agreementEligibility(report,dispositions)`; all are platform-independent. `files` is a record of Genome-relative UTF-8 strings; template resolution is an explicit argument. The snapshot includes exact Genome/intent/template closure hashes, static findings and serializable source data. T1 publishes final signatures before T2/T4 consume them.

T2 owns backend `worker/integrity/**`, `shared/integrity.ts`, routes, DO RPC wiring, ontology import integration and source sidecar loading. Wire paths: `POST /systems/:id/integrity/preview` creates an immutable snapshot; `POST /systems/:id/integrity/runs` starts/reuses a check for `snapshotId` or current Genome; `GET /systems/:id/integrity/runs/:runId` reads it; `POST .../:runId/agreement` records exact dispositions; `POST .../:runId/cancel` cancels. All require existing admin auth and System destination ownership. A run exposes `{id,systemId,state,snapshotHash,report?,agreement?,reviewUrl}`. T2 publishes exact request types early in `shared/integrity.ts`. Initial snapshots use initialized System DOs, before remote provisioning. T2 alone owns shared/backend wiring; T3 coordinates any DO additions through T2.

T3 owns `worker/intents.ts`, `routes/intents.ts`, proposal-store changes and dedicated tests. T4 owns `packages/cli/**`. T5 owns app API/client/view files and browser tests. T6 owns `genome/**`, self-Genome tests and sanitized example inputs. Primary owns canonical docs/tracking, integration, reviews, required gates, PR and live acceptance.

## Task 1: Intent provenance and shared integrity policy

- [x] Add failing model tests for duplicate JSON keys, unsafe/absolute source paths, over-limit UTF-8 sidecars, brief-only drift, exact hash round trips, missing versus error status, unknown semantics and immutable disposition eligibility. Representative assertions:
  ```ts
  expect(readIntentSources({"intent/manifest.json": '{"version":1,"version":2}'}).issues.length).toBeGreaterThan(0);
  expect(integrityStatus({...report, structural: {status: "blocked"}})).toBe("blocked");
  ```
- [x] Run `npm test -w @artyfact/model -- test/intent.test.ts test/integrity.test.ts`; observe failures for absent contracts.
- [x] Implement bounded sidecar parsing/canonical hashing, selected-template closure traversal and shared report/eligibility policy. Keep existing node schemas and lightweight validator compatibility; template closure uses actual reachable template references, including dependencies.
- [x] Run focused tests/typecheck; publish interfaces and commit only owned files.

## Task 2: Durable integrity runs, reviewed snapshots and imports

- [x] Add failing Worker tests for initial Genome-only previews, exact snapshot agreement, unknown/off providers, all status transitions, lease fencing, duplicate start, checkpoint reuse, custom packages and cross-System denial. Assert no-source previews need no app bindings:
  ```ts
  expect(preview.snapshot.systemId).toBe("system.example");
  expect(run.report.status).toBe("needs-review"); // provider off
  expect(secondStart.id).toBe(firstStart.id);
  ```
- [x] Run the new `test/integrity*.test.ts` suites and import-review suites, retaining expected failing assertions.
- [x] Implement strict bounded request schemas, immutable snapshot rows, queued run/lease/checkpoint store and alarm-driven execution. Replay persisted SystemOne answers by exact hashes; retain bounded retries and cancellation state. Run deterministic checks, the full defect funnel/per-kind checks, and explicit bounded intent-to-node coverage/unsupported-claim judgments. Track actual coverage and unavailable providers as limitations.
- [x] Integrate native package resolution and conditional source mappings. Preserve sidecars when reading/importing remote Genome; carry agreement only after server-computed identity matches the reviewed preview. Expose latest applicable run/report through import/model/readiness responses without treating missing reports as success.
- [x] Make native-package preview reject invalid structure while permitting source-free planned nodes. Require full-check eligibility on new reviewed authoring paths; preserve explicitly labeled legacy bypass behavior.
- [x] Run focused Worker suites and typecheck; commit owned files and publish actual wire types.

## Task 3: Recoverable exact Genome proposals

- [x] Add failing tests for proposal-wide known errors being refused before push and a gate-refused staged candidate being revised/abandoned without losing history or accepting stale evidence.
- [x] Run `npm test -w @artyfact/platform -- test/intents.test.ts` and observe the new failures.
- [x] Add admin-only abandon/revise recovery, immutable prior-attempt history and exact stale/claim checks. Reuse accepted custom template resolution in head loading and proposal simulation. Integrate report/decision binding through T2's shared contract; coordinate DO changes through T2 to avoid overlapping writes.
- [x] Run all intent tests; publish recovery endpoints and commit owned files.

## Task 4: Agent-led initial authoring and full-check CLI

- [x] Add failing CLI tests for authoring without code, safe sidecar/bootstrap round trips, full-check 0/1/2 exits, origin/auth handoff, exact snapshot imports and pending/off-provider output. Preserve the legacy validate-genome exit contract but replace unqualified ready wording.
- [x] Run focused CLI tests and observe failures.
- [x] Extend the authoring skill/generated AGENTS.md with new-intent and existing-code paths. Add `ontology check` (preview/start/poll/JSON), `ontology agreement` and snapshot materialization/import commands using the shared API. Explicitly show assumptions, citations, incomplete semantic checks and durable review URLs. Never export admin credentials to spawned agents.
- [x] Extend CLI push/read logic for allowlisted sidecars and Genome-only imports; avoid provisioning or uploading source when absent. Document actual runnable commands in existing CLI docs and the agent skill.
- [x] Run CLI suites/typecheck; commit owned files.

## Task 5: Start, integrity review and recovery UI

- [x] Add failing UI/browser checks for copyable pre-package intent handoff, structural and semantic states, model-off failure, stale run/disposition display, revise/abandon and explicit agreement without invented pass results.
- [x] Run focused Start/Review/Intent suites; observe failures.
- [x] Build reusable integrity report/run controls consumed from Start, import review and proposals, plus direct review URLs. Preserve one Review inbox, exact node links and separate automated/human states. Include loading, partial, retry and cancellation affordances; queued polling must stop on unmount/scope changes.
- [x] Run UI and fixture/fake-provider browser journeys at desktop and 320px, keyboard/reduced motion and accessibility; commit owned files.

## Task 6: Artyfact ontology and representative examples

- [x] Add failing self-Genome tests asserting canonical nodes/links for intent clarification, provenance, integrity statuses, full-check review, local agents and agreement boundaries.
- [x] Run `npm test -w @artyfact/templates -- test/self-genome.test.ts`; observe missing-node failures.
- [x] Enrich existing stable nodes and add missing ones from accepted docs/decision_log and docs/design. Add `intent/brief.md` and a valid manifest with real canonical references/hashes. Keep implementation status truthful until code lands and preserve all source/realized/runtime distinctions.
- [x] Add small source-free new-idea, amendment and intentionally flawed examples with explicit expected structural/semantic findings and clean controls; include ambiguity and omitted-intent cases.
- [x] Run self-Genome validation/source mapping plus example tests; commit owned files.

## Task 7: Integration, independent review and live acceptance

- [ ] Integrate each slice, review each bounded diff independently and repair findings before completion. Reconcile contracts and generated template/source declarations; preserve the newer merged provider/site work.
- [ ] Run `npm run ci -- --ultra-compact`, GRREAT validation, versioned RPC preview and whole-branch correctness/security/regression review. Update the existing integration PR and require exact-head hosted checks green.
- [ ] Inspect existing production System/repo names and verified credentials without printing secrets. Provision/import only the exact reviewed self-Genome/source set using normal CLI review; never force over unrelated repos. Deploy reviewed product changes only within existing authorization, with green checks.
- [ ] Exercise fresh real-provider examples through authoring, preview, full checks, repairs, dispositions and acceptance; record report IDs/revisions and misses/false alarms. Verify Artyfact in production Systems/model/readiness and its actual System map, Thing entry, relationship inspection and integrity findings at desktop/mobile with keyboard/reduced motion. Keep any missing external capability visibly pending while finishing independent local work.
- [ ] Update Now plus one meaningful journal with exact implemented/local/hosted/live evidence, remaining gaps and sync status. Finish with a concise result and next action if one remains.

## Preflight interface review

| Tasks | Shared boundary | Resolution |
| --- | --- | --- |
| 1/2/4 | Sidecars, snapshot and report types | T1 sole owner; publish before dependents consume. |
| 2/3 | System DO and proposal report eligibility | T2 sole DO writer; T3 supplies required methods/patch to T2. |
| 2/4/5 | Wire requests/statuses/endpoints | T2 shared contract owner; CLI/UI consume imports. |
| 5/6 | UI nodes and endpoint mappings | T6 sole Genome owner; T5 reports exact new public surfaces. |
| All | Acceptance, constraints and tests | Spec reviewed against every task; no task bypasses real evidence or authorizes new runner behavior. |
