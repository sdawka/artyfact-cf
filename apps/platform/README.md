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
Secrets (`.dev.vars`): `ADMIN_TOKEN`, `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `FAKE_S1`. Vars live in `wrangler.jsonc`.
The D1 `database_id` in `wrangler.jsonc` is a placeholder.

## Layout
- `worker/` Hono app, Queue handler, Durable Object (`do/system-authority.ts`), generated `env.d.ts`.
- `shared/api.ts` wire types shared by Worker and SPA.
- `src/` SPA; `src/theme/` whimsy theme (rules in `src/theme/README.md`).
- `test/` Worker tests; `src/**/*.test.ts` UI tests.

Amendment review panel fixtures (no backend): `npm run dev:amendment -w @artyfact/platform`, then open `http://localhost:5199/amendment-dev.html?scenario=deliberate|hard|review|fake|off|findings`. It uses its own Vite config because the Cloudflare plugin's SPA fallback hides extra html pages.
