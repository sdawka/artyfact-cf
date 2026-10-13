<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Released the [approved lifecycle](../design/lifecycle.md): PR [#64](https://github.com/sdawka/artyfact-cf/pull/64) merged on green hosted CI at `df6dcdb`; site, platform and CI Worker are deployed. Original checkout and user changes are preserved.
- Verified: full local CI, independent release review (38 targeted tests), public health and authenticated model/Realization/import/operations APIs for both existing Systems, plus desktop/mobile route and no-JavaScript model smoke checks. Detailed evidence: [[journals/2026-10-13-lifecycle]].
- Production admin credential was rotated as authorized and the ignored local environment file updated. Live metrics and feature flags await operations bindings and credentials; no live Flagship behavior is claimed.
- GRREAT protocol validates 7 records. Direct-RPC sync remains pending missing credentials and a separate Artyfact destination; earlier conflict checkpoints are preserved.
- Last updated: 2026-10-13.

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
