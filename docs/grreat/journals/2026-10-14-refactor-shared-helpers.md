# Shared platform helpers — 2026-10-14

Context: [[../goals]], [[../execution]]. Approved work: audit opportunities 1–3 in one PR, with the three remaining presented opportunities tracked as issues.

- Based on `origin/main` at `c225282188a870087921c20e3bdc01f552e22162` in an isolated worktree on `refactor/shared-platform-helpers`; the original dirty checkout is preserved.
- The frontend delegates equivalent paths to existing shared route builders. Explicit `rev=` queries and differing route shapes retain their adapters.
- Worker `errors.ts` owns one awaited RPC wrapper, replacing seven duplicate wrappers and the equivalent Task-review catch. Mapping codes and unknown-error identity are preserved.
- Removed the unused map ELK adapter and its exclusive helpers/tests. Active atlas layout, generic ELK, and graph projection/band coverage remain.
- Follow-ups: [#87](https://github.com/sdawka/artyfact-cf/issues/87) shares import-review middleware; [#88](https://github.com/sdawka/artyfact-cf/issues/88) consolidates CLI transport; [#89](https://github.com/sdawka/artyfact-cf/issues/89) separates task provisioning and compensation. Each includes source links and regression acceptance criteria.

## Validation and handoff

- Baseline root typecheck and 129 focused tests passed. Route characterization passed before refactoring; the nine new RPC cases first failed because the helper was absent, then passed with implementation.
- Initial focused check: 18 files, 138 tests passed; covers client URLs, atlas/graph behavior, RPC outcomes, lifecycle, Parts, integrity and ontology routes. `git diff --check` passes.
- Independent review found no actionable issues. All ten steps of `npm run ci -- --ultra-compact` passed in 331.9s, including root tests, typechecks/builds, platform fixture/fake browser suites, and site checks. The original delivery is [PR #91](https://github.com/sdawka/artyfact-cf/pull/91), merged by the user at `2ea0a0eab689248642cbebcbc2e9723ce69d642e` while its hosted CI was still running. Its exact-head [CI run](https://github.com/sdawka/artyfact-cf/actions/runs/38671036109) subsequently completed successfully.
- Versioned RPC preview returned `pending: missing_credentials`, applied 0; no sync records were sent. Preserve the unconfirmed separate Artyfact destination and earlier conflict history.
- Integration: main advanced to `b456235da390fa39236a00717a8461679d6b4c75` while verification ran. Its code merged cleanly; the canonical bootstrap Now section is preserved, with this refactor linked alongside it. The added `verification-required` RPC code has a regression case. Integrated root typecheck and 139 focused tests pass; independent integration review found no actionable issues. The required final pre-push gate passed all ten steps in 376.0s at code revision `d9e618264cb75abdae48d9091fc0bc6ee6fb6eb6`: 3,255 root tests (9 skipped), 108 fixture/16 fake browser checks, 42 site units and 52 site browser checks (2 skipped), plus typechecks/builds. The `05460eec` handoff commit changed notes only. The later verification-wrapper cleanup is recorded below; the next action is PR review.
- Current-main completion: the newly merged verification module also used an identical RPC wrapper. Its four DO calls now use the shared helper; root typecheck and 16 RPC/verification route/evidence/store checks pass, and independent review found no actionable issues. The user merged PR #91 before this last cleanup was published. Its pending push was stopped; the user approved a small follow-up, now on `refactor/verification-rpc` based on main `858b7b089fedc4df07f38a39894063ae5cec5ddd`. The normal pre-push hook gates the follow-up; exact-head hosted check results remain authoritative on GitHub.
- Updated: 2026-10-14T22:40:46-04:00.
