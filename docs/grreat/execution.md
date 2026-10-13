<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Implement the approved model

## Now

- Goal: [[goals]]. Milestone: iteration 3, the ontology-engine core, delivered as PR #47 in [[roadmap]] context.
- Working revision: branch `iteration-3` (98 commits), PR #47; local `npm run ci` green. Hosted CI is tracked on the PR.
- Current result: the ontology engine lives in `packages/ontology` as the core. Genomes use a v2 containment tree; v1 survives only through `artyfact convert-genome --source-map` and a legacy notice. Intents, generic UI and templates, and the repo-root self-Genome shipped; see [[journals/2026-10-13-iteration-3]].
- Next action: merge PR #47 once all CI checks are green, deploy the platform, migrate the production Keep in Touch Genome with `artyfact init --genome-only --adopt --force` per `docs/deploy.md`, then verify live.
- Latest verification: local CI green on the PR head; no hosted or production verification yet.
- Landing-site work from main (`feat/landing-agent-story`, based on released main `1bb21321`, PRs #44/#45): a purpose-only miniature Artyfact opens into its declared shape, outside-agent realization and local idea activity through reversible native scrolling; the public homepage only. Its last recorded full `npm run ci` passed in 129.4s (1341 root tests, 3 skips; site 41 unit, 11 static and 40 browser checks); see [[journals/2026-10-12-foundation]].
- Deferred: Remote GRREAT sync stays pending; the earlier `GOAL_HIERARCHY_CONFLICT` checkpoint is preserved and no remote record was overwritten.
- Last updated: 2026-10-13.

## Work history

- [[journals/2026-10-12-adoption]]: accepted direction and refreshed baseline.
- [[journals/2026-10-12-foundation]]: foundation integration and validation.
- [[journals/2026-10-13-iteration-3]]: ontology engine core, Genome v2, intents; PR #47.
