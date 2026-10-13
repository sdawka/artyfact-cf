<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Goal: [[goals]]. Milestone: the public model page follow-up in [[roadmap]].
- Working revision: `feat/model-page-domain-first`, based on released main `6cf5a15`; this iteration changes the public `/model` page and its focused tests, with no homepage or backend changes.
- Current result: the page explains System/Thing composition, form/content, Parts/Rule Packs, nested subjects and three parallel views through a labeled illustrative Artyfact feature. Known capability gaps are recorded in [[roadmap]].
- Next action: Complete independent visual/copy review, then publish one PR. Merge only with all hosted CI green; deploy and verify the exact merged site revision.
- Latest verification: Full `npm run ci -- --ultra-compact` passed in 123.8s: 1349 root tests (3 skips), 42 fixture and 4 fake-platform browser checks, 49 site units, 11 static and 42 browser checks (4 viewport skips), all typechecks/builds. A 320px no-JS browser check returned HTTP 200 with all six sections and no horizontal overflow.
- Deferred: Remote GRREAT sync remains deferred by the user; the existing `GOAL_HIERARCHY_CONFLICT` checkpoint and separate Artyfact/Bropilot records are preserved.
- Last updated: 2026-10-13T09:08:01-04:00.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
- [[journals/2026-10-13-model-page]]: public model page follow-up and validation.
