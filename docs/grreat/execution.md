<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Goal: [[goals]]. Milestone: [[roadmap]].
- Next action: Identify the separate Artyfact GRREAT destination, preserving this project's canonical goals and roadmap and the remote conflict. Inspect hosted CI before any merge; no merge or deployment is authorized here.
- Completion criteria: The eight checks in [[roadmap]] are implemented and locally verified; hosted behavior remains separate.
- Working revision: `feat/parts-composition`, based on `5614e64`; implementation committed as `157e66f` and published after explicit disclosure approval.
- Pull request: [#29](https://github.com/sdawka/artyfact-cf/pull/29), draft. Hosted CI is tracked on the PR.
- Latest verification: Full local CI and pre-push CI passed: 1258 root unit tests (3 skips), 38 fixture and 5 fake-platform browser checks, plus site typecheck/build, 13 unit, 9 generated-page and 20 desktop/mobile browser checks. See [[journals/2026-10-12-foundation]].
- Blocker: GRREAT versioned sync returned `GOAL_HIERARCHY_CONFLICT` for `goal.north-star`, with zero applied changes. The authenticated workspace already has a different North Star; no remote goal was overwritten or reparented. Artyfact and Bropilot records stay separate; the intended Artyfact destination remains pending.
- Last updated: 2026-10-12T19:58:17-04:00.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
