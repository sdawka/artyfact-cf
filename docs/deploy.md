# Deploy

One Worker (`artyfact-platform`) serves the SPA and `/api/*`. Run everything from the repo root unless noted. Use Wrangler: the project has `wrangler.jsonc` and no `cloudflare.config.ts`.

**Prerequisite:** the account must be on Workers Paid; Artifacts is unavailable on Free.

**Status:** intention fixes are deployed from merged `1ec3826de3bd3a24ff4ac7eddb061ae8f0c56888`: platform [artyfact-platform](https://artyfact-platform.dawka.workers.dev), Worker version `39aba8f8-dd0d-4810-b6a6-5feb373fa6c0`; public site [artyfact.ing](https://artyfact.ing), version `a5b7ff36-c033-4420-b9c6-49ce6518b300`. Production credentials remain in Keychain. Protected reads and desktop/mobile smoke passed; see [release evidence](grreat/journals/2026-10-14-intention-fixes.md). System import remains a separate step using `./scripts/bootstrap.sh` (a wrapper over `npx artyfact init`) with `--platform $URL`.

## Resources

| Resource | Name | Created by |
|---|---|---|
| Worker + static assets | `artyfact-platform` | `npm run deploy` |
| Durable Object `SystemAuthority` (SQLite) | migration in `wrangler.jsonc` `exports` | first deploy |
| Queue consumer | `artyfact-artifacts-events` | `npx wrangler queues create artyfact-artifacts-events` before the first deploy |
| Artifacts namespace `artyfact` | `platform`, `peopling.genome`, `peopling.app` repos | `artyfact init` (runbook step 2), not this doc |
| Secret `ADMIN_TOKEN` | | `wrangler secret put` |
| R2 bucket `artyfact-evidence` (binding `EVIDENCE`) | screenshots for visual checks | `npx wrangler r2 bucket create artyfact-evidence` before the first deploy |
| Workers AI (binding `AI`) and Browser Run (binding `BROWSER`) | Clef judgments and preview captures, local runs only | none: `npm run dev` adds both; the deployed hosted demo has neither |
| CI Worker `artyfact-ci` (Workflow, Sandbox container, R2 `artyfact-ci-cache`) and secret `CI_REPORT_TOKEN` | optional | [`apps/ci/README.md`](../apps/ci/README.md), see [`ci.md`](ci.md) |

There is no D1. R2 holds only evidence images. The deployed Worker is the hosted demo (`HOSTED_DEMO=1` in `wrangler.jsonc`): System One, visual checks, intent translation and plan drafting are simulated, and no model key or binding is read, so a hosted run spends nothing on models. To judge with Clef or Jev, run the platform locally (`npm run dev`) on your own account with keys in `.dev.vars`; see the platform README for `S1_PROVIDER`. `FAKE_S1` is not a deployed var: it belongs in `.dev.vars` and test configs only.

## First deploy

1. `npx wrangler whoami`; confirm the account.
2. `npx wrangler queues create artyfact-artifacts-events` and `npx wrangler r2 bucket create artyfact-evidence`
3. Set `vars.ACCOUNT_ID` in `apps/platform/wrangler.jsonc` to the account id. Leave `PREVIEW_HOST_ALLOWLIST` empty and never set `ALLOW_LOCAL_PREVIEW`.
4. `npm run deploy`. Note the `https://artyfact-platform.<subdomain>.workers.dev` URL, put it in `vars.PUBLIC_URL`, and deploy again.
5. Configure `ADMIN_TOKEN` using the saved-token procedure below. Keep production and local `.dev.vars` tokens separate; never generate a token directly into the upload pipe.
6. Check: `curl -i $URL/api/health` returns 200, and the SPA loads with the fixture-mode banner until a System is imported.

## Redeploy

`npm run deploy` (builds the platform, then `wrangler deploy`). Secrets and the Queue persist.

The deployed build keeps `wrangler.jsonc` as is: `HOSTED_DEMO=1`, no `AI` or `BROWSER`, and no model secrets needed. A self-hosted Worker that should judge for real removes `HOSTED_DEMO` and adds `"ai": { "binding": "AI" }` and `"browser": { "binding": "BROWSER" }` before deploying; then `S1_PROVIDER` and the keys apply as locally. `wrangler deploy` replaces `vars`.

## Production admin token

Cloudflare's `ADMIN_TOKEN`, the CLI's `ARTYFACT_ADMIN_TOKEN`, local `.dev.vars` and the browser's saved token are separate stores. Production commands must retrieve the verified canonical credential into an unexported variable and map it to `ARTYFACT_ADMIN_TOKEN` for that command only ([runbook](demo-runbook.md)). Replace the browser's independently saved token after rotation and verify a protected read; “saved” confirms storage, not authentication. Public health/model reads do not validate admin authentication.

Rotate through the operator's credential manager:

1. Reuse an existing pending replacement on retries. Otherwise generate once and securely save it as pending **before** changing Cloudflare. Keep the current canonical credential until verification succeeds.
2. Retrieve the saved pending bytes and upload those same bytes through stdin to `ADMIN_TOKEN` for Worker `artyfact-platform`, Cloudflare account `1bae12d5089e4c2ee5c0e62c021a117f`, using the `apps/platform` Wrangler configuration. If save or upload fails, stop; retain the pending credential for diagnosis.
3. Verify GET `https://artyfact-platform.dawka.workers.dev/api/systems/system.peopling/parts`. Retry initial 403 responses with the same saved credential, for example at most six attempts five seconds apart; stop on 200 or a different status. Do not generate or upload another token merely because activation initially returns 403.
4. Only after 200, promote the same pending bytes to canonical in the credential manager, then remove the pending entry. A failed check leaves both entries intact.

### macOS operator store

Production uses Keychain service `artyfact-platform.production`, account `1bae12d5089e4c2ee5c0e62c021a117f|artyfact-platform|https://artyfact-platform.dawka.workers.dev`. Pending replacements use the **same service** and the account with `|pending` appended. Save/promote through Keychain Access or the operator's secure credential manager; do not pass credential values in process arguments.

For a routine protected read, retrieve canonical into an unexported variable and send the header through stdin. During rotation, append `|pending` to the account to verify the saved replacement instead. Disable shell tracing; never print credentials or store them in profiles or agent shells.

```sh
set +x
unset production_admin_token
if production_admin_token=$(security find-generic-password -s artyfact-platform.production \
  -a '1bae12d5089e4c2ee5c0e62c021a117f|artyfact-platform|https://artyfact-platform.dawka.workers.dev' -w); then
  printf 'Authorization: Bearer %s\n' "$production_admin_token" | \
    curl -sS -o /dev/null -w '%{http_code}\n' -H @- \
      https://artyfact-platform.dawka.workers.dev/api/systems/system.peopling/parts
fi
unset production_admin_token
```

On 2026-10-14, the replacement credential initially returned 403 on the protected read after secret activation at 12:19:33Z, then 200 without another upload; it also returned 200 after deployment. No exact propagation duration is established.

## Migrate a v1 Genome

A System whose head Genome is in the retired v1 layout (`system.yaml` at the root) answers 422 `legacy-genome` on every route that loads it, so it cannot be migrated through a realization. Convert it locally and re-import it ([ontology.md §2a](design/ontology.md)). For the prod Peopling System, from the repo root:

Set the platform URL and the account id first:

```
URL=https://artyfact-platform.dawka.workers.dev
ACCOUNT_ID=<the account id from npx wrangler whoami>
```

1. Clone the v1 head of `peopling.genome` (not the example on `main`: prod may have promoted Genome amendments since) and the head of `peopling.app`, for its own `source-map.yaml`. Pass each read token through the environment, never in argv:
   ```
   for repo in peopling.genome peopling.app; do
     T=$(npx wrangler artifacts repos issue-token $repo --namespace artyfact --scope read --ttl 600 --json | jq -r .plaintext)
     GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Bearer $T" \
       git clone -q https://$ACCOUNT_ID.artifacts.cloudflare.net/git/artyfact/$repo.git /tmp/$repo
   done
   ```
2. Convert it with prod's own source map:
   ```
   npx artyfact convert-genome /tmp/peopling.genome /tmp/peopling-v2 --source-map /tmp/peopling.app/source-map.yaml
   ```
   Review the tree; `node.yaml` at its root must name `system.peopling`.
3. Push the Genome only and re-import:
   ```
   ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact init --dir /tmp/peopling-migrate --genome /tmp/peopling-v2 --platform $URL --genome-only --adopt --force
   ```
   `--genome-only` never reads, pushes or seeds an app: `peopling.app` keeps its head, and the platform keeps its recorded scaffold source. `--adopt` commits the converted tree on top of the v1 head of the same Genome repo (a fast-forward), and `--force` re-points the System at that commit.
4. Verify: `curl -s -o /dev/null -w '%{http_code}\n' $URL/api/systems/system.peopling/model` prints `200`.

Gotchas from the 2026-10-13 run: `issue-token` fails until `npx wrangler login` has been run again for the Artifacts scope, and a 403 from `init` required checking the token source and platform secret. Use the saved-token procedure above; a newly activated secret can initially return 403, so verify with bounded retries before considering another upload. A second run after the Genome repo head is already v2 must skip step 2: `convert-genome` refuses a v2 tree, so clone the head and go straight to `init --genome-only --adopt --force`.

## Remove a System

After re-importing under a new id (the Keep in Touch to Peopling rename, for instance), the old System still sits in the registry. `DELETE /api/systems/:id` is admin only: it drops the registry row (so `GET /api/systems` and every `/api/systems/:id` route stop seeing it) and wipes the System's Durable Object; `stateCleared: false` in the response means the row went but the wipe failed, which leaves the object idle with stale state: retry the DELETE, or re-import with `force`. The registry's fork index is dropped; Artifacts repos, forks and push subscriptions are not, so remove or keep those by hand.

```
printf 'Authorization: Bearer %s\n' "$ADMIN_TOKEN" | \
  curl -s -X DELETE "$URL/api/systems/system.keep-in-touch" -H @-
```

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
