<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Goal: [[goals]]. Milestone: [[roadmap]].
- Next action: Publish the prepared integration branch as one draft PR once the required public-disclosure approval arrives. Inspect remote CI before any merge; no merge or deployment is authorized here.
- Completion criteria: The eight checks in [[roadmap]] are implemented and locally verified; remote PR/CI and hosted behavior remain separate.
- Working revision: `feat/parts-composition`, based on refreshed `origin/main` at `5614e64`; plan committed as `31d9b45`. Final CI tested the integrated code before evidence-only documentation updates.
- Latest verification: `npm run ci` passed all steps: 1258 root unit tests (3 skips), 38 fixture and 5 fake-platform browser checks, plus site typecheck/build, 13 unit, 9 generated-page and 20 desktop/mobile browser checks. See [[journals/2026-10-12-foundation]].
- Blockers: Automatic review rejected public GitHub publication and the external GRREAT record write because explicit payload-export approval is required. GRREAT credentials and destination are verified; its preview proposed 6 records and 5 relations with zero writes. Both exports remain pending approval.
- Last updated: 2026-10-12T19:11:54-04:00.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
