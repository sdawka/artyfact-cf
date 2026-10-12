# 2026-10-12 — Foundation integration

Links: [[../roadmap]], [[../execution]], [[../analysis]].

C1 now defines Parts, deterministic composition/extraction/upgrades, digest validation and Genome-only Things; C2 supplies immutable scoped catalog routes with authorization and bounded input; C3 supplies independent outputs and authoritative Phenome lineage. Workers report model 84, templates 101, catalog 7, and platform 747 passing tests (2 platform skips). Independent foundation review is in progress.

Primary verification: baseline 5614e64 had 1182 passing tests and 3 skips. Genome-only import first reproduced a missing-app-repo failure, then passed with authority/revision integration checks (53 tests). Path alias/control-character/reserved-key regressions passed (16 composition tests). Native Node model import and whole-workspace typecheck passed after making model/rules exports compatible with the existing CLI runtime.

Public definitions and explorer are updated. Site worker reported 13 unit and 9 generated-page checks; primary ran 20 desktop/mobile browser checks successfully after fixing one ambiguous no-JS test selector. Exact Parts CLI examples await C4.

Integration findings resolved or under verification: preserve a realization's original Genome rather than current head; reject catalog coordinate shadowing that would change dependency identity; do not fabricate source or realized output for Genome-only/historic records.

External state: GRREAT protocol validates (7 records); sync preview reports missing_credentials with zero writes. Automatic approval review rejected GitHub publication because the remote is public; explicit public-export approval remains pending after final local verification. No deployment is claimed.

## Final integration — 2026-10-12T19:11:54-04:00

Sol implementation and independent review are complete. Closed findings cover exact CI/runtime identity (including first-build candidate creation), byte-bounded complete Wrangler output lines, same-SHA cross-fork claims, Genome-fork output rejection, explicit reuse of a realized output across deployments, nested command order, successive-upgrade baselines, unsafe destination preflight, command-created/changed/deleted provenance, and Thing-scoped runtime views. Two stale browser card-entry expectations were corrected to enter the full Thing workspace and retain explicit System overview navigation.

`npm run ci` passed all steps on the final integrated code in 85.2 seconds: 1258 root unit tests and 3 skips; platform fixture 38 and fake-platform 5 browser tests; public site 13 unit, 9 generated-page and 20 desktop/mobile browser tests; all required typechecks and builds. Full log: `/private/tmp/artyfact-parts-ci-verified.log`. Live browser source was updated but not executed; no hosted deployment or authenticated hosted smoke is claimed.

A read-only fetch confirmed `origin/main` remains `5614e64062911bb67ddb2244132142da319e1fec`. The original main checkout retains its existing untracked files untouched. This delivery prepares one local integration commit and one draft PR body; public publication remains blocked by the automatic review's disclosure-approval requirement. GRREAT authenticated preview now succeeds against the existing workspace; final sync receipts follow below.

Final GRREAT protocol validation passed (7 canonical records, including the embedded obverse). Authenticated versioned direct-RPC preview proposed 6 records and 5 relations to `https://grreat.ca/api/agent/v1/rpc`, workspace `ws_bddc55cbf3e14dc8b8c22e651e82a8fd`, with zero writes. Automatic approval review rejected the actual write before execution, stating that explicit authorization to send the note payload to that external destination was missing. Sync remains `pending_export_approval`; no workaround or retry was attempted. GitHub publication has the separate public-disclosure approval blocker.

## Approved publication — 2026-10-12T19:58:17-04:00

The user explicitly approved public code/docs publication and the GRREAT payload export. The branch was pushed and one draft [PR #29](https://github.com/sdawka/artyfact-cf/pull/29) opened at implementation commit `157e66f`. An initial pre-push run timed out in the existing token-security test; its focused 23-test rerun passed, and the complete enabled pre-push gate then passed in 80.9 seconds. No hook was bypassed, and no merge or deployment occurred.

The approved GRREAT write returned `GOAL_HIERARCHY_CONFLICT` for `goal.north-star`, with zero applied changes. Read-only inspection verified that the authenticated workspace already has a different North Star and no matching Artyfact root. The authenticated API binds one workspace per user and exposes no workspace inventory or arbitrary destination selector. The conflict checkpoint is preserved; no remote record was overwritten, reparented or archived. Correct destination credentials or an explicit hierarchy choice remain necessary. Hosted CI is tracked on the draft PR.
