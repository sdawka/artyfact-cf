# App intention fixes — 2026-10-14

Implemented the accepted [[../roadmap]] after [[2026-10-14-intention-spike]], preserving [[../goals]] and the existing user files. Seven focused commits extend [PR #77](https://github.com/sdawka/artyfact-cf/pull/77); no merge or deployment is part of this delivery.

- Acceptance contracts: criterion/hook/source-reference and enforced-gate changes require replanning; unrelated Genome advances retain pinned provenance.
- Thing operations: bindings, metrics and flags follow the selected Thing, with immediate editor reset on scope changes.
- Onboarding: prepare-only bootstrap writes reviewed Genome files without provisioning; the handoff supplies platform/credential setup, local agent instructions, minimal source preparation, reviewed init and real node-scoped drafting. Genome-only remains valid.
- Evidence: server filters and totals share the same scope. Runtime outcomes remain unknown without authoritative evaluation; implementation evidence requires exact deployment/build/output association. Unknown legacy outputs are grouped by build and commit, avoiding borrowed lineage.
- History: scoped cursor paging, stable totals, retry and navigation reset preserve retained runtime evidence.
- Recovery: CLI and server use the same task availability rules and offer resume for expired attempts while retaining dependency and writer fencing.
- Review: imports, Genome approvals, Task candidate selection and integrated promotion share one inbox. Candidate diffs validate Task membership, pinned manifests and changed paths; Work retains planning/execution and legacy links remain usable.

## Verification

Focused worker, UI, model and CLI regressions pass. Independent review of the first six slices found the legacy build-ID collision above; a cross-commit regression reproduced it and the fix passed runtime UI/API 42 and Worker 64 tests. The second independent reviewer found no further actionable issues after checking scoped pagination and Task-review authorization, membership, pinned manifests and changed-file allowlists; fresh Worker 61 and UI 53 tests passed. The full gate caught a model test importing Worker code across its package boundary; the pure test and server parity test now live in their owning packages. The final review also verified immediate Home-count invalidation after decisions. Full CI additionally caught missing self-Genome endpoint declarations and a 320px Review error-path overflow; both were corrected without weakening checks.

Eight fixture browser cases passed at desktop/mobile widths, covering import acceptance, plan handoff, exact Task evidence, keyboard selection, reduced motion, accessibility and overflow. One fake-provider journey passed from a seeded System through drafting, real CLI claims/submission, Task selection, integration and promotion through Review. It does not establish real-Artifacts provisioning or a complete fresh-account onboarding flow. Production has not changed.

The complete `npm run ci -- --ultra-compact` gate passed on the final integrated source in **256s**: 2872 root unit tests (9 skipped), 98 fixture browser tests, 16 fake-provider browser tests, 28 site units, site static-build checks and 36 site browser tests (2 skipped), with all typechecks/builds passing. The new source files were staged before a separate successful self-Genome mapping check. Hosted results are tracked on PR #77; local evidence alone does not establish hosted success.

GRREAT validation passed with seven records. The versioned RPC dry-run returned `pending: missing_credentials`, `applied: 0`. Preserve the earlier wrong-project conflict; no remote apply was attempted. [[../execution]] tracks the next action.

## Release — 2026-10-14T11:53:48-04:00

The user subsequently authorized review/merge and deployment. PR #77 merged as `1ec3826de3bd3a24ff4ac7eddb061ae8f0c56888` after the exact head `ee4e98bb` passed [hosted verification](https://github.com/sdawka/artyfact-cf/actions/runs/38585347923) in 9m27s and final independent review found no blockers. The concurrent site-only main changes passed the post-merge site gate, including 44 browser tests (2 skips).

- Platform: `39aba8f8-dd0d-4810-b6a6-5feb373fa6c0` at https://artyfact-platform.dawka.workers.dev. Site: `a5b7ff36-c033-4420-b9c6-49ce6518b300` at https://artyfact.ing. Both deploy scripts built from the merged revision. The first local platform build stopped before upload because a locked dependency was missing; `npm ci` restored it without source changes.
- Credential preservation: canonical protected Parts read returned 200 before and after deployment; unauthenticated access returned 401. Health, model, plans and Thing-scoped runtime events returned 200. Existing production secrets were retained.
- Live browser: Home, Start, Review, Work and Thing Deployments passed at 1440px and 320px; mobile used reduced motion. No serious/critical axe violations, horizontal overflow, page errors or attempted writes were recorded. Site home, model and connect-agent passed at both widths, for 16 route checks overall. Two navigation timeouts resolved on bounded fresh-context retries; Review readiness was checked from its rendered UI rather than network silence.
- Limits: production had no waiting Task decision in the inspected inbox. Exact candidate selection/promotion is covered by local fake-provider tests, not live writes. Fresh-account provisioning and the real-Artifacts lifecycle run remain deferred. User untracked files were preserved.

Canonical validation passed with seven records. Versioned RPC preview remains pending missing credentials with zero applied records; no remote conflict was overwritten.
