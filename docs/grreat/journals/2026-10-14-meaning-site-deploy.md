# Public site deployed through Artifacts — 2026-10-14

Context: [[../goals]], [[../execution]]. Approved work: holistic "information → meaning" site copy, shipped through Artifacts rather than a laptop deploy.

- [PR #92](https://github.com/sdawka/artyfact-cf/pull/92) merged as `858b7b08` with exact-head CI green (run 38671729889). The PR included the Genome Evolution, copy on every public page, shared CLI/CI helpers, security hardening and the `artyfact-ci` site deploy.
- Resources: queue `artyfact-site-deploys` (`9a93386a…`), `artyfact-ci` version `25a40a33`, subscription `artyfact-platform.builds-site-deploy` (`bf62384c…`). The CLI's typed flags cannot name an `artifacts.repo` source, so the subscription was created with `cf queues subscriptions create --body`.
- `npm run release -- --site-via-ci` released `v-858b7b089fed` as `platform.builds@d32265a2` and deployed `artyfact-platform` version `1628246e`. That push predated the subscription, so one `pushed` event for `d32265a2` was enqueued by hand. Workflow `site-d32265a2…` completed and deployed `artyfact-site` version `22e90e93` (100%). `/`, `/model`, `/connect-agent` and `/how-it-works` return 200 with the new copy.
- Found: the account had no event subscriptions, so the platform's per-fork push subscriptions are no-ops (the platform has no `CF_API_TOKEN`).
- Open: the full Evolution → Haiku Task forks run on a local platform was not executed. Copy landed directly; Haiku translated `/model` and `/how-it-works` only as a demonstration. The VERIFICATION_TOKEN rotation still returns 401 on the operator smoke test.
- Updated: 2026-10-14T23:00:00-04:00.
