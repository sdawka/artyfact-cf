# Deploy

One Worker (`artyfact-platform`) serves the SPA and `/api/*`. Run everything from the repo root unless noted. Use Wrangler: the project has `wrangler.jsonc` and no `cloudflare.config.ts`.

## Resources

| Resource | Name | Created by |
|---|---|---|
| Worker + static assets | `artyfact-platform` | `npm run deploy` |
| Durable Object `SystemAuthority` (SQLite) | migration in `wrangler.jsonc` `exports` | first deploy |
| Queue consumer | `artyfact-artifacts-events` | `npx wrangler queues create artyfact-artifacts-events` before the first deploy |
| Artifacts namespace `artyfact` | `kit-system`, `kit-app` repos | the import runbook, not this doc |
| Secret `ADMIN_TOKEN` | | `wrangler secret put` |

There is no D1 or R2. `FAKE_S1=1` is a plain var because no System One key is set; the UI labels those judgments as fake.

## First deploy

1. `npx wrangler whoami`; confirm the account.
2. `npx wrangler queues create artyfact-artifacts-events`
3. Set `vars.ACCOUNT_ID` in `apps/platform/wrangler.jsonc` to the account id. Leave `PREVIEW_HOST_ALLOWLIST` empty and never set `ALLOW_LOCAL_PREVIEW`.
4. `npm run deploy`. Note the `https://artyfact-platform.<subdomain>.workers.dev` URL, put it in `vars.PUBLIC_URL`, and deploy again.
5. Secret, without echoing it: `openssl rand -hex 32 | (cd apps/platform && npx wrangler secret put ADMIN_TOKEN)`. Keep a copy in a password manager; locally it goes in `apps/platform/.dev.vars`.
6. Check: `curl -i $URL/api/health` returns 200, and the SPA loads with the fixture-mode banner until a System is imported.

## Redeploy

`npm run deploy` (builds the platform, then `wrangler deploy`). Secrets and the Queue persist.

## Rollback

```
cd apps/platform
npx wrangler versions list
npx wrangler rollback <version-id>
```
Durable Object migrations are not rolled back; only add migrations, never edit applied ones.

## Cost

- Workers Free covers static assets and light API traffic; Queues and Durable Objects (SQLite) have free allowances on the Free plan, but Queues and DOs may need Workers Paid for sustained use.
- Artifacts is billed from 14-15 Oct 2026 (beta pricing ends); check the Artifacts pricing page for the free tier before importing, and keep the number of repos to the two demo repos.
- Observability logs are enabled; they count against the logs allowance.
