# Appendix B — Backend / protocol design (apps/platform/worker, packages/cli, examples)

## B.1 wrangler.jsonc
```jsonc
{ "name": "artyfact-platform", "main": "./worker/index.ts", "compatibility_date": "2026-10-12", "compatibility_flags": ["nodejs_compat"],
  "assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "artifacts": [{ "binding": "ARTIFACTS", "namespace": "artyfact", "remote": true }],
  "exports": { "SystemAuthority": { "type": "durable-object", "storage": "sqlite" } },
  "durable_objects": { "bindings": [{ "name": "SYSTEMS", "class_name": "SystemAuthority" }] },
  "d1_databases": [{ "binding": "INDEX", "database_name": "artyfact-index", "database_id": "<id>" }],
  "r2_buckets": [{ "binding": "EVIDENCE", "bucket_name": "artyfact-evidence" }],
  "queues": { "consumers": [{ "queue": "artyfact-artifacts-events", "max_batch_size": 10, "max_retries": 3 }] },
  "vars": { "ARTIFACTS_NAMESPACE": "artyfact", "PUBLIC_URL": "http://localhost:5173" }, "observability": { "enabled": true } }
```
Secrets: `ADMIN_TOKEN` (bearer for accept/promote). D1 is a derived index only (may be skipped; registry table in DO `__registry`). Worker files: `index.ts` (Hono + `queue()` + DO export), `routes/*.ts`, `do/system-authority.ts`, `artifacts/{genome-source,candidates,source-map}.ts`, `hooks/{exists,scope,overlap,genome-amendment,health,run}.ts`, `packets/task-packet.ts`.

## B.2 SystemAuthority SQLite + RPC
```sql
head(k PK, v)  -- 'head','genome_repo','app_repo','genome_commit'
system_commits(id PK, parent, manifest_json, manifest_hash, evolution_ids, decision_json, created_at)
evolutions(id PK, title, status, kind, base_commit, scope_json, criteria_json, affected_nodes, created_at, decided_at)
realizations(id PK, evolution_id, n, target, fork_repo, token_id, token_expires, base_commit, agent_label, status, packet_json, packet_hash, created_at, updated_at)
checkpoints(realization_id, seq, message, commit_hash, created_at, PK(realization_id, seq))
candidates(id PK, realization_id, commit_hash UNIQUE, manifest_json, changed_paths, changed_nodes, created_at)
evaluations(id PK, candidate_id, criterion_id, hook_id, execution, verdict, observations_json, evidence_key, verifier, created_at)
events_seen(event_id PK, seen_at)
```
`promote` runs in `transactionSync`: read head, compare to `expectedHead` else throw `StaleBaseError{currentHead}`; require every required-gate criterion of the candidate to have `verdict=pass, execution=completed`; compose manifest `{genomeCommit, artifacts:{'artifact.webapp':{repo,commit}}, templateVersions, hookVersions}`; SHA-256 canonical JSON; insert system_commit parent=head; update head; sibling candidates → rejected; evolution → promoted. Promotion changes the manifest, not git.

## B.3 Artifacts usage
Namespace `artyfact`; repos `kit-system`, `kit-app`; forks `kit-app--rN`, `kit-system--rN`. Bootstrap via `scripts/bootstrap.sh` (git init + push examples with a token from `wrangler artifacts repos issue-token`); Worker import = `ARTIFACTS.get(name)` → `log({limit:1})` → DO.bootstrap. `loadGenomeAt(env, repo, commit)`: `using r = await env.ARTIFACTS.get(repo)`; walk `readCommit→readTree` recursively, `readFile` each → `loadSystem(files, {revision: commit, templates})`; cache parsed JSON in DO keyed by commit. Realization: `base.fork(name, {defaultBranchOnly: true})`, poll `info()` until `ready`, `createToken('write', 21600)`. On submit: `readCommit(commit)` validates; `diffTrees(repo, base, commit)` by comparing tree-entry hashes recursively → changedPaths; `source-map.yaml` (template defaults ∪ repo file) → changedNodes (`unmapped:<path>` for misses). Genome amendments go through forks of `kit-system`; admin accept records the fork commit as the new `genomeCommit`. No isomorphic-git in the Worker.

## B.4 Protocol & hooks
`POST /evolutions/:id/realizations {agentLabel?, target?}` → fork + token + packet (JSON + markdown: intent, acceptance criteria, Genome excerpts for affected nodes, journeys, commitments, permitted/protected paths, entry files with certainty, commands, concurrent work, submit instructions, hash). Submission by CLI `POST /submit {commit, previewUrl?}` or Queue `cf.artifacts.repo.pushed` → resolve fork → `submit(id, head, 'event')`; idempotent on (realization, commit); `events_seen` dedupes.
| hook | criterion | verdict |
|---|---|---|
| exists | C.webapp.exists | required files present & non-empty at commit |
| scope | C.system.promotion | changed ⊆ permitted; `system/**` in app realization → fail; unmapped → unknown |
| genome-amendment | C.system.structure | loadSystem on fork `system/` valid → status awaiting-admin |
| overlap | C.system.readiness | ConflictReport{file \| soft-semantic \| hard-semantic \| evidence} across concurrent candidates; via `overlap()` |
| health | C.webapp.health | fetch `previewUrl/health`, compare buildId; no URL → not-run/unknown |

## B.5 Composition & promotion
`GET /evolutions/:id/candidates` (candidates + evaluations + conflicts). `POST /systems/:id/promote` revalidates exists+scope on the exact commit then CAS. Two complementary candidates: `artyfact compose r1 r2` on the user's machine (fork `kit-app--cN`, push merged tree, submit as composed candidate bound to both). `GET /history` newest-first.

## B.6 CLI
`.artyfact.json` `{platform, systemId, realizationId, forkRepo, remote, tokenExpires, packetHash}` (excluded via `.git/info/exclude`). `start`: GET packet, `git clone -c http.extraHeader="Authorization: Bearer <t>" <remote> <dir>`, write `TASK_PACKET.md`, `AGENTS.md`, `.artyfact.json`. `checkpoint`: commit if dirty + POST. `submit`: commit, `git push origin HEAD:main`, POST, print evaluations. `status`. `compose`. Remote URL form `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<ns>/<repo>.git`.
AGENTS.md block: "You are realizing <evolution> for <system>. Read TASK_PACKET.md fully. Permitted edits: <globs>. Never edit system/** or assays/** in an app realization. Commands: npm install; npm run dev; npm test. Checkpoint often: `npx artyfact checkpoint "<what/why/left>"`. When acceptance criteria <ids> are met and tests pass: `npx artyfact submit`. Your logs are advisory; the platform verifies."

## B.7 Demo runbook
`npm i` → `./scripts/bootstrap.sh` → `cd apps/platform && npm run dev` → `curl -XPOST localhost:5173/api/systems/import -d '{"systemId":"system.keep-in-touch","genomeRepo":"kit-system","appRepo":"kit-app"}'` → UI Overview → Map zoom to screen.people → Work: Start work ×2 on evolution.1 → two terminals `npx artyfact start r-1 --dir /tmp/a`, `… r-2 --dir /tmp/b`, run an agent in each → live checkpoints via SSE → both submit → Evaluations (exists ✓ scope ✓ health grey) + soft-semantic conflict on policy.ownerOnly → promote A → B stale-base → History. Flavour 2: agent C `target: genome` edits ontology → awaiting-admin → accept → Map re-renders.

## B.8 Tests
DO (vitest-pool-workers, `runInDurableObject`): CAS stale head; block on unknown; duplicate submit; event dedupe; sibling rejection. Hooks pure tests. source-map glob tests. `walkTree/diffTrees` against mocked `ArtifactsRepo`. CLI: temp bare repo + `node:http` mock server. Manual integration smoke documented.

