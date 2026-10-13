<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Goal: [[goals]]. Milestone: [[roadmap]].
- Next action: Review draft PR #29 and its final-head hosted checks; no merge or deployment is authorized. Preserve separate Artyfact/Bropilot planning; remote GRREAT sync is deferred by the user.
- Completion criteria: The eight checks in [[roadmap]] are implemented and locally verified; hosted behavior remains separate.
- Working revision: `feat/parts-composition`, with current main reconciled without conflicts. The public illustration and global luminous surface migration are integrated; validation covers the working tree after `1c55ecc` and the main merge.
- Pull request: [#29](https://github.com/sdawka/artyfact-cf/pull/29), draft. Hosted CI is tracked on the PR.
- Latest verification: Full local `npm run ci` passed in 88.7s: 1274 root unit tests (3 skips), 41 fixture and 5 fake-platform browser checks, plus site typecheck/build, 22 unit, 10 generated-page and 28 browser checks (2 desktop-only cases skipped on mobile). Independent source and actual UI review closed; see [[journals/2026-10-12-foundation]].
- Deferred: Remote sync remains deferred by the user. The earlier GRREAT versioned sync returned `GOAL_HIERARCHY_CONFLICT` for `goal.north-star`, with zero applied changes. The authenticated workspace already has a different North Star; no remote goal was overwritten or reparented. Artyfact and Bropilot records stay separate; the intended Artyfact destination remains pending.
- Last updated: 2026-10-12T23:30:29-04:00.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
