# artyfact-ci

The Worker that builds and deploys app commits for the artyfact platform. It hosts the `artyfact-ci` Workflow (`ArtyfactCI`, built on `@cloudflare/ci`). The platform starts it through a cross-script Workflows binding (`env.CI`) whenever an app candidate is submitted or a promotion asks for a production deploy. App pushes have no trigger here. The one push listener is the public site: the `artyfact-site-deploys` queue receives pushes to `artyfact/platform.builds` main and starts `artyfact-site-deploy`, which uploads that commit's `site/dist` as `artyfact-site` ([release-artifacts.md](../../docs/design/release-artifacts.md)).

One run does this:

1. Reports `running` to `reportUrl`.
2. Reads the app's `wrangler.json` / `wrangler.jsonc` at the commit (from the Worker, not the sandbox) and checks it against an allowlist. A refused config fails the build at the `config` step with the reason.
3. Runs `install` (cached on `package.json` + `package-lock.json`), `test` and `build` in Sandbox containers. The commands come from the platform's allowlist.
4. `bundle`: the image's pinned Wrangler bundles the repo with `deploy --dry-run --outdir`, with no credentials.
5. `deploy`: the same Wrangler uploads that bundle (`no_bundle`) under `--name <workerName>`, with a unique platform `BUILD_ID`, source/Genome/Thing lineage vars, and no repository command. `ARTYFACT_INGEST_TOKEN` goes up as a Worker secret through `--secrets-file`.
6. Reports `passed` with the preview URL and, only when pinned Wrangler prints an exact Worker Version ID, its immutable version locator; otherwise output identity remains unknown.

Each report is a durable Workflow step. Reports carry `Authorization: Bearer <CI_REPORT_TOKEN>` and go only to URLs under `PLATFORM_URL`.

The pipeline logic is in `src/pipeline.ts`, the deploy half in `src/deploy-config.ts`; both are unit-tested in Node. `src/contract.ts` mirrors `CiBuildParams` / `BuildReport` from `apps/platform/shared/api.ts`.

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

**`CF_TOKEN` permissions.** Create a custom API token with `Account / Workers Scripts / Edit`, plus `Account / D1 / Edit` when apps bind D1, limited to this account. Never reuse the platform's admin token or its Artifacts token (`CF_API_TOKEN`). The token reaches the `deploy` step only; see the trust model below.

**R2 keys.** Create them in the dashboard under R2, Manage API tokens. Scope the token to the `artyfact-ci-cache` bucket with Object Read & Write.

**Vars** in `wrangler.jsonc` are as follows:

| Var | Meaning |
| --- | --- |
| `PLATFORM_URL` | Platform origin; reports to any other origin are refused. |
| `WORKERS_SUBDOMAIN` | The account's workers.dev subdomain, used to build preview URLs. |
| `BACKUP_BUCKET_NAME` | Equal to the R2 bucket name. |
| `CLOUDFLARE_ACCOUNT_ID` | Account for the Artifacts git remote and the deploy. |

**App prerequisites.** The app config must use only allowlisted keys: `main`, `compatibility_*`, `vars`, its own `durable_objects` and `migrations` (`tag`, `new_classes`, `new_sqlite_classes`, `renamed_classes` without `from_script`, `deleted_classes`), `d1_databases`, `assets`, `triggers`, `observability`, `placement`, `limits`, `workers_dev`, `preview_urls`, `keep_vars` and the bundling options `define`, `minify`, `jsx_*`, `tsconfig`. Workflows, services and bindings to existing KV, R2 or Queues are refused. D1 bindings must resolve to a database mapped to the build's System, and `CF_TOKEN` needs `D1: Edit` when an app binds D1. `wrangler.toml` is not read. The deploy config always adds `global_fetch_strictly_public` to `compatibility_flags` (Cloudflare blocks same-zone Worker-to-Worker fetch, which would stop the app reaching the platform), and `global_fetch_private_origin` is refused.

**App databases.** The platform maps each System's `database_name`s to account D1 ids through the `D1_DATABASE_IDS` var in `wrangler.jsonc`, shaped `{ "<systemId>": { "<database_name>": "<id>" } }`, so the app repo keeps the all-zero placeholder `database_id`. A build looks up only its own System. A placeholder or missing id with no mapping refuses the deploy with the database name in the message. So does a real id that is not the System's mapped id. To add one: create the database, apply the app's migrations, add it under its System in `D1_DATABASE_IDS`, then redeploy this Worker.

```sh
cf d1 create --name peopling --primary-location-hint enam
cf d1 migrations apply <id> --dir examples/peopling-app/migrations
```

## Trust model

App repos are untrusted: agents write them, and `npm install` / `npm test` run their code. The design keeps that code away from every credential, so the most a hostile commit can do is break or misuse its own preview Worker. **Preview Workers are the blast radius.**

- **Credentials only on `deploy`.** `CF_TOKEN` is a Workers Scripts: Edit token for this account, plus D1: Edit for apps that bind D1. `@cloudflare/ci` injects it as `CLOUDFLARE_API_TOKEN` into the deploy runner only. `install`, `test`, `build` and `bundle` get no Cloudflare credentials, no `ARTYFACT_INGEST_TOKEN` and no platform secrets. The Artifacts token used for checkout is never in a command's environment.
- **Nothing from the repo runs on `deploy`.** Every runner is a fresh container from this image. The image pins npm (`NPM_VERSION` in the `Dockerfile`, 12.2.0) because the base image's npm 10 crashes on exact-pinned app dependencies. The deploy step runs `/opt/artyfact/bin/wrangler` (Wrangler `4.149.0`, pinned in the `Dockerfile`) by absolute path under `env -i`, with `PATH` reset to the system directories and no `NODE_OPTIONS`, `NPM_CONFIG_*` or `.env` (`--env-file=/dev/null`, cwd outside the repo). It uploads a bundle made earlier, so esbuild never runs with the token present.
- **Platform-written config.** `--config` points at a config the Worker generated from the validated repo config, with absolute workspace paths. `build.command`, module `rules`, `alias`, `base_dir`, `containers`, file-path bindings, routes, `services`, `tail_consumers`, `workflows`, other Workers' Durable Objects, state-transferring migrations, and KV / R2 / Queues bindings are refused.
- **No reading outside the repo.** The deploy step refuses a missing bundle, any symlink in the bundle or the assets directory, and an assets directory that resolves outside `/workspace`. The bundle directory name carries a per-build random nonce, so no tracked or installed file can be planted there.
- **Commands are allowlisted.** `install`, `test` and `build` are template defaults the platform checks against `ALLOWED_COMMANDS`; this Worker checks them again.
- **Residual risks.** The ingest token travels in the Workflow instance params (`CiBuildParams.vars`), which account members with Workflows read access can see. A hostile app can still serve anything from its own preview Worker, use its own Durable Objects, and spend its own request quota. Production deploys of a promoted commit carry the same limits.

## Check without deploying

```sh
npm run typecheck -w @artyfact/ci
npm test -- --project ci
cd apps/ci && npx wrangler deploy --dry-run --containers-rollout=none --outdir /tmp/artyfact-ci
```
