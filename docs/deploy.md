# Deploy

One Worker (`artyfact-platform`) serves the SPA and `/api/*`. Run everything from the repo root unless noted. Use Wrangler: the project has `wrangler.jsonc` and no `cloudflare.config.ts`.

**Prerequisite:** the account must be on Workers Paid; Artifacts is unavailable on Free.

**Status:** first deploy done on 2026-10-12 at https://artyfact-platform.dawka.workers.dev. Queue, DO migration, vars and `ADMIN_TOKEN` are in place. The operator keeps the `ADMIN_TOKEN` plaintext outside the repo; rotate it with `wrangler secret put ADMIN_TOKEN`. The System import is a separate step: `./scripts/bootstrap.sh` (a wrapper over `npx artyfact init`) with `--platform $URL`, as in the runbook.

## Resources

| Resource | Name | Created by |
|---|---|---|
| Worker + static assets | `artyfact-platform` | `npm run deploy` |
| Durable Object `SystemAuthority` (SQLite) | migration in `wrangler.jsonc` `exports` | first deploy |
| Queue consumer | `artyfact-artifacts-events` | `npx wrangler queues create artyfact-artifacts-events` before the first deploy |
| Artifacts namespace `artyfact` | `platform`, `keep-in-touch.genome`, `keep-in-touch.app` repos | `artyfact init` (runbook step 2), not this doc |
| Secret `ADMIN_TOKEN` | | `wrangler secret put` |
| CI Worker `artyfact-ci` (Workflow, Sandbox container, R2 `artyfact-ci-cache`) and secret `CI_REPORT_TOKEN` | optional | [`apps/ci/README.md`](../apps/ci/README.md), see [`ci.md`](ci.md) |

There is no D1 or R2. System One needs a secret, `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` (`wrangler secret put`); without one every System One judgment is `unknown` and System One-gated hard criteria keep promotion closed. `FAKE_S1` is not a deployed var: it belongs in `.dev.vars` and test configs only.

## First deploy

1. `npx wrangler whoami`; confirm the account.
2. `npx wrangler queues create artyfact-artifacts-events`
3. Set `vars.ACCOUNT_ID` in `apps/platform/wrangler.jsonc` to the account id. Leave `PREVIEW_HOST_ALLOWLIST` empty and never set `ALLOW_LOCAL_PREVIEW`.
4. `npm run deploy`. Note the `https://artyfact-platform.<subdomain>.workers.dev` URL, put it in `vars.PUBLIC_URL`, and deploy again.
5. Secret, without echoing it: `openssl rand -hex 32 | (cd apps/platform && npx wrangler secret put ADMIN_TOKEN)`. Keep a copy in a password manager; locally it goes in `apps/platform/.dev.vars`.
6. Check: `curl -i $URL/api/health` returns 200, and the SPA loads with the fixture-mode banner until a System is imported.

## Redeploy

`npm run deploy` (builds the platform, then `wrangler deploy`). Secrets and the Queue persist.

Before deploying, confirm a System One key is set: `cd apps/platform && npx wrangler secret list` must list `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`. `wrangler deploy` replaces `vars`, and no fake is deployed, so without a key System One is off: hard System One gates stay `unknown` and intents only ask questions.

## Migrate a v1 Genome

A System whose head Genome is in the retired v1 layout (`system.yaml` at the root) answers 422 `legacy-genome` on every route that loads it, so it cannot be migrated through a realization. Convert it locally and re-import it ([ontology.md §2a](design/ontology.md)). For the prod Keep in Touch System, from the repo root:

Set the platform URL and the account id first:

```
URL=https://artyfact-platform.dawka.workers.dev
ACCOUNT_ID=<the account id from npx wrangler whoami>
```

1. Clone the v1 head of `keep-in-touch.genome` (not the example on `main`: prod may have promoted Genome amendments since) and the head of `keep-in-touch.app`, for its own `source-map.yaml`. Pass each read token through the environment, never in argv:
   ```
   for repo in keep-in-touch.genome keep-in-touch.app; do
     T=$(npx wrangler artifacts repos issue-token $repo --namespace artyfact --scope read --ttl 600 --json | jq -r .plaintext)
     GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Bearer $T" \
       git clone -q https://$ACCOUNT_ID.artifacts.cloudflare.net/git/artyfact/$repo.git /tmp/$repo
   done
   ```
2. Convert it with prod's own source map:
   ```
   npx artyfact convert-genome /tmp/keep-in-touch.genome /tmp/kit-v2 --source-map /tmp/keep-in-touch.app/source-map.yaml
   ```
   Review the tree; `node.yaml` at its root must name `system.keep-in-touch`.
3. Push the Genome only and re-import:
   ```
   ARTYFACT_ADMIN_TOKEN=... npx artyfact init --dir /tmp/kit-migrate --genome /tmp/kit-v2 --platform $URL --genome-only --adopt --force
   ```
   `--genome-only` never reads, pushes or seeds an app: `keep-in-touch.app` keeps its head, and the platform keeps its recorded scaffold source. `--adopt` commits the converted tree on top of the v1 head of the same Genome repo (a fast-forward), and `--force` re-points the System at that commit.
4. Verify: `curl -s -o /dev/null -w '%{http_code}\n' $URL/api/systems/system.keep-in-touch/model` prints `200`.

Gotchas from the 2026-10-13 run: `issue-token` fails until `npx wrangler login` has been run again for the Artifacts scope, and a 403 from `init` meant the platform's `ADMIN_TOKEN` secret had to be re-set (`npx wrangler secret put ADMIN_TOKEN`) before retrying. A second run after the Genome repo head is already v2 must skip step 2: `convert-genome` refuses a v2 tree, so clone the head and go straight to `init --genome-only --adopt --force`.

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
