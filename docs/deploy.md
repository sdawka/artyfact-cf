# Deploy

One Worker (`artyfact-platform`) serves the SPA and `/api/*`. Run everything from the repo root unless noted. Use Wrangler: the project has `wrangler.jsonc` and no `cloudflare.config.ts`.

**Prerequisite:** the account must be on Workers Paid; Artifacts is unavailable on Free.

**Status:** first deploy done on 2026-10-12 at https://artyfact-platform.dawka.workers.dev. Queue, DO migration, vars and `ADMIN_TOKEN` are in place. The operator keeps the `ADMIN_TOKEN` plaintext outside the repo; rotate it with `wrangler secret put ADMIN_TOKEN`. The System import is a separate step.

## Resources

| Resource | Name | Created by |
|---|---|---|
| Worker + static assets | `artyfact-platform` | `npm run deploy` |
| Durable Object `SystemAuthority` (SQLite) | migration in `wrangler.jsonc` `exports` | first deploy |
| Queue consumer | `artyfact-artifacts-events` | `npx wrangler queues create artyfact-artifacts-events` before the first deploy |
| Artifacts namespace `artyfact` | `keep-in-touch.genome`, `keep-in-touch.app` repos | the import runbook, not this doc |
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

Checked against the Cloudflare docs on 2026-10-12.

- **Artifacts** needs the Workers Paid plan; there is no Free-plan tier. Billing starts 14 Oct 2026. Paid includes the first 10,000 operations and 1 GB-month per month, then $0.15 per extra 1,000 operations and $0.50 per extra GB-month. Two demo repos stay inside the included amounts.
- **Durable Objects** (SQLite) are available on Free and Paid. Paid includes 25 billion row reads, 50 million row writes and 5 GB of storage per month.
- **Queues** pricing was not checked; confirm the plan allowance before relying on the consumer.
- Static assets and Worker requests fall under normal Workers pricing. Observability logs count against the logs allowance.
