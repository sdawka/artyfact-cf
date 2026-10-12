# artyfact-ci

The Worker that builds and deploys app commits for the artyfact platform. It hosts the `artyfact-ci` Workflow (`ArtyfactCI`, built on `@cloudflare/ci`). The platform starts it through a cross-script Workflows binding (`env.CI`) whenever an app candidate is submitted or a promotion asks for a production deploy. Nothing here listens for pushes.

One run does this:

1. Reports `running` to `reportUrl`.
2. Runs `install` (cached on `package.json` + `package-lock.json`), `test`, `build` and `deploy` in Sandbox containers.
3. Deploys with `wrangler deploy --name <workerName> --var BUILD_ID:<commit> --var ARTYFACT_…`. Only the deploy step gets Cloudflare credentials.
4. Reports `passed` with `https://<workerName>.<WORKERS_SUBDOMAIN>.workers.dev`, or `failed` / `error` with the failing step.

Each report is a durable Workflow step. Reports carry `Authorization: Bearer <CI_REPORT_TOKEN>` and go only to URLs under `PLATFORM_URL`.

The pipeline logic is in `src/pipeline.ts` and is unit-tested in Node. `src/contract.ts` mirrors `CiBuildParams` / `BuildReport` from `apps/platform/shared/api.ts`.

## Deploy

This needs Docker running locally (the Sandbox container image is built at deploy time). Run from the repo root unless noted.

```sh
# 1. Cache bucket (name must match wrangler.jsonc r2_buckets[].bucket_name and BACKUP_BUCKET_NAME)
npx wrangler r2 bucket create artyfact-ci-cache

# 2. Secrets for this Worker (run in apps/ci)
cd apps/ci
openssl rand -hex 32                      # use this value as CI_REPORT_TOKEN here and on the platform
npx wrangler secret put CI_REPORT_TOKEN
npx wrangler secret put CF_TOKEN          # API token for `wrangler deploy` of app Workers (see below)
npx wrangler secret put R2_ACCESS_KEY_ID  # R2 API token scoped to artyfact-ci-cache, Object Read & Write
npx wrangler secret put R2_SECRET_ACCESS_KEY

# 3. Deploy the CI Worker (builds and pushes the container image)
npm run deploy

# 4. Platform side (run in apps/platform): same CI_REPORT_TOKEN, then redeploy with the `CI` workflows binding
npx wrangler secret put CI_REPORT_TOKEN
cd ../.. && npm run deploy
```

**`CF_TOKEN` permissions.** Start from the "Edit Cloudflare Workers" template and add `D1: Edit` when the app binds D1. The token is injected into the deploy step only. Test and build commands never see it.

**R2 keys.** Create them in the dashboard under R2, Manage API tokens. Scope the token to the `artyfact-ci-cache` bucket with Object Read & Write.

**Vars** in `wrangler.jsonc` are as follows:

| Var | Meaning |
| --- | --- |
| `PLATFORM_URL` | Platform origin; reports to any other origin are refused. |
| `WORKERS_SUBDOMAIN` | The account's workers.dev subdomain, used to build preview URLs. |
| `BACKUP_BUCKET_NAME` | Equal to the R2 bucket name. |
| `CLOUDFLARE_ACCOUNT_ID` | Account for the Artifacts git remote and the deploy. |

**App prerequisites.** The app's own `wrangler.jsonc` must deploy as-is. For example, a D1 binding needs a real `database_id`, not the scaffold's all-zero placeholder. Otherwise every deploy step fails, and the platform records the build as `failed`.

## Check without deploying

```sh
npm run typecheck -w @artyfact/ci
npm test -- --project ci
cd apps/ci && npx wrangler deploy --dry-run --containers-rollout=none --outdir /tmp/artyfact-ci
```
