# Appendix B — Backend / protocol design (apps/platform/worker, packages/cli, examples)

## B.1 wrangler.jsonc
```jsonc
{ "name": "artyfact-platform", "main": "./worker/index.ts", "compatibility_date": "2026-10-12", "compatibility_flags": ["nodejs_compat"],
  "assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "artifacts": [{ "binding": "ARTIFACTS", "namespace": "artyfact", "remote": true }],
  "exports": { "SystemAuthority": { "type": "durable-object", "storage": "sqlite" } },
  "durable_objects": { "bindings": [{ "name": "SYSTEMS", "class_name": "SystemAuthority" }] },
  "queues": { "consumers": [{ "queue": "artyfact-artifacts-events", "max_batch_size": 10, "max_retries": 3 }] },
  "vars": { "ARTIFACTS_NAMESPACE": "artyfact", "PUBLIC_URL": "http://localhost:1337" }, "observability": { "enabled": true } }
```
Secrets: `ADMIN_TOKEN` (bearer for accept/promote). No D1 or R2 bindings: the registry lives in DO `__registry`. Worker files: `index.ts` (Hono + `queue()` + DO export), `routes/*.ts`, `do/system-authority.ts`, `artifacts/{genome-source,candidates,source-map}.ts`, `hooks/{exists,scope,overlap,genome-amendment,health,run}.ts`, `packets/task-packet.ts`.

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
Namespace `artyfact`; repos `<slug>.genome`, `<slug>.app` (Peopling: `peopling.*`), forks `<repo>--rN`, plus the `platform` meta repo (slice 2.7, see `apps/platform/README.md`). Bootstrap via `npx artyfact init` (`scripts/bootstrap.sh` wraps it for the example); Worker import = `ARTIFACTS.get(name)` → `log({limit:1})` → DO.bootstrap. `loadGenomeAt(env, repo, commit)`: `using r = await env.ARTIFACTS.get(repo)`; walk `readCommit→readTree` recursively, `readFile` each → `loadGenome(files, {revision: commit, templates})` (a v1 revision is 422 `legacy-genome`); cache parsed JSON in DO keyed by commit. Realization: `base.fork(name, {defaultBranchOnly: true})`, poll `info()` until `ready`, `createToken('write', 21600)`. On submit: `readCommit(commit)` validates; `diffTrees(repo, base, commit)` by comparing tree-entry hashes recursively → changedPaths; the Genome nodes' `files` (`sourceMapFor`, ontology.md §3) → changedNodes (`unmapped:<path>` for misses). Genome amendments go through forks of `<slug>.genome`; admin accept records the fork commit as the new `genomeCommit`. No isomorphic-git in the Worker. Editor writes (`worker/git/`, `worker/editor.ts`): the binding cannot write, so the Worker builds blobs, the rewritten trees along edited paths (untouched subtrees reused by id) and the commit itself, then pushes over smart HTTP `git-receive-pack` (v1, `report-status`, undeltified pack v2) with a write token minted per commit (ttl 300 s, revoked in `finally`); the ref must still be the expected parent, and Artifacts' `ng … stale ref` maps to 409 `stale-head`. The commit then goes through the normal `submit` (source `ui`); once the candidate exists, its push event is marked seen so the queue acks that delivery as a duplicate (if submit fails, the queue still submits it). Commits are capped at 8 MB in total, and files over the 512 KB read cap cannot be edited in place.

Git push, builds, deployments and the Phenome (iteration 2): editor commits are pushed over smart HTTP (above); `FAKE_ARTIFACTS=1` swaps in an in-memory Artifacts namespace and a fake receive-pack (`worker/artifacts/fake-platform.ts`) so the whole loop runs without an account. `builds` and `deployments` (`worker/do/builds-store.ts`) link build, candidate, realization, Evolution and System commit both ways. `phenome_events` (`worker/do/phenome-store.ts`) stores events a deployed app reports with `PhenomeEventHeader` (`POST /systems/:id/phenome/events`, bearer = deployment ingest token, realization secret or admin; 100 events and 8 KB per event, 5000 rows per System, duplicates dropped by `id`). The CI Worker is described in [`docs/ci.md`](../ci.md).

## B.4 Protocol & hooks
Intent routes (admin): `POST /systems/:id/intents {message, anchor?}`, `GET /intents/:pid`, `POST /intents/:pid/reply` and `POST /intents/:pid/accept {opIds}` route and translate a message into ops with the ontology engine, then accept as a Genome amendment candidate. Proposals live in the System DO. Details, errors and the stale-base rule are in `docs/design/ontology.md` §5.

`POST /systems/:id/evolutions {title, intent, kind?, risk?, affectedNodes?, acceptanceCriteria?}` (admin) creates an actionable Evolution; an absent or empty `affectedNodes` is an unconstrained scope (the packet permits every path except the protected ones), and absent `acceptanceCriteria` default to the System's criteria whose `targetKind` matches the Evolution's target (`artifact`/`runtime` for an explicit `implementation`, otherwise `model`: with `kind` absent or `mixed` the target is unknown, and app criteria stay blocking on, but could never pass for, a Genome candidate).

`POST /evolutions/:id/realizations {agentLabel?, target?}` (admin) → fork + token + realization secret (only its SHA-256 is stored; required as a bearer on the realization's checkpoint/submit/sync/status/packet routes, revoked on reject) + packet (JSON + markdown: intent, acceptance criteria, Genome excerpts for affected nodes, journeys, commitments, permitted/protected paths, entry files with certainty, commands, concurrent work, submit instructions, hash). Submission by CLI `POST /submit {commit, previewUrl?}` or Queue `cf.artifacts.repo.pushed` → resolve fork → `submit(id, head, 'event')`; idempotent on (realization, commit); `events_seen` dedupes.
Template upgrades (`worker/template-upgrade.ts`): `GET /systems/:id/template-upgrade?ref=head` → `TemplateUpgradePlan {template, from, to, upToDate, files[{path, action, reason}]}`, comparing blob ids of the current scaffold (`platform:templates/<template>/scaffold.yaml` → repo + path, head), the app at `ref`, and the app's `.artyfact/template.json` lock: missing in the app → `add` (`conflict` if the lock had it and the template changed it); untouched since the lock and changed in the template → `update`; dropped by the template and untouched → `remove`; edited by the app (or no lock) and changed in the template → `conflict`; unchanged in the template since the lock → omitted. CLI ignore rules apply (README, secret files, node_modules, dist). `POST` (admin) `{include?}` applies the non-conflicts plus the included conflicts and the new lock: `createEvolution` ("Upgrade app template to <short>", kind `implementation`) → `startWork` (`human:template-upgrade`, role `author`, origin `editor`) → `commitEdit` with `expectedHead` = the planned app commit; 409 `up-to-date`.

Builds and deployments (iteration 2, [`docs/ci.md`](../ci.md)): a new app candidate dispatches the `artyfact-ci` Workflow (optional `env.CI`); CI, agent or admin build reports land in `builds`; a passed preview with a URL re-enters `submit(…, {commit, previewUrl}, 'ci')` so `C.webapp.health` runs; `promote` records a pending production deployment that a passed production report sets `live`.
| hook | criterion | verdict |
|---|---|---|
| exists | C.webapp.exists | required files present & non-empty at commit |
| scope | C.system.promotion | changed ⊆ permitted; `system/**` in app realization → fail; unmapped → unknown |
| genome-amendment | C.system.structure | loadGenome on fork `system/` valid → status awaiting-admin |
| overlap | C.system.readiness | ConflictReport{file \| soft-semantic \| hard-semantic \| evidence} across concurrent candidates; via `overlap()` |
| health | C.webapp.health | fetch `previewUrl/health`, compare buildId; no URL → not-run/unknown |

Hook selection (`worker/hooks/run.ts`): affected criteria = the Evolution's acceptance criteria ∪ criteria whose `subjectId` is in the candidate's changed nodes ∪ System criteria gated on `submission`. Subject matching is exact: there is no ancestor or descendant expansion. Genome authors must bind each criterion to the node that the source map reports for the files realizing it. Every hook of an affected criterion yields an Evaluation. Hooks the platform cannot run come back `not-run/unknown`.

## B.5 Composition & promotion
`GET /evolutions/:id/candidates` (candidates + evaluations + conflicts). `POST /systems/:id/promote` revalidates exists+scope on the exact commit then CAS. Two complementary candidates: `artyfact compose r1 r2` on the user's machine (fork `<slug>.app--cN`, push merged tree, submit as composed candidate bound to both). `GET /history` newest-first (an alias of `GET /changelog` for one release).

Changelog and compare (`worker/compare.ts`, `worker/changelog.ts`): `resolveRef(scope, ref)` maps `head`, `sc-N`, a candidate id, a recorded 40-hex commit or a realization id (fork head) to `{repo, commit}` for the app or the Genome; an accepted Genome commit resolves to the fork that holds it. App files are compared across repos by tree hash (`diffTreesAcross`): git objects are SHA-1 content-addressed, so equal hashes in a fork and its base mean equal content. Path nodes come from the source map at `to`. A changelog entry is a System commit against its parent (the root import against nothing, so every node and file is added) plus per-criterion folded verdicts before/after and code links; rows and entries are cached in `changelog_cache` because System commits are immutable. Builds and the deployment are attached at read time.

## B.6 CLI
`.artyfact.json` `{platform, systemId, realizationId, forkRepo, remote, tokenExpires, packetHash}` (excluded via `.git/info/exclude`). `start`: GET packet, `git clone -c http.extraHeader="Authorization: Bearer <t>" <remote> <dir>`, write `TASK_PACKET.md`, `AGENTS.md`, `.artyfact.json`. `checkpoint`: commit if dirty + POST. `submit`: commit, `git push origin HEAD:main`, POST, print evaluations. `status`. `compose`. Remote URL form `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<ns>/<repo>.git`.
AGENTS.md block: "You are realizing <evolution> for <system>. Read TASK_PACKET.md fully. Permitted edits: <globs>. Never edit system/** or assays/** in an app realization. Commands: npm install; npm run dev; npm test. Checkpoint often: `npx artyfact checkpoint "<what/why/left>"`. When acceptance criteria <ids> are met and tests pass: `npx artyfact submit`. Your logs are advisory; the platform verifies."

## B.7 Demo runbook
The executed, step-by-step version with real output is `docs/demo-runbook.md`. Differences found running it live: the soft-semantic conflict lands on `operation.contact.save` (via the app's source map), not `policy.ownerOnly`; the Genome flavour must also drop `provisional: true` from `entity.MessageDraft`, since the private-pairs rule skips provisional entities.

`npm i` → `cd apps/platform && npm run dev` → `./scripts/bootstrap.sh` (pushes and imports) → UI Overview → Map zoom to screen.people → Work: Start work ×2 on evolution.1 → two terminals `npx artyfact start r-1 --dir /tmp/a`, `… r-2 --dir /tmp/b`, run an agent in each → live checkpoints via SSE → both submit → Evaluations (exists ✓ scope ✓ health grey) + soft-semantic conflict on policy.ownerOnly → promote A → B stale-base → History. Flavour 2: agent C `target: genome` edits ontology → awaiting-admin → accept → Map re-renders.

## B.8 Tests
DO (vitest-pool-workers, `runInDurableObject`): CAS stale head; block on unknown; duplicate submit; event dedupe; sibling rejection. Hooks pure tests. source-map glob tests. `walkTree/diffTrees` against mocked `ArtifactsRepo`. CLI: temp bare repo + `node:http` mock server. Manual integration smoke documented. The fake platform (`FAKE_ARTIFACTS=1`) backs the `@fake` Playwright specs; `apps/platform/e2e/iteration2.live.spec.ts` covers the real Git push.

## B.9 Tasks, waves and claims
Routes (`shared/api.ts` `routes`): `plan(s,e)` GET → `TaskPlan`, POST `PlanRequest` / PUT `PlanUpdateRequest` (admin) → `TaskPlan`; `startWave(s,e,n)` POST `StartWaveRequest` → `StartWaveResponse`; `tasks(s,{status,evolution})` GET → `TasksResponse` (public); `task(s,t)` GET → `TaskResponse`; `claimTask(s,t)` POST `ClaimTaskRequest` → `ClaimTaskResponse`; `releaseTask(s,t)` POST; `rebase(s,r)` POST → `RebaseResponse`; `intentDecisions(s,p)` PUT `IntentDecisionsRequest` → `Proposal`.
Types: `Task`, `TaskStatus`, `TaskFootprint`, `TaskConflict`, `TaskPlan` (model, A.2), `TaskPlanSummary` on `Evolution.plan`, `TaskPacket.task`, `Realization.task`, `SystemSummary.taskCounts`, signifiers `plan-ready | wave-running | task-awaiting-agent`, SSE `plan.updated`, `task.updated`.
Errors: `plan-cycle`, `plan-in-progress`, `no-plan`, `wave-blocked`, `task-taken`, `task-blocked`, `rebase-conflict`, `up-to-date`.
DO tables: `task_plans`, `tasks` (+ `tasks_by_evolution`); columns `realizations.task_id`, `proposals.plan_json | decisions_json | deferred_from`.
(behaviour: see slices W4/W5/W7)

DO lifecycle (`worker/do/tasks-store.ts`, `SystemAuthority`):
- `putPlan` replaces an Evolution's plan and task rows in one transaction; it is refused `invalid-state` once any of its tasks is past `planned`. A task row's definition is `json`; status, claim and realization are columns and win on read.
- `claimTask` is one conditional UPDATE: `planned`, or `claimed` with a lapsed lease (30 min), and every `dependsOn` task `promoted`. The same label on its own live claim gets `fresh: false`; otherwise `taken`, `blocked` (`blockedOn`) or `invalid-state`. A takeover clears the lapsed claim's realization.
- `reserveRealization({ taskId })` records `realizations.task_id`; `bindTask` points the claimed task at it. It refuses `invalid-state` while any Evolution `dependsOn` entry is not `promoted`.
- Status follows the bound realization: first checkpoint `claimed → realizing`, evaluations `→ evaluated`, promotion `→ promoted`; reject or abandon releases the task to `planned` (claim and realization cleared, the realization keeps its rejection). Each change emits `task.updated`; `putPlan` emits `plan.updated`.
- A Genome candidate is gated only by criteria whose `targetKind` is `model`, read from the cached serialized model of its commit or the head Genome. Artifact, runtime and observation criteria belong to app realizations. An unknown criterion stays in (fail closed). When every acceptance criterion is known not to apply, the empty gate stands and the admin's accept decides.
- Proposal storage: `proposalPlan(pid)` → `{ plan, decisions, deferredFrom? }` and `setProposalPlan(pid, plan, decisions, deferredFrom?)`, which writes only while the proposal is `open`.
- A task realization's gate uses the task's `criteria_json`, else the Evolution's. Promotion rejects only open candidates of the same Evolution and task (no task matching no task); a planned Evolution becomes `promoted` with its last task and stays `realizing` until then.
- Summary: `taskCounts.planReady` counts Evolutions whose tasks are all planned, `awaitingAgent` claimed tasks, `running` realizing or evaluated, `blocked` planned tasks with an unmet dependency. Signifiers `plan-ready`, `task-awaiting-agent`, `wave-running` (a task is realizing); `importReview` and `import-pending` come from the kv pair.

## B.10 Import review
Routes: `importReview(s)` GET → `ImportReview`; `importReviewAccept(s)` POST `ImportReviewAccept` (admin) → `ImportReviewAcceptResponse`. `ImportSystemRequest.review` (default true) leaves a new import pending.
Types: `ImportReview` (tree of `ProposalPlanNode`, readiness `findings`, `unmapped` paths), `SystemSummary.importReview`, signifier `import-pending`, SSE `system.import-review`.
While pending, `POST /evolutions`, `/realizations` and `/intents` are 409 `import-unreviewed`. State lives in DO kv `import_review_status`, `import_review_json`.
(behaviour: see slice W9)

## Parts registry and realization lineage (accepted contract)

Implement an immutable versioned Parts catalog with shared and System-private scopes, authorized package publication/import, exact pinned dependency validation, and inspectable provenance. Keep composition execution local and explicit through CLI/agents; model reads never run commands. Preserve separate Genome approval, application realization, and deployment gates. The CI command allowlist is not extended by package commands.

Persist realized output independently from deployment, retaining source binding, Thing, source revision, Genome revision and build/output locator or digest. Phenome ingestion verifies these associations from stored records rather than trusting emitter IDs; old records without lineage stay explicitly unknown. An admin can register a separate deployment of an existing output with `outputId`; the stored output and passed build must match the deployment repository and commit. CI sets runtime `BUILD_ID` independently from `ARTYFACT_SOURCE_COMMIT`; preview health requires the exact passed build identity, with commit-prefix compatibility only for legacy builds. Track delivery and verification in [GRREAT](../grreat/roadmap.md).
