<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Current milestone: atlas polish is implemented on [PR #66](https://github.com/sdawka/artyfact-cf/pull/66): stronger teal scope/System treatment, inset selection and candidate states, clearer Details and preference-gated scope/overlay motion, preserving geometry and cameras.
- Latest local evidence reported by the primary: 62 focused tests across 9 files and platform typecheck pass; 5 targeted browser cases pass, including the corrected 216px tile footer overlap, settled responsive layouts and Details. Final atlas/Shell suite passed: 34 cases in 18.2s, no retries. Prior full-CI evidence remains in [[journals/2026-10-13-system-atlas]].
- Next action: pass normal pre-push checks and confirm all hosted CI checks are green, merge PR #66 and deploy the platform as authorized; then record the deployed version and live checks. No deployment is claimed at this checkpoint.
- Blockers: direct-RPC sync remains pending missing credentials and a confirmed separate Artyfact destination; preserve the earlier wrong-project conflict.
- Last updated: 2026-10-13T22:01:24-04:00.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
- [[journals/2026-10-13-iteration-3]]: ontology engine core, Genome v2, intents; PR #47.
- [[journals/2026-10-13-model-page]]: public model page follow-up and validation.
- [[journals/2026-10-13-model-page]]: settled public story chapters (#52).
- [[journals/2026-10-13-design-pass]]: PR #47 merged; design pass decisions D1–D8 and slice PRs.

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
- Last updated: 2026-10-13.
