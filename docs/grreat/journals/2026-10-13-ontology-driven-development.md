# Ontology Driven Development public page · 2026-10-13

The accepted direction in the decision log replaces the domain-first opening with six semantic-layer benefits, then explicitly introduces Artyfact’s meta ontology. The existing System-first explanation, optional Parts and Rule Packs, one clearly illustrative three-view explorer and agent handoff remain. The page uses existing site tokens and two-column benefit rows that stack on mobile; section links work through native fragment navigation, including without JavaScript. Route and navigation labels stay stable; backend contracts are unchanged. Supports [[../goals]] and [[../roadmap]].

## Evidence

The existing baseline model tests passed 10/10. Revised tests first failed on the missing heading/navigation (3 failures), then the full site unit suite passed 56/56. Site typecheck and build passed; static checks passed 11/11; desktop/mobile browser checks passed 47 with 5 existing viewport skips, including no-JS content, 320px links/focus, reduced motion and axe checks. Desktop 1440px and mobile 320px screenshots have no horizontal overflow.

Independent source review found no other issue but inferred that fragment links would fail to focus their targets. Actual browser tests in both projects and a separate Chromium check confirmed native focus on the tabindex=-1 targets, so that finding is dismissed without adding a handler. The first static check hit stale workspace links in a shared dependency install; isolated lockfile-pinned npm ci --offline resolved it and the check passed.

## Handoff

Branch: feat/ontology-driven-development; PR [#57](https://github.com/sdawka/artyfact-cf/pull/57) is open. Shared pre-push CI passed in 59.0s on commit d3f558e and the branch was pushed. Its site-only gate passed typecheck/build, 56 unit tests, 11 static checks and 47 browser checks (5 existing skips). Hosted PR checks remain next; no merge or deployment is part of this revision. A local network-bound preview returns HTTP 200 with the redesigned heading; this does not establish access from another device. Canonical records validate (7 records). Versioned direct-RPC sync preview was attempted and applied zero commands; it proposes six new records in the existing workspace. A separate Artyfact destination is still unestablished, so sync stays pending and the earlier GOAL_HIERARCHY_CONFLICT is preserved rather than writing into the other hierarchy.
