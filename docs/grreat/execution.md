<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Implementing intent-to-ontology authoring, truthful integrity review and Artyfact's enriched System map under the [approved plan](../design/intent-integrity-plan.md), [PR #80](https://github.com/sdawka/artyfact-cf/pull/80).
- Core, backend, recovery, CLI/UI and self-Genome slices are integrated. Independent review repairs and exact-current status metadata are integrated. The full clean gate passed at `92dd5f88`, and the final platform gate passed at `e6c472f0` (3,069 units, 100 fixture, 16 fake browser checks). User-approved real Jev controls caught a dangling reference and unsupported sharing; low-confidence clean results remain needs-review. Exact materialization and real Artifacts import preserved explicit test-operator agreement. The bounded self retry now completes real node checks, honestly needs-review after 200 calls (167 subjects); total live use is 214/500. Input-size hardening passed independent review. Hosted baseline `d3b78a60` passed; final retry/exhaustion budget corrections passed the local gate at `99cf1794` (3,072 units, 100 fixture and 16 fake browser tests); exact-head hosted verification is pending, with real partial-report agreement now verified.
- Next: finish exact-head local/hosted gates, then deploy and import the self-Genome into production and verify its map. [Evidence](journals/2026-10-14-intent-integrity-implementation.md).
- GRREAT validation passes; RPC preview applied 0 records. Remote sync remains pending a confirmed separate Artyfact destination; preserve the wrong-project conflict.
- Last updated: 2026-10-14T18:04:30-04:00.

## Spike baseline

- Investigation: app-intention spike completed against `a3c95f2`; six concrete gaps and one product-coherence recommendation are recorded in [[journals/2026-10-14-intention-spike]]. No product implementation or production changes.
- Evidence: primary focused suites passed 14 tests; bounded agent suites passed another 60 and 24. Criterion-only overlap false negative reproduced independently. UI suites could not collect because `@radix-ui/react-icons` is missing locally; browser and full CI verification were not performed.
- Recommended next action: address acceptance-contract drift and Thing-scoped operations, then validate the complete onboarding-to-runtime journey. These fixes are proposed, not started.
- Tracking: vault validation passed (7 records); RPC dry-run returned `pending: missing_credentials`, `applied: 0`. Existing real-Artifacts verification and confirmed separate GRREAT destination remain pending. Preserve prior release evidence below and the wrong-project sync conflict.
- Last updated: 2026-10-14T09:58:06-04:00.

## Latest release context

- Released: application UI polish [PR #71](https://github.com/sdawka/artyfact-cf/pull/71) merged at `994d2ff8a0be410cae3f3e156115c0079913018e`, including upstream `161be0b` and the final overlay-shortcut guard. That exact merged revision deployed as Worker version `9eb75476-c87e-4e1a-822b-0054066c4b55` to [artyfact-platform](https://artyfact-platform.dawka.workers.dev).
- Verified: final local platform gate passed 2826 units (9 skips), 96 fixture and 16 fake-platform browser tests, plus typecheck/build. [Hosted verification](https://github.com/sdawka/artyfact-cf/actions/runs/38560962465) passed on the final PR head in 13m30s. The earlier full local gate, before the final shortcut fix, passed site checks (55 units, 51 browser tests with 5 skips). The canonical protected read returned 200 after deployment, proving admin-token preservation. Evidence: [[journals/2026-10-13-ui-polish]].
- Live smoke: authenticated desktop/mobile checks pass across Home, Atlas, Thing/Code/Deployments/Overview/Work and private Parts. Twenty-one settled captures at 1440×900 and 390×844 show no horizontal overflow, serious/critical axe findings, app errors or attempted writes; mobile Menu focus/Escape and overlay shortcut ownership, normal palette toggling, Effects off and reduced-motion portals pass. Entering AddContactDialog then Up restores the exact prior viewport at both widths.
- Next: retain release evidence and resume deferred lifecycle verification. The lifecycle runbook's real-Artifacts flow remains unverified ([[journals/2026-10-14-lifecycle-port]]).
- Sync: the earlier authenticated versioned RPC preview applied 0 records. This release's new dry-run was blocked by automatic approval review before transmission because the destination is unconfirmed; no new transmission or apply completed. Destination `ws_bddc55cbf3e14dc8b8c22e651e82a8fd` remains unconfirmed for Artyfact; preserve the prior wrong-project conflict and do not apply there.
- Last updated: 2026-10-14T08:30:04-04:00.

## Previous release

- Released: [PR #66](https://github.com/sdawka/artyfact-cf/pull/66) merged at `4bc93a811f2251ec949e060e98d6bf4d081d8fbf` after all hosted checks passed. The polished System atlas is deployed to [artyfact-platform](https://artyfact-platform.dawka.workers.dev), Worker version `83e29bb9-0f2e-42c2-892a-a8aa496bf46b`, built from that exact merged revision.
- Verified: final pre-push passed all five platform steps (2564 unit, 74 fixture and 13 fake browser tests; no retries). Authenticated desktop/mobile smoke passed on real Peopling, including environment/containment, Details, history/pan restoration, direct Thing Map, Work/Deployments and reduced motion; no serious/critical axe findings, overflow, writes or page errors. Evidence: [[journals/2026-10-13-system-atlas]].
- Released: [PR #68](https://github.com/sdawka/artyfact-cf/pull/68) (task planning and local agents on the lifecycle) merged at `5014bb5` and [PR #70](https://github.com/sdawka/artyfact-cf/pull/70) (atlas e2e flakes) at `161be0b`, both on green hosted CI. Platform Worker version `e672b1b1-be57-4685-9878-f6efcabe462f` and site version `b5cc61f6-b3d8-4e65-889b-d60d0114eec0` are deployed from `161be0b`. Prod Peopling is re-imported at `sc-2-5ab52983`. Evidence: [[journals/2026-10-14-lifecycle-port]].
- Next action: resume direct-RPC sync when a separate Artyfact destination is confirmed.
- Blockers: credentials are available, but direct-RPC sync remains pending a confirmed separate Artyfact destination; preserve the earlier wrong-project conflict.
- Last updated: 2026-10-14.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
- [[journals/2026-10-13-iteration-3]]: ontology engine core, Genome v2, intents; PR #47.
- [[journals/2026-10-13-model-page]]: public model page follow-up and validation.
- [[journals/2026-10-13-model-page]]: settled public story chapters (#52).
- [[journals/2026-10-13-design-pass]]: PR #47 merged; design pass decisions D1–D8 and slice PRs.
- [[journals/2026-10-13-lifecycle]]: approved lifecycle released, PR #64 at `df6dcdb`.
- [[journals/2026-10-13-system-atlas]]: nested System atlas released, PR #66.
- [[journals/2026-10-14-lifecycle-port]]: task-planning port onto the lifecycle; docs, runbook and site guide.
- [[journals/2026-10-13-ontology-driven-development]]: semantic-layer benefits and platform meta ontology explanation, site-only.

## Prior recorded release context

- Current follow-up: the self-referential public model page and canonical explanation subjects are implemented on `feat/model-self-reference`, based on released `5c39a76`. Initial head `83a9cfc` passed full CI in the credential-free matching checkout (193.4s); integration with the released ODD introduction and benefits is now being revalidated; see [[journals/2026-10-13-model-page]]. Hosted CI, merge and deployment are separate next steps.

- Public-site release complete: Ontology Driven Development benefits and Artyfact’s meta ontology are live at https://artyfact.ing/model. PR [#57](https://github.com/sdawka/artyfact-cf/pull/57) merged on green hosted CI at `1b79e93`; the site deployed and desktop/mobile/no-JS live checks pass. Evidence: [[journals/2026-10-13-ontology-driven-development]]. The platform release work below remains separate; remote GRREAT sync stays pending.

- Goal: [[goals]]. Milestone: iteration 3 and the frontend-design pass are on `main` and in production ([[journals/2026-10-13-design-pass]]).
- Working revision: `main` at `e9b7fa3` (PR #56: the five design slices plus the docs slice's Phase A, after PR #47 at `49d5922`). Production runs Worker version `e763f73b` (deployed 15:48 UTC); the Peopling Genome is v2 at commit `0d02fce56219`, System head `sc-4-c597c0ba`.
- Current result: ontology engine core, Genome v2, intents, generic UI, self-Genome with UI nodes, the rail with layer heads and questions, the Review view, one "Describe a change" shape, the Home ledger; decisions D1–D8 in the design-pass journal.
- Keep in Touch renamed to Peopling (`system.peopling`, repos `peopling.genome` / `peopling.app`, `examples/peopling-*`), with an admin `DELETE /api/systems/:id`: PR #60, [[journals/2026-10-13-peopling-rename]]; prod re-import pending (ci Worker redeploy, re-import, delete the old id).
- Next action: merge PR #59 (ui.md and README reconciliation) on green CI, then fix the five reported defects in their owning slices, Home's candidate count first; retake the three demo screenshots on the new Work card and Review.
- Latest verification: health and the Home, Review and Work routes answer 200 on `e763f73b`; the model route answers 200 after the migration. No browser walk-through of production recorded yet.
- Earlier from `main`: landing-site agent story (#44/#45, [[journals/2026-10-12-foundation]]), the public `/model` page (#48) and settled story chapters (#52, [[journals/2026-10-13-model-page]]); their last recorded site gates passed.
- Homepage visual recovery: frame-free composition and whole-object transitions replace sliced reveals; the existing purpose, workflow and closing form a clearer conclusion. Fresh forward/reverse visual review is clear; full CI passed in 195.8s (2361 root tests, 9 skips; 56 site units, 11 static, 45 browser checks). Corrective PR, hosted checks and site release remain next; see [[journals/2026-10-13-model-page]].
- Deferred: Remote GRREAT sync stays pending; the earlier `GOAL_HIERARCHY_CONFLICT` checkpoint is preserved and no remote record was overwritten.
- Last updated: 2026-10-14.
