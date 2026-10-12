# CI, builds and deployments

Every app candidate gets a build record. When a preview build passes with a URL, the candidate stores that URL and its hooks run again. That is how `C.webapp.health` checks the deployed app's `/health` against `BUILD_ID=<commit>`. Promotions ask for a production deployment. The System's deployed version is its latest `live` production deployment.

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

- `BUILD_ID` is the commit.
- `ARTYFACT_PLATFORM_URL`, `ARTYFACT_SYSTEM_ID`, `ARTYFACT_THING_ID` and `ARTYFACT_ARTIFACT_ID` identify the app.
- `ARTYFACT_DEPLOYMENT_ID` and `ARTYFACT_INGEST_TOKEN` identify the deployment for Phenome events.
- `ARTYFACT_REALIZATION_ID` is set on previews and `ARTYFACT_SYSTEM_COMMIT` on production.

Each deployment gets its own ingest token. The platform stores only its SHA-256. The token travels to CI in the Workflow params and ends up as a plain var on the app Worker.

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
| `POST`, `GET /api/systems/:id/realizations/:rid/builds` | `CI_REPORT_TOKEN`, admin, or the realization secret. An agent may report previews only. |
| `GET /api/systems/:id/builds?commit=&kind=&realization=` | public |
| `POST /api/systems/:id/builds` (production reports) | `CI_REPORT_TOKEN` or admin |
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
