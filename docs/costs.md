# Cloudflare costs and guardrails

Everything artyfact runs on one Cloudflare account on the Workers Paid plan. Prices below were read from the Cloudflare pricing pages on 2026-10-12 and change; recheck before relying on a number. The account listing was taken the same day with `cf`.

## 1. Resource inventory

| Resource | Defined in | In the account today |
| --- | --- | --- |
| Platform Worker `artyfact-platform` (SPA assets, API) | `apps/platform/wrangler.jsonc` | Yes |
| `SystemAuthority` Durable Object namespace (SQLite). One object per System, plus the registry object | `apps/platform/wrangler.jsonc` (`exports`) | Yes (`artyfact-platform_SystemAuthority`) |
| Queue `artyfact-artifacts-events` (platform consumer, repo `pushed` events) | `apps/platform/wrangler.jsonc` (`queues`); created by hand | Yes. `artyfact-dlq`, `artyfact-events`, `artyfact-jobs` also exist and no config here references them |
| Artifacts namespace `artyfact`: `<system>.genome`, `<system>.app`, a fork per realization (`<repo>--r<N>`) | `ARTIFACTS_NAMESPACE` var, created by the platform at runtime | Yes, 16 repos (keep-in-touch and kit systems with forks `--r1` to `--r6`). Namespaces `artyfact-test` and `artyfact-shots` also exist |
| CI Worker `artyfact-ci` | `apps/ci/wrangler.jsonc` | **No, not deployed** |
| `CiSandbox` container application (`standard-4`, `max_instances` 2) and its Durable Object namespace | `apps/ci/wrangler.jsonc` (`containers`, `exports`) | **No** |
| Workflow `artyfact-ci` (`ArtyfactCI`) | `apps/ci/wrangler.jsonc` (`workflows`), bound from the platform by `script_name` | **No** |
| R2 bucket `artyfact-ci-cache` (install cache and workspace snapshots) | `apps/ci/wrangler.jsonc` (`r2_buckets`); `npx wrangler r2 bucket create` | **No** |
| D1 `keep-in-touch` (id: see [ci.md](ci.md)) | Created by a parallel task; bound by the example app | Not checked, created elsewhere. An unrelated `artyfact-db` exists |
| Preview Workers `<slug>-app-r<N>`, one per realization (redeploys overwrite the same name) | Named in `worker/deployments.ts` (`previewWorkerName`); deployed by CI | **None yet** (the CI Worker is not deployed) |
| Production app Worker `<slug>-app` | Same, on promotion | None yet |
| Marketing site Worker `artyfact-site` | `apps/site` | Yes |

The account holds 63 Workers. The Workers Paid limit is 500 per account, so previews that are never deleted will hit that limit.

## 2. Unit costs and included tiers

All tiers are the Workers Paid ones, per account per month.

| Product | Included | Beyond included | Page |
| --- | --- | --- | --- |
| Workers | $5 base; 10 M requests; 30 M CPU ms | $0.30 per M requests; $0.02 per M CPU ms | https://developers.cloudflare.com/workers/platform/pricing/ |
| Workers Logs | 20 M events; 7 days retention | $0.60 per M events | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ |
| Durable Objects compute | 1 M requests; 400 k GB-s | $0.15 per M requests; $12.50 per M GB-s | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| Durable Objects SQLite | 25 B rows read; 50 M rows written; 5 GB stored | $0.001 per M read; $1.00 per M written; $0.20 per GB-month | same page |
| D1 | 25 B rows read; 50 M rows written; 5 GB | $0.001 per M read; $1.00 per M written; $0.75 per GB-month | https://developers.cloudflare.com/d1/platform/pricing/ |
| R2 Standard | 10 GB-month; 1 M class A; 10 M class B | $0.015 per GB-month; $4.50 per M class A; $0.36 per M class B; egress free | https://developers.cloudflare.com/r2/pricing/ |
| Queues | 1 M operations; one operation per 64 KB written, read or deleted (about 3 per message) | $0.40 per M | https://developers.cloudflare.com/queues/platform/pricing/ |
| Workflows | 10 M requests; 30 M CPU ms; 500 k steps; 1 GB-month; 30 day retention | $0.80 per 100 k steps; $0.20 per GB-month | https://developers.cloudflare.com/workflows/reference/pricing/ |
| Containers | 375 vCPU-minutes; 25 GiB-hours memory; 200 GB-hours disk | $0.000020 per vCPU-s; $0.0000025 per GiB-s; $0.00000007 per GB-s disk; billed per 10 ms while running | https://developers.cloudflare.com/containers/pricing/ |
| Artifacts (beta, billing starts 2026-10-14) | 10 k operations; 1 GB-month | $0.15 per 1 k operations; $0.50 per GB-month | https://developers.cloudflare.com/artifacts/platform/pricing/ |

Container instance prices follow from the Containers rates. The free allowance covers about 94 minutes of `standard-4` a month, bound by vCPU.

| Instance | vCPU / memory / disk | Per hour | Per minute |
| --- | --- | --- | --- |
| `standard-4` (now) | 4 / 12 GiB / 20 GB | $0.401 | $0.0067 |
| `standard-2` | 1 / 6 GiB / 12 GB | $0.129 | $0.0021 |

An operation in the Artifacts pricing is not defined on the page. Treat clones, fetches, pushes, token mints and repo create or delete as operations until measured.

## 3. Consumption model

Assumptions, not measurements. Replace them with real numbers from section 5 after the first test round.

| | Test round | Demo week |
| --- | --- | --- |
| Systems / realizations | 3 / 10 | 5 / 25 |
| Builds (preview plus production) | 60 | 150 |
| Container time per build | 5 min (install 2, test 0.5, build 1, bundle 0.5, deploy 0.5; a cached install is about 0.5) | 5 min |
| Platform requests per day | 5 k | 50 k |
| Concurrent SSE streams | few, 5 min cap each | up to 50 |
| Phenome events | 20 k total | 100 k total |
| Preview Workers | 10 | 25 |
| DO storage | under 100 MB | under 500 MB |
| R2 cache | 1.5 GB (5 lockfiles at about 300 MB) | 3 GB |
| Artifacts operations | about 3 k | about 10 k |

Monthly estimate at the test round load:

| Product | Usage | Cost |
| --- | --- | --- |
| Containers, `standard-4` | 300 min, 94 min free | $1.4 |
| Workers, DO, D1, Queues, Workflows, Logs | all inside included tiers | $0 |
| R2 | 1.5 GB | $0 |
| Artifacts | about 3 k ops, under 1 GB | $0 |
| **Incremental** | | **about $1.5 per month**, plus the $5 Workers Paid base the account already carries |

A demo week at 150 builds costs about $4.4 for containers, with every other line still at $0.

### What blows up

| Driver | Why | Bound |
| --- | --- | --- |
| Container vCPU-seconds | Every submit and every promotion runs five steps on `standard-4`. A looping agent that resubmits pays $0.033 per build. A hung runner bills until it stops. | Worst case is `max_instances` x $9.62 per day. It was 5 x ($48 per day) and is now 2 ($19 per day). |
| Preview Worker count | One Worker per realization, never deleted. The account limit is 500 and 63 are used. Previews also serve traffic against the shared 10 M request tier. | Reap previews of ended realizations (section 4). |
| Artifacts operations | A fork per realization, plus clones and token mints per start and build. The 10 k free tier is small and the unit is undefined. | Watch the first week of usage. $0.15 per 1 k: 100 k operations cost $13.50. |
| Phenome events in DO storage | Deployed apps post events, each a SQLite row write. | 5000 rows x 8 KB is 40 MB per System, about 0.2 GB per 5 Systems. Far below 5 GB. |
| R2 cache growth | One install snapshot per distinct lockfile, with no expiry. | 100 GB would cost $1.35 per month. Low dollars, but unbounded without the lifecycle rule. |
| Workers Logs | The CI Worker logs at 100% sampling. | 20 M events included. Sample if an app serves heavy traffic. |

## 4. Guardrails

Existing caps, in code:

| Cap | Value | Where |
| --- | --- | --- |
| Phenome rows per System | 5000, oldest trimmed | `worker/do/phenome-store.ts` |
| Phenome event size and batch | 8 KB per event, 100 events per request | `docs/design/backend.md` |
| SSE stream lifetime | 5 minutes | `worker/do/system-authority.ts` (`sseLifetimeMs`) |
| Agent fork token TTL | 6 h (`TOKEN_TTL_S` 21600); editor commit token 300 s and revoked | `worker/service.ts`, `worker/editor.ts` |
| Editor commit size | 1 MB per file, 8 MB per commit | `worker/editor.ts` |
| Changelog entry | 1.8 MB | `worker/do/changelog-store.ts` |
| CI commands | allowlisted, nothing from the repo | `worker/deployments.ts` |

Added in this change:

- **`apps/ci/wrangler.jsonc` `max_instances` 5 to 2.** Two builds run at once and the rest queue. This cuts the worst-case container bill by 60%.
- **Instance type stays `standard-4`.** `@cloudflare/ci` 0.2.0 documents no minimum size and no build has been timed on a smaller one. To try `standard-2` (3.1 times cheaper per minute but with a quarter of the vCPUs, so CPU-bound steps may take up to 4 times longer and save nothing), change `instance_type`, redeploy, and compare container minutes per build in section 5. Keep it only if `npm install` and the app build still finish.

Recommended, not applied. Run these deliberately.

**R2 cache expiry, 30 days.** A cache miss only costs a cold install.

```sh
npx wrangler r2 bucket lifecycle add artyfact-ci-cache expire-30d --expire-days 30
npx wrangler r2 bucket lifecycle add artyfact-ci-cache abort-mpu --abort-multipart-days 1
npx wrangler r2 bucket lifecycle list artyfact-ci-cache
# or: cf r2 buckets lifecycle get / update (see `cf r2 buckets lifecycle update --help`)
```

**Preview reaping.** List the previews, then delete those whose realization has ended (rejected, promoted or abandoned). Deleting a Worker also deletes its Durable Object data.

```sh
cf workers list --per-page 100 | jq -r '.[] | select(.name | test("-app-r[0-9]+$")) | "\(.name) \(.updated_on)"'
npx wrangler delete --name <slug>-app-r<N>
```

The list shows `updated_on`, so previews untouched for 14 days are the first candidates. Nothing deletes them automatically.

**Workers Logs sampling.** Both Workers log at 100%. If log events approach the 20 M tier, add `"head_sampling_rate": 0.1` to the `observability` block of the busy Worker. Preview Workers built from app repos can set their own.

## 5. How to check usage

Dashboard, per product, current billing period:

| Product | Path |
| --- | --- |
| All billable usage | Manage Account, Billing, Billable Usage |
| Workers requests, CPU, logs | Workers & Pages, the Worker, Metrics |
| Durable Objects | Workers & Pages, Durable Objects, `SystemAuthority`, Metrics (storage, rows, duration) |
| Containers | Workers & Pages, Containers, `CiSandbox` (instances, vCPU-seconds) |
| R2 | R2 Object Storage, `artyfact-ci-cache`, Metrics |
| Queues, Workflows, D1 | Each product's Metrics tab |
| Artifacts | Billable Usage page after 2026-10-14; `cf artifacts namespaces list` for repo counts |

Command line, read-only:

```sh
cf billing usage get-v1                      # current period; needs a token with billing read
npx wrangler r2 bucket info artyfact-ci-cache   # cache size and object count
cf artifacts namespaces list                 # repo count per namespace
cf workers list --per-page 100 | jq length   # Worker count against the 500 limit
```

`cf billing usage get-v1` exists but returned `403 Authentication error` with the OAuth login used to write this document. Use an API token with billing read permission. No `cf:usage` script is added: the command is alpha and the token requirement makes it unreliable as a default.

**Budget alert.** Dashboard: Manage Account, Notifications, Add. Choose "Billing Usage Alert" or "Billing Budget Alert", set the dollar threshold (suggested: $10 for the test round, $25 for the demo week), and add an email destination. `cf alerting available-alerts list` shows the same types as `billing_usage_alert` and `billing_budget_alert`, and `cf alerting policies create --help` shows the API form.
