<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Current follow-up: the self-referential public model page and canonical explanation subjects are implemented on `feat/model-self-reference`, based on released `5c39a76`. Full CI passes in the credential-free matching checkout (193.4s); independent code and rendered visual review are clear; see [[journals/2026-10-13-model-page]]. Hosted CI, merge and deployment are separate next steps.

- Goal: [[goals]]. Milestone: iteration 3 is on `main`; the frontend-design pass over the platform rail, Home and the workspace is in flight ([[journals/2026-10-13-design-pass]]).
- Working revision: `main` at `49d5922` (PR #47 merged 2026-10-13 on green hosted CI). Slice branches `d-rail` (#53), `d-review` (#54), `d-intent-thing` (#51), `d-home` (#50) and `d-self-genome` (#49) are open draft PRs into `main`; `d-docs-review` holds the docs and the GRREAT record.
- Current result: the ontology engine is the core (`packages/ontology`), Genomes are a v2 containment tree, intents and the generic UI shipped, and the repo-root self-Genome drives `FAKE_SEED=artyfact`; see [[journals/2026-10-13-iteration-3]]. The design decisions D1–D8 are recorded in the design-pass journal.
- Next action: merge the slice PRs on green CI (#53 first, the rest build on it), reconcile `docs/design/ui.md` against the merged code, then deploy the platform and migrate the production Keep in Touch Genome with `artyfact init --genome-only --adopt --force` per `docs/deploy.md`, and verify live.
- Latest verification: hosted `verify` green on #47 at merge; slice PRs report no hosted checks yet. No production verification since the merge.
- Earlier from `main`: landing-site agent story (#44/#45, [[journals/2026-10-12-foundation]]), the public `/model` page (#48) and settled story chapters (#52, [[journals/2026-10-13-model-page]]); their last recorded site gates passed.
- Homepage visual recovery: frame-free composition and whole-object transitions replace sliced reveals; the existing purpose, workflow and closing form a clearer conclusion. Fresh forward/reverse visual review is clear; full CI passed in 195.8s (2361 root tests, 9 skips; 56 site units, 11 static, 45 browser checks). Corrective PR, hosted checks and site release remain next; see [[journals/2026-10-13-model-page]].
- Deferred: Remote GRREAT sync stays pending; the earlier `GOAL_HIERARCHY_CONFLICT` checkpoint is preserved and no remote record was overwritten.
- Last updated: 2026-10-13.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
- [[journals/2026-10-13-iteration-3]]: ontology engine core, Genome v2, intents; PR #47.
- [[journals/2026-10-13-model-page]]: public model page follow-up and validation.
- [[journals/2026-10-13-model-page]]: settled public story chapters (#52).
- [[journals/2026-10-13-design-pass]]: PR #47 merged; design pass decisions D1–D8 and slice PRs.
