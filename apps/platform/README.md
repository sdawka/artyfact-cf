# @artyfact/platform

One Cloudflare Worker with Static Assets: Hono serves `/api/*`, a React 19 SPA serves everything else.

## Run
```
npm install            # from the repo root
cp apps/platform/.dev.vars.example apps/platform/.dev.vars
npm run dev -w @artyfact/platform   # http://localhost:5173 (next free port if taken)
```
- `GET /api/health` returns the service status; `/style` is the living style sheet.
- `npm test -w @artyfact/platform` (workerd + jsdom projects), `npm run typecheck`, `npm run build`.
- `npm run cf-typegen` regenerates `worker/env.d.ts` after editing `wrangler.jsonc`.
- The `ARTIFACTS` binding is `remote: true`, so `npm run dev` needs `wrangler login`. Tests do not: they use `wrangler.test.jsonc`, the same config without that binding (keep the two in sync).
- `worker/env.d.ts` is generated; do not hand-edit it (use `cf-typegen`, secrets go in `worker/secrets.d.ts`).

## Env
Secrets (`.dev.vars`): `ADMIN_TOKEN`, `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `FAKE_S1`, `ALLOW_LOCAL_PREVIEW`. Vars live in `wrangler.jsonc`;
set `ACCOUNT_ID` (from `wrangler whoami`) in `.dev.vars` so fork remotes are `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<ns>/<repo>.git`.
The D1 `database_id` in `wrangler.jsonc` is a placeholder.

### System One provider
Without `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`, every System One judgment is `unknown`. Hard criteria judged by System One, such as `C.system.purpose`, then keep the promotion gate closed. This is by design: nothing is green without evidence. For local work set `FAKE_S1=1` in `.dev.vars`. The UI labels judgments from the fake provider.

## API
All under `/api`; errors are `{error: {code, message, details?}}`. DTOs in `shared/api.ts`. Admin = `Authorization: Bearer $ADMIN_TOKEN` (401 when missing, 403 when wrong).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/systems` | - | `SystemsResponse` (registry DO `__registry`) |
| POST | `/systems/import` | admin | `{systemId, genomeRepo, appRepo, force?}` → `ImportSystemResponse` (201); re-import from different repos/commits is 409 `already-imported` unless `force` |
| GET | `/systems/:id` | - | `SystemSummary` |
| GET | `/systems/:id/model?rev=` | - | `ModelBundle`; `rev` = `canonical` (default), `sc-…` System commit, `candidate.…`, or a Genome sha |
| GET | `/systems/:id/readiness?rev=` | - | `ReadinessResponse`: the full rules `Readiness` plus the three-state summary; `/model`'s `readiness` is the same. Both are served from the DO cache when warm |
| GET | `/systems/:id/work`, `/systems/:id/evolutions` | - | `WorkResponse` |
| GET | `/systems/:id/evolutions/:eid` | - | `Evolution` |
| POST | `/systems/:id/evolutions/:eid/realizations` | - | `{agentLabel?, target?, role?}` → `StartWorkResponse` (201); the only response carrying the fork token, also inside `startCommand` (`ARTYFACT_TOKEN=… npx artyfact start <rid> --system … --evolution … --dir …`) |
| GET | `/systems/:id/evolutions/:eid/realizations` | - | `{realizations}` |
| GET | `/systems/:id/evolutions/:eid/candidates` | - | `CandidatesResponse` |
| POST | `/systems/:id/evolutions/:eid/accept` | admin | `{realizationId, interpretation}` → `AcceptResponse` (Genome realizations; `realization` / `rationale` accepted as aliases) |
| GET | `<R>` | - | `RealizationResponse` (Realization fields at top level, plus `realization`, `candidateDetail`, `evaluations`, `conflicts`) |
| GET | `<R>/packet` | - | `PacketResponse` (no token; `startCommand` carries a `<token>` placeholder) |
| GET | `<R>/review` | - | `GenomeCandidateReview` for Genome realizations: delta, base/candidate readiness, DeltaReviews, evaluations |
| POST | `<R>/checkpoints` | - | `{summary or message, commit?}` → `CheckpointResponse` (201) |
| POST | `<R>/submit` | - | `{commit, previewUrl?}` → `SubmitResponse`; 201 new, 200 repeat (idempotent on realization+commit); 422 if the commit is not in the fork |
| POST | `<R>/reject` | admin | `{reason}` → `RejectResponse`; realization and its open candidates become `rejected`, reason kept, `realization.updated` emitted |
| POST | `<R>/sync` | - | re-reads the fork head and submits it if new → `SyncResponse` |
| GET | `/systems/:id/realizations` | - | `{realizations}` |
| GET | `/systems/:id/candidates` | - | `{candidates}` |
| GET | `/systems/:id/evaluations?candidate=` | - | `EvaluationsResponse` |
| GET | `/systems/:id/conflicts` | - | `ConflictsResponse` |
| POST | `/systems/:id/promote` | admin | `{candidateIds or candidates, expectedHead, rationale}` → `PromoteResponse` (with `advisories`); 409 `stale-base` `{currentHead}`, or `blocked` `{blocking, advisories}`, or `gate-unavailable`; 400 `advisories-unacknowledged` |
| GET | `/systems/:id/history` | - | `HistoryResponse`, newest first |
| GET | `/systems/:id/events` | - | SSE, `data: {type, at, ...}` (`SseEnvelope`), `ping` every 15 s |

Promotion gate (fails closed): the blocking set is (the Evolution's acceptance criteria ∪ criteria gated on `promotion`) ∩ hard ∩ ≥1 hook with `binding: bound`. Blocking criteria must be pass+completed for this exact candidate; missing evidence is `unknown` and blocks. Other non-passing criteria are `advisories` (400 without a rationale; recorded as `decision.acknowledged`). 409 `gate-unavailable` when the Genome or the criteria cannot be computed, or when nothing blocks and the acceptance criteria are absent or unevaluated. Before the CAS, hooks re-run with `promotionFacts` (base-current, manifest-exact, evidence-fresh).

`<R>` is any of `/systems/:id/evolutions/:eid/realizations/:rid` (CLI), `/systems/:id/realizations/:rid`, `/realizations/:rid` (System found via the registry).

Hooks: the backend calls `HookRunner` (`worker/hooks/contract.ts`); `worker/hooks/index.ts` wires the implementation (no-op until the hooks slice lands).

## Layout
- `worker/` Hono app, Queue handler, Durable Object (`do/system-authority.ts`), generated `env.d.ts`.
- `shared/api.ts` wire types shared by Worker and SPA.
- `src/` SPA; `src/theme/` whimsy theme (rules in `src/theme/README.md`).
- `test/` Worker tests; `src/**/*.test.ts` UI tests.

Amendment review panel fixtures (no backend): `npm run dev:amendment -w @artyfact/platform`, then open `http://localhost:5199/amendment-dev.html?scenario=deliberate|hard|review|fake|off|findings`. It uses its own Vite config because the Cloudflare plugin's SPA fallback hides extra html pages.
