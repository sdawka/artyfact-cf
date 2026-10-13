<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Goal: [[goals]]. Milestone: coherent public homepage and model storytelling.
- Working revision: `feat/settled-page-stories`, based on released main `098e7d8`; site-only presentation and interactions, without backend changes.
- Current result: finite reversible homepage chapters, bounded sticky narrative with separate support, and one illustrative scoped-change thread through the domain-first model page. Independent source and desktop/mobile review is clear.
- Next action: Publish one PR, require exact-head review and all hosted checks green, then release and independently verify the exact merged site.
- Latest verification: 1355 root tests (3 skips), 42 fixture and 5 fake-platform browser checks passed. The final scoped site gate passed in 61.0s: 55 units, 11 static checks and 45 browser checks (5 viewport skips), all typechecks/builds. Independent review verified finite reversals, focus, no-JS/reduced motion and zero support overlap at four viewports. GRREAT: 7 valid records. See [[journals/2026-10-13-model-page]].
- Deferred: Remote GRREAT sync remains deferred by the user; the existing `GOAL_HIERARCHY_CONFLICT` checkpoint and separate Artyfact/Bropilot records are preserved.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
- [[journals/2026-10-13-model-page]]: public model page follow-up and validation.
