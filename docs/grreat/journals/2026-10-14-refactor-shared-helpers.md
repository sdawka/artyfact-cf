# Shared platform helpers — 2026-10-14

Context: [[../goals]], [[../execution]]. Approved work: audit opportunities 1–3 in one PR, with the three remaining presented opportunities tracked as issues.

- Based on `origin/main` at `c225282188a870087921c20e3bdc01f552e22162` in an isolated worktree on `refactor/shared-platform-helpers`; the original dirty checkout is preserved.
- The frontend delegates equivalent paths to existing shared route builders. Explicit `rev=` queries and differing route shapes retain their adapters.
- Worker `errors.ts` owns one awaited RPC wrapper, replacing six duplicate wrappers and the equivalent Task-review catch. Mapping codes and unknown-error identity are preserved.
- Removed the unused map ELK adapter and its exclusive helpers/tests. Active atlas layout, generic ELK, and graph projection/band coverage remain.
- Follow-ups: [#87](https://github.com/sdawka/artyfact-cf/issues/87) shares import-review middleware; [#88](https://github.com/sdawka/artyfact-cf/issues/88) consolidates CLI transport; [#89](https://github.com/sdawka/artyfact-cf/issues/89) separates task provisioning and compensation. Each includes source links and regression acceptance criteria.

## Validation and handoff

- Baseline root typecheck and 129 focused tests passed. Route characterization passed before refactoring; the nine new RPC cases first failed because the helper was absent, then passed with implementation.
- Final focused check: 18 files, 138 tests passed; covers client URLs, atlas/graph behavior, RPC outcomes, lifecycle, Parts, integrity and ontology routes. `git diff --check` passes.
- Independent review found no actionable issues. All ten steps of `npm run ci -- --ultra-compact` passed in 331.9s, including root tests, typechecks/builds, platform fixture/fake browser suites, and site checks. PR and exact-head hosted checks remain pending.
- Versioned RPC preview returned `pending: missing_credentials`, applied 0; no sync records were sent. Preserve the unconfirmed separate Artyfact destination and earlier conflict history.
- Updated: 2026-10-14T22:11:37-04:00.
