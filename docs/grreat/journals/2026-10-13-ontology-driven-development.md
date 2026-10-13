# Ontology Driven Development public page · 2026-10-13

The accepted direction in the decision log replaces the domain-first opening with six semantic-layer benefits, then explicitly introduces Artyfact’s meta ontology. The existing System-first explanation, optional Parts and Rule Packs, one clearly illustrative three-view explorer and agent handoff remain. The page uses existing site tokens and two-column benefit rows that stack on mobile; section links work through native fragment navigation, including without JavaScript. Route and navigation labels stay stable; backend contracts are unchanged. Supports [[../goals]] and [[../roadmap]].

## Evidence

The existing baseline model tests passed 10/10. Revised tests first failed on the missing heading/navigation (3 failures), then the full site unit suite passed 56/56. Site typecheck and build passed; static checks passed 11/11; desktop/mobile browser checks passed 47 with 5 existing viewport skips, including no-JS content, 320px links/focus, reduced motion and axe checks. Desktop 1440px and mobile 320px screenshots have no horizontal overflow.

Independent source review found no other issue but inferred that fragment links would fail to focus their targets. Actual browser tests in both projects and a separate Chromium check confirmed native focus on the tabindex=-1 targets, so that finding is dismissed without adding a handler. The first static check hit stale workspace links in a shared dependency install; isolated lockfile-pinned npm ci --offline resolved it and the check passed.

## Handoff

Branch: feat/ontology-driven-development; PR [#57](https://github.com/sdawka/artyfact-cf/pull/57) is open. Shared pre-push CI passed in 59.0s on commit d3f558e and the branch was pushed. Its site-only gate passed typecheck/build, 56 unit tests, 11 static checks and 47 browser checks (5 existing skips). Hosted PR checks remain next; no merge or deployment is part of this revision. A local network-bound preview returns HTTP 200 with the redesigned heading; this does not establish access from another device. Canonical records validate (7 records). Versioned direct-RPC sync preview was attempted and applied zero commands; it proposes six new records in the existing workspace. A separate Artyfact destination is still unestablished, so sync stays pending and the earlier GOAL_HIERARCHY_CONFLICT is preserved rather than writing into the other hierarchy.

## Release integration

PR #57 was reconciled with main at 5c39a76, retaining the newer platform and homepage work. The sole conflict was the Execution handoff; both the new main context and this page revision are retained. Full local CI passed in 202.0s (2412 root tests, 9 skips; 57 site units, 11 static checks; 47 fixture, 13 fake-platform and 47 site browser checks with 5 site skips), and hosted full CI passed on fa27e34. Main then advanced through the docs-only #59; the newer handoff is preserved with this entry, and the PR check must pass on the final notes revision before merge and public-site deployment.

## 2026-10-13T12:48:45-04:00 · Public release

PR [#57](https://github.com/sdawka/artyfact-cf/pull/57) merged at `1b79e936f47b20abd2afde17d489a048f305b9ba` only after all hosted PR checks were green on the exact head. [Full hosted CI](https://github.com/sdawka/artyfact-cf/actions/runs/38430170321) passed on the application code; [the final PR check](https://github.com/sdawka/artyfact-cf/actions/runs/38431731876) passed after the docs-only reconciliation. The pinned site deploy script rebuilt that merged revision and published `artyfact-site` version `36e2c751-c5fd-4e0e-8c50-ac2348a940ca`; deployment `37d31f1e-f62f-4128-bf06-a7c18f00e7e0` serves it at 100%.

Live https://artyfact.ing/model checks pass at desktop 1440px and mobile 320px: the new heading, six benefits, hydrated explorer keyboard selection, native section-link focus, no horizontal overflow and no page errors. With JavaScript disabled, all three panels remain readable. The homepage and agent guide return HTTP 200. An initial smoke test queried controls before enhancement completed; the condition-based check waits for the actual enhancement state and passes. Live response inspection confirmed the application assets return 200; the existing CSP blocks a separately injected Cloudflare analytics beacon, without blocking application hydration. The platform Worker was not part of this release. Canonical records validate; the separate Artyfact GRREAT destination is still unresolved, preserving the prior sync conflict.
