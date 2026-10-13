# 2026-10-13 — Keep in Touch renamed to Peopling

Links: [[../execution]], [[../roadmap]]. Follows [[2026-10-13-design-pass]].

## The rename (PR #60)

The example System is now Peopling everywhere, identifiers included. `system.keep-in-touch` became `system.peopling`; the repos `keep-in-touch.genome` / `keep-in-touch.app` became `peopling.genome` / `peopling.app`, forks `peopling.*--rN`. The directories moved to `examples/peopling-system` and `examples/peopling-app` (packages `@artyfact/example-peopling-*`), with the platform fixtures (`peopling.model.json`, `peopling.files.json`), the hooks test, the source spec `docs/source/peopling-world-specification.docx` and its Genome citations, and the ontology test fixtures following. The fake-platform seed is `peopling` (still the `FAKE_SEED` default), the e2e helpers point at the new id, and the `kit` shorthand in unit tests and the demo runbook reads `peopling`. The app Worker and its D1 `database_name` are `peopling`; the ci Worker's `D1_DATABASE_IDS` maps `system.peopling` → `peopling` → the unchanged D1 id. The fixture bundle, template bundle, degraded ontology fixture, codec-v1 snapshot and lockfile were regenerated; 469 files changed, 329 of them path renames.

Deliberately left as they were: the purpose statement's prose ("help an individual keep in touch with…", asserted by Overview, Theory and surface tests), the ontology's own `kit` concept (`kind: kit`, `kit.unpinned`, `model-kit`, the auth kit), earlier journal entries, and the physical D1 database on the account, which keeps the name `keep-in-touch` because the mapping is by id.

## Admin `DELETE /api/systems/:id`

Prod had no way to drop the old id after a re-import. The platform now has an admin-only delete: it removes the registry row and the System's fork index entries, then wipes the System's Durable Object on a best-effort basis (`stateCleared` in the response; a failed wipe leaves the object idle). The DO id itself cannot be deleted. Artifacts repos, forks and push subscriptions are untouched. Covered by a worker test (import → delete → unlisted and 404; 401 without a bearer, 403 with the wrong one) and documented with the curl line under "Remove a System" in `docs/deploy.md`.

Verification on the branch: typecheck clean; 2411 root tests passed (the platform suite re-run after the route: 973); the 13 fake-platform browser checks passed. Hosted CI on the PR is the gate.

## Prod follow-up

1. Redeploy the ci Worker (`npm run deploy -w @artyfact/ci`) so `D1_DATABASE_IDS` carries the new keys before any CI build of `system.peopling`.
2. Deploy the platform and re-import the prod System as `system.peopling` with new repos `peopling.genome` / `peopling.app`.
3. Remove the old System: `DELETE $URL/api/systems/system.keep-in-touch` with the admin bearer.
