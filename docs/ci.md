# CI, builds and deployments

Every app candidate gets a build record. When a preview build passes with a URL, the candidate stores that URL and its hooks run again. That is how `C.webapp.health` checks the deployed app's `/health` against the exact runtime build identity recorded by the passed CI build (legacy reports without that identity retain commit-prefix matching). workers.dev keeps serving the previous version for a moment after a deploy, so a healthy response with the wrong build id is retried after 1 s, 2 s and 4 s (within the hook's timeout) before it fails. An admin can re-run a candidate's checks with `POST /api/systems/:id/candidates/:cid/evaluate` (Work → candidate review → Re-run checks). Promotions ask for a production deployment. The System's deployed version is its latest `live` production deployment.

## Flow

| When | What happens |
| --- | --- |
| Start work | The fork gets a repo-level `pushed` event subscription delivering to `artyfact-artifacts-events`. This only feeds the queue safety net and needs `CF_API_TOKEN` and `EVENTS_QUEUE_ID`. Reject and promotion remove it. |
| Submit of a new app candidate (CLI, editor, queue) | The build `build.<rid>.<commit7>.ci` is created as `queued`, with a `pending` preview deployment. `env.CI.create()` starts the `artyfact-ci` Workflow for the fork commit, deploying Worker `<slug>-app-r<N>`. |
| CI reports | `running`, then `passed` with `https://<worker>.<WORKERS_SUBDOMAIN>.workers.dev`, or `failed` / `error`. A passed preview re-enters `submit(…, {commit, previewUrl}, "ci")` and its deployment goes `live`. |
| Promote | A `pending` production deployment of the promoted app binding is recorded. With CI, the build `build.deployment.<n>` deploys Worker `<slug>-app`. Its passed report sets the deployment `live` and supersedes the previous live one. |
| No CI | Nothing is dispatched. The agent reports its own preview with `npx artyfact build-report --status passed --url <preview>`. An admin records production with `POST …/deployments`. |

The platform dispatches CI itself. Repo-level subscriptions need `namespace` + `repo_name`, so one subscription cannot cover every fork. `env.CI` is optional: local dev and tests have no binding, and submit and promote never fail because CI is missing or broken. A Workflow that cannot start leaves an `error` build and a `failed` deployment.

Deployed app vars come from `wrangler deploy --var`:

- `BUILD_ID` is the unique platform build row ID; `ARTYFACT_SOURCE_COMMIT` is the source commit. `ARTYFACT_GENOME_COMMIT`, `ARTYFACT_THING_ID`, and `ARTYFACT_ARTIFACT_ID` retain separate lineage when known.
- `ARTYFACT_PLATFORM_URL`, `ARTYFACT_SYSTEM_ID`, `ARTYFACT_THING_ID` and `ARTYFACT_ARTIFACT_ID` identify the app.
- `ARTYFACT_DEPLOYMENT_ID` identifies the deployment for Phenome events.
- `ARTYFACT_REALIZATION_ID` is set on previews and `ARTYFACT_SYSTEM_COMMIT` on production.

`ARTYFACT_INGEST_TOKEN` is a credential, so it is never a `--var`. The deploy step uploads it as a Worker secret with `--secrets-file`. Each deployment gets its own ingest token, and the platform stores only its SHA-256. The token travels to CI in the Workflow params. The CI Worker treats the names in `SECRET_VARS` (`apps/ci/src/deploy-config.ts`) as secrets.

Build commands come from the app template's `scaffold.yaml` and must be in `ALLOWED_COMMANDS` (`worker/deployments.ts`): `npm install` or `npm ci`, `npm test` or `npm run test`, `npm run build`. Anything else leaves an `error` build and starts nothing. The request body and the app repo never supply commands.

## Records

`builds` and `deployments` live in the System's Durable Object (`worker/do/builds-store.ts`).

- **Builds.** Upserts are idempotent. A late `queued` or `running` report never replaces `passed`, `failed` or `error`. A report without an `id` gets `build.<rid|sys>.<commit7>.<reporter>`.
- **Deployments.** A deployment goes from `pending` to `live` or `failed`, and later to `superseded`. Production supersedes production. A preview supersedes the previous preview of the same realization.

`SystemSummary` carries `latestBuild`, `deployment {production, previews}` and `deployState`. The deploy state is one of these:

| `deployState` | Meaning |
| --- | --- |
| `live` | Production is live on the head's app commit. |
| `pending` / `failed` | The newest production deployment of that commit is pending or failed. |
| `behind` | Production is live on an older commit. |
| `none` | There is no production deployment. |

Candidates carry `build`, the latest build of their commit.

## Routes

| Route | Auth |
| --- | --- |
| `GET /api/systems/:id/realizations/:rid/builds` | public |
| `POST /api/systems/:id/realizations/:rid/builds` | `CI_REPORT_TOKEN`, admin, or the realization secret. An agent may report previews only, for a commit that is one of the realization's candidates or its fork head. |
| `GET /api/systems/:id/builds?commit=&kind=&realization=` | public |
| `POST /api/systems/:id/builds` (production reports) | `CI_REPORT_TOKEN` or admin. A `passed` report without `deploymentId` must be for the head's app commit or a commit with a pending production deployment; otherwise `409 not-promoted`. |
| `GET /api/systems/:id/deployments` → `{production, history}` | public |
| `POST /api/systems/:id/deployments` `{kind?, commit?, realization?, url?}` | admin. It records a deployment made outside CI as `live` and returns `ingestToken` once. |
| `POST /api/systems/:id/deployments/:did/ingest-token` | admin. It rotates the token; the old one stops working. |

## Configuration

**Platform** (`apps/platform`):

- The `CI` workflows binding to script `artyfact-ci` is in `wrangler.jsonc`.
- `WORKERS_SUBDOMAIN` is a var.
- Secrets: `CI_REPORT_TOKEN`, plus `CF_API_TOKEN` and `EVENTS_QUEUE_ID` for subscriptions.
- `PUBLIC_URL` is where CI posts its reports.

**CI Worker** (`apps/ci`): deploy steps, secrets and the R2 bucket are in [`apps/ci/README.md`](../apps/ci/README.md). Deploy `artyfact-ci` before redeploying the platform, so the `CI` binding has a target.

**App databases.** App repos never carry a real D1 id. They commit the all-zero placeholder `database_id`, and the CI Worker resolves it through its `D1_DATABASE_IDS` var in `apps/ci/wrangler.jsonc`, shaped `{ "<systemId>": { "<database_name>": "<id>" } }`. Only the build's own System is consulted, so an app cannot bind another System's database by name. A real `database_id` in the repo is accepted only when it equals that System's mapped id. Any other D1 entry refuses the deploy. To add an app database, create it in the account, apply the app's migrations, add it under its System in `D1_DATABASE_IDS` and redeploy `artyfact-ci`.

Container, R2 and preview Worker costs, and the caps on them, are in [costs.md](costs.md), which also lists the app databases.

## Trust model

App repos are untrusted. Agents write them, and the install and test steps run their code. CI keeps that code away from every credential, so a hostile commit can at most break or misuse its own app Worker. **Preview Workers are the blast radius**, plus the production app Worker once a commit is promoted.

- **One narrow credential, one step.** The CI Worker's `CF_TOKEN` has `Workers Scripts: Edit` on this account, plus `D1: Edit` when apps bind D1. It is never the platform admin token or the Artifacts token (`CF_API_TOKEN`). Only the deploy step receives it. Install, test, build and bundle get no Cloudflare credentials, no `ARTYFACT_INGEST_TOKEN` and no platform secrets.
- **Nothing from the repo runs with the token.** The deploy step runs a Wrangler pinned in the CI image (`/opt/artyfact/bin/wrangler`, version in `apps/ci/Dockerfile`) by absolute path, under `env -i` with a system-only `PATH`, no `NODE_OPTIONS` / `NPM_CONFIG_*`, and no `.env`. It uploads a bundle made by a credential-free step, so esbuild never runs where it could read the token.
- **Platform-written Wrangler config.** The CI Worker reads the repo's `wrangler.json(c)` at the commit and keeps only allowlisted, self-contained keys. `build.command` fails the build with an explicit reason. So do module rules, aliases, containers, routes, service bindings, Workflows, other Workers' Durable Objects, Durable Object migrations that transfer state (`transferred_classes`, `from_script`), and bindings to existing KV, R2 or Queues. D1 bindings resolve only to databases the platform maps to the build's System in `D1_DATABASE_IDS`, so a repo cannot bind another System's database or an arbitrary account database. The generated config always carries the `global_fetch_strictly_public` compatibility flag, because Cloudflare blocks Worker-to-Worker `fetch()` on the shared workers.dev zone and the app could not otherwise reach the platform; a repo that lists `global_fetch_private_origin` is refused.
- **No reads outside the repo.** The deploy step refuses symlinks in the bundle or assets, and an assets directory resolving outside the workspace.
- **Allowlisted commands.** See above; the CI Worker re-checks them.
- **Residual risk.** The ingest token is visible in Workflow instance params to account members who can read Workflows.

## Tests in CI

Hosted CI (`.github/workflows/ci.yml`) runs one `setup` job that installs and decides which jobs the changes need, then `unit` (typecheck, Vitest, platform build), `e2e-fixture`, `e2e-fake` and `site` in parallel, and a final `ci` job that is the single required status. Each job runs `node scripts/ci.mjs --job <name>`. The pre-push hook runs only `npm run ci -- --fast`: typecheck and unit tests of the changed workspaces with two workers, nothing for docs-only pushes, no browser suites. `CI_LOCAL=full git push` runs every job locally instead.

`npm run ci` runs the fixture Playwright suite and then the fake-platform suite (`npm run e2e:fake -w @artyfact/platform`). The fake suite boots `vite --port 1339` with `FAKE_ARTIFACTS=1`, so it needs no Cloudflare login, only the `git` that every runner has. `apps/platform/e2e/iteration2.live.spec.ts` needs a deployment: run it with `ARTYFACT_E2E_LIVE=1 ARTYFACT_ADMIN_TOKEN=… npm run e2e:live -w @artyfact/platform`, plus `ARTYFACT_CI=1` when `artyfact-ci` is deployed so it also waits for a preview build.
