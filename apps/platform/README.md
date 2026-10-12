# @artyfact/platform

One Cloudflare Worker with Static Assets: Hono serves `/api/*`, a React 19 SPA serves everything else.

## Run
```
npm install            # from the repo root
cp apps/platform/.dev.vars.example apps/platform/.dev.vars   # then set ADMIN_TOKEN=$(openssl rand -hex 32)
npm run dev -w @artyfact/platform   # http://localhost:1337 (next free port if taken; the CLI finds it)
```
- `GET /api/health` returns the service status; `/style` is the living style sheet.
- `npm test -w @artyfact/platform` (workerd + jsdom projects), `npm run typecheck`, `npm run build`.
- The full demo against real Artifacts is `docs/demo-runbook.md`. The opt-in integration test runs that loop in namespace `artyfact-test`: `ARTYFACT_INTEGRATION=1 npx vitest run --project integration` (uses `wrangler.integration.jsonc`).
- `npm run cf-typegen` regenerates `worker/env.d.ts` after editing `wrangler.jsonc`.
- The `ARTIFACTS` binding is `remote: true`, so `npm run dev` (real backend) needs `wrangler login` or `CLOUDFLARE_API_TOKEN`. Nothing else does: tests use `wrangler.test.jsonc`, the same config without that binding (keep the two in sync).
- `npm run preview:fixture` builds and serves the SPA statically (`vite.fixture.config.ts`, no Cloudflare plugin) on http://localhost:1338 with bundled fixture data. `npm run e2e` runs Playwright against it; no Cloudflare credentials needed. `npm run e2e:live` runs the `@live` specs against `wrangler dev` and does need a login.
- `worker/env.d.ts` is generated; do not hand-edit it (use `cf-typegen`, secrets go in `worker/secrets.d.ts`).

## Env
Secrets (`.dev.vars`): `ADMIN_TOKEN`, `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `FAKE_S1`, `ALLOW_LOCAL_PREVIEW`. Vars live in `wrangler.jsonc`;
set `ACCOUNT_ID` (from `wrangler whoami`) in `.dev.vars` so fork remotes are `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<ns>/<repo>.git`.

### System One provider
Without `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`, every System One judgment is `unknown`. Hard criteria judged by System One, such as `C.system.purpose`, then keep the promotion gate closed. This is by design: nothing is green without evidence. For local work set `FAKE_S1=1` in `.dev.vars`. The UI labels judgments from the fake provider.

## API
All under `/api`; errors are `{error: {code, message, details?}}`. DTOs in `shared/api.ts`. Admin = `Authorization: Bearer $ADMIN_TOKEN` (401 when missing, 403 when wrong). Secret = `Authorization: Bearer <secret>`, the realization secret returned once by start work (the DO keeps only its SHA-256, reject revokes it); the admin bearer is also accepted, and another realization's secret is 403. The push queue needs neither.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/systems` | - | `SystemsResponse` (registry DO `__registry`) |
| POST | `/systems/import` | admin | `{systemId, genomeRepo?, appRepo?, scaffoldFrom?, force?}` → `ImportSystemResponse` (201) with the repos used, `platform` and `warnings`; omitted repos default to `<slug>.genome` / `<slug>.app`, where the slug is the id without `system.`; 400 `invalid-system-id` unless that is lower-case letters, digits, `.`, `_`, `-` (no `..`); a `platform` that cannot be read never fails the import (warning `platform.unreadable`, recorded provenance kept); 422 `repo-not-found` when a repo is missing; re-import from different repos/commits is 409 `already-imported` unless `force` |
| GET | `/systems/:id` | - | `SystemSummary` |
| GET | `/systems/:id/model?rev=` | - | `ModelBundle`; `rev` = `canonical` (default), `sc-…` System commit, `candidate.…`, or a 40-hex commit this System recorded (a candidate's, or a Genome commit in History; any other is 404 and never read). Evidence at a System commit counts every candidate promoted into it and its ancestors |
| GET | `/systems/:id/readiness?rev=` | - | `ReadinessResponse`: the full rules `Readiness` plus the three-state summary; `/model`'s `readiness` is the same. Both are served from the DO cache when warm |
| GET | `/systems/:id/work`, `/systems/:id/evolutions` | - | `WorkResponse` |
| GET | `/systems/:id/evolutions/:eid` | - | `Evolution` |
| POST | `/systems/:id/evolutions/:eid/realizations` | admin | `{agentLabel?, target?, role?}` → `StartWorkResponse` (201); the only response carrying the fork token and the realization `secret` (also in `packet.workspace.secret` and `startCommand`: `ARTYFACT_TOKEN=… ARTYFACT_SECRET=… npx artyfact start <rid> --system … --evolution … --dir …`) |
| GET | `/systems/:id/evolutions/:eid/realizations` | - | `{realizations}` |
| GET | `/systems/:id/evolutions/:eid/candidates` | - | `CandidatesResponse`, with `gates`: each candidate's promotion gate as the server enforces it (`gatesError` when it cannot be computed) |
| POST | `/systems/:id/evolutions/:eid/accept` | admin | `{realizationId, candidateId, commit, interpretation}` → `AcceptResponse` (Genome realizations; `realization` / `rationale` accepted as aliases). `candidateId` and `commit` name the reviewed candidate (from `<R>/review`): 400 without them, 409 `stale-candidate` unless it is still the realization's latest at that commit. Same gate as promote, after re-running the candidate's hooks with promotion facts: 409 `blocked` `{blocking, advisories}`, 400 `advisories-unacknowledged` without an interpretation, 409 `gate-unavailable` |
| GET | `<R>` | secret | `RealizationResponse` (Realization fields at top level, plus `realization`, `candidateDetail`, `evaluations`, `conflicts`) |
| GET | `<R>/packet` | secret | `PacketResponse` (no token or secret; `startCommand` carries `<token>` and `<secret>` placeholders) |
| GET | `<R>/review` | - | `GenomeCandidateReview` for Genome realizations: `candidate` and `commit` it was built for, delta, base/candidate readiness, DeltaReviews, evaluations |
| POST | `<R>/checkpoints` | secret | `{summary or message, commit?}` → `CheckpointResponse` (201) |
| POST | `<R>/submit` | secret | `{commit, previewUrl?}` → `SubmitResponse`; 201 new, 200 repeat (idempotent on realization+commit); 422 if the commit is not in the fork; 422 `genome-too-large` for a Genome over 1 MB of YAML |
| POST | `<R>/reject` | admin | `{reason}` → `RejectResponse`; realization and its open candidates become `rejected`, reason kept, `realization.updated` emitted |
| POST | `<R>/sync` | secret | re-reads the fork head and submits it if new → `SyncResponse` |
| GET | `/systems/:id/realizations` | - | `{realizations}` |
| GET | `/systems/:id/candidates` | - | `{candidates}` |
| GET | `/systems/:id/evaluations?candidate=` | - | `EvaluationsResponse` |
| GET | `/systems/:id/conflicts` | - | `ConflictsResponse` |
| POST | `/systems/:id/promote` | admin | `{candidateIds or candidates, expectedHead, rationale}` → `PromoteResponse` (with `advisories`); 409 `stale-base` `{currentHead}`, or `blocked` `{blocking, advisories}`, or `gate-unavailable`, or `invalid-state` (e.g. more than one app candidate: composition is not supported yet), or `use-accept` for a Genome candidate (Genome amendments go through accept); 400 `advisories-unacknowledged`. Promotion revokes the realization secret and write token of the promoted realization and of rejected siblings (accept does the same for the accepted one) |
| GET | `/systems/:id/history` | - | `HistoryResponse`, newest first |
| GET | `/systems/:id/events` | - | SSE, `data: {type, at, ...}` (`SseEnvelope`), `ping` every 15 s. Events are not replayed (no `id:`); refetch on connect and on every reconnect |

Promotion gate (fails closed; promote and accept): the blocking set is (the Evolution's acceptance criteria ∪ criteria gated on `promotion`) ∩ hard ∩ ≥1 hook with `binding: bound`. Blocking criteria must be pass+completed for this exact candidate; missing evidence is `unknown` and blocks. The only exception: a `not-run` row from a hook whose `triggers` contain none of `submission`, `candidate`, `promotion` (an outcome hook) is disregarded; the Worker names those hooks from the Genome, and every other non-pass row still blocks. For a Genome candidate the pool leaves out promotion-gated criteria that target the artifact (they gate app candidates); its acceptance criteria stay. Other non-passing criteria are `advisories` (400 without a rationale; recorded as `decision.acknowledged`). 409 `gate-unavailable` when the Genome or the criteria cannot be computed, or when nothing blocks and the acceptance criteria are absent or lack a completed evaluation (a `not-run` row does not count). Before the CAS, hooks re-run as the `promotion` trigger (hooks triggered only on promotion run here) with `promotionFacts` (base-current; manifest-exact: the composed System manifest binds exactly the promoted commits and each commit still hashes to its submitted manifest; evidence-fresh). Each System commit records `decision.evidenceProviders`: the distinct System One providers behind the gating evaluations (`fake` under `FAKE_S1=1`, which the UI marks "System One: fake provider").

Every `GET /systems/:id/…` (and the SSE stream) answers 404 for a System the registry does not list, before its Durable Object is touched.

`<R>` is any of `/systems/:id/evolutions/:eid/realizations/:rid` (CLI), `/systems/:id/realizations/:rid`, `/realizations/:rid` (System found via the registry; realization ids are unique only per System, so this returns 409 `ambiguous` with `details.systems` when several Systems have that id).

Hooks: the backend calls `HookRunner` (`worker/hooks/contract.ts`); `worker/hooks/index.ts` wires `createHookRunner({ s1Env: env, previewEnv: env })` and the queue consumer. The candidate tree passed to hooks carries blob sizes from a per-System cache; only files some `manifest` hook requires are measured, and any other entry not yet cached has `size: -1` (not measured). The manifest engine treats a size ≤ 0 as empty, so an unmeasured required file fails rather than passes.

## Repos and the `platform` meta repo
One Artifacts namespace per deployment (the `ARTIFACTS` binding's, `artyfact` in `wrangler.jsonc`). Names come from `@artyfact/cli/naming`: `slug` is the System id without `system.`, lower-cased, `[a-z0-9._-]`; repos `<slug>.genome` and `<slug>.app` (with several worker-fullstack artifacts, `<slug>.<artifact id without "artifact.">`); forks `<repo>--r<N>` with N System-wide. Start skips any N whose fork already exists in the namespace (left by an earlier platform state), so nothing is overwritten.

`platform` holds `templates/{system,thing}/<name>@<v>/` (a Thing's `scaffold/` seeds new app repos), `templates/rule-packs/<id>@<v>/pack.dl`, `README.md` and `manifest.json` `{version, bundleHash}`; `npx artyfact platform-sync` pushes it, and `npx artyfact init` creates it only when it is missing or empty. On import the Worker reads `platform`'s head, checks that every pinned rule pack (`kits.yaml` `rulePacks`) and every template the System uses has its directory there, and records `{repo, commit}` in the DO head; every System commit written afterwards carries it in `composition.platform`. A re-import whose only change is a new `platform` commit updates the head's recorded ref in place and writes no System commit, so open work does not go stale. Pins are checked against the canonical Genome, which after an accepted amendment is no longer the imported one. A missing pin is the import warning `platform.pin-missing`; a namespace without `platform` records `null` and shows the readiness warning `platform.unsynced`. Neither blocks. `kits.yaml` `kits` entries are labels with no files in `platform` yet and are not checked. **Evaluation still uses the template and rule-pack copies bundled into the Worker**; `platform` is provenance only.

`scaffoldFrom: {repo, commit, path?}` on import (sent by `init --from-template`) is recorded on the app's artifact binding and carried through promotions.

Left for later: cross-System dependencies. A Thing template's `scaffold.repo` may name another System's `<slug>.app`, and `init --from-template` forks it, but nothing records or tracks the dependency after that.

## Layout
- `worker/` Hono app, Queue handler, Durable Object (`do/system-authority.ts`), generated `env.d.ts`.
- `shared/api.ts` wire types shared by Worker and SPA.
- `src/` SPA; `src/theme/` whimsy theme (rules in `src/theme/README.md`).
- `test/` Worker tests; `src/**/*.test.ts` UI tests.

Amendment review panel fixtures (no backend): `npm run dev:amendment -w @artyfact/platform`, then open `http://localhost:5199/amendment-dev.html?scenario=deliberate|hard|review|fake|off|findings`. It uses its own Vite config because the Cloudflare plugin's SPA fallback hides extra html pages.
