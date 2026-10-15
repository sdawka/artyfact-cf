# Releases through Artifacts

Build output is the realized artifact, so the deployed version of the platform comes from an Artifacts repo, not from a local worktree. `artyfact release` (root: `pnpm run release`) is the one command. Status: implemented and tested behind a fake cloud in `packages/cli/test/release.test.ts`. The first real release ran on 2026-10-15 as tag `v20261015-c225282` into the Artifacts repo `artyfact/platform.builds`.

## What Cloudflare supports today (checked 2026-10-14)

- **Workers Builds can build and deploy a Worker directly from an Artifacts repo** ([Artifacts integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/)). Setup is in the dashboard only (**Workers & Pages → Create application → Continue with Artifacts**, or an existing Worker's **Settings → Builds → Connect**). The production branch must be `main`; non-`main` pushes make Worker Previews. A **Path** setting points a Worker at a subdirectory, so several Workers can deploy from one repo. The default deploy command is `npx wrangler deploy`; the build command is optional.
- `cf builds workers create` connects repositories whose `provider_type` is `github`, `gitlab`, `gitlab_internal` or `origin`; there is no `artifacts` choice yet, so the Artifacts connection cannot be scripted with `cf`.
- `cf deploy --prebuilt` deploys Build Output Specification files without building, but it needs a `cloudflare.config.ts` project; this repo is on `wrangler.jsonc`, so `cf deploy` is off limits here.
- A custom path exists too: an Artifacts push event starting a Workflow on `@cloudflare/ci` ([guide](https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/)), which is what `apps/ci` already does for app Systems.
- Git access to a repo uses short-lived repo tokens from `wrangler artifacts repos issue-token`, passed as a bearer header (never on argv). The platform's `ARTIFACTS` binding stays read-only; writes go over git.

## Design

1. `artyfact release` reads the source commit (refuses tracked or untracked source changes) and names the release `v-<sha12>` (stable across dates).
2. It builds `@artyfact/platform` and `@artyfact/site`, then stages a self-contained tree: `platform/` (the vite plugin's `dist`, whose `artyfact_platform/wrangler.json` has `main: index.js`, `no_bundle` and `assets: ../client`), `site/wrangler.jsonc` plus `site/dist/`, and `release.json` (version, git commit, tree hash of the self-Genome `genome/`, built-at, Worker configs, node and wrangler versions).
3. It commits that tree to `artyfact/platform.builds` as `main` with an annotated tag, pushed with a write token; the repo is created on first use. A tag that already exists is fetched and reused, so re-running the same source commit never mints a second release.
4. It deploys each Worker with `wrangler deploy --config <config>` and `cwd` in the checkout of `platform.builds`, never in the worktree; `release.json` in the repo is the deployment record.
5. `--dry-run` builds, stages and commits locally, reads the repo with a read token when it exists, pushes nothing and runs `wrangler deploy --dry-run`. `--no-deploy` pushes only; `--site-via-ci` skips the local site deploy (below). Tokens never reach stdout or argv.

The legacy `release` path is a local build/publish/deploy tool, not the self-development approval loop. Artyfact is already imported in production; that does not mean its local bootstrap has been approved or cloud-tested. `artyfact operator publish` instead requires a current promoted plan and immutable cloud output, and records System commit, exact source and accepted Genome refs, model digest, verification run and output digest. The accepted Genome can live under `system/` in the integrated fork; root `genome/` is not assumed to be authoritative. Local activation runs approved source with persistent operator state. Native hosted deployment remains deferred for this milestone.

## Public site from Artifacts (artyfact-ci)

Workers Builds is not used. The site deploys from the builds repo through `artyfact-ci` instead:

1. An Artifacts event subscription (`scripts/site-deploy-subscription.mjs`, idempotent) delivers `pushed` events on `artyfact/platform.builds` to the queue `artyfact-site-deploys`, which `artyfact-ci` consumes.
2. The consumer ignores anything but a push to `refs/heads/main` of that repo and starts the Workflow `artyfact-site-deploy` with instance id `site-<commit>`. A commit with a recorded run, or an instance that already exists, starts nothing new, so redelivery is a no-op.
3. The Workflow reads `release.json` and `site/wrangler.jsonc` at that commit outside the sandbox. `release.json` must list `artyfact-site` at `site/wrangler.jsonc` and name its source commit (`gitCommit`, or `source.commit` for a verified release). The site config must stay assets-only (`name`, `compatibility_date`, `assets` from `./dist`, `routes`); the Workflow writes its own Wrangler config from it.
4. If `main` still names the commit, one runner uploads the committed `site/dist` with the image's pinned Wrangler and only `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` in its environment (`CF_TOKEN`). Nothing is installed or built. A run whose commit main has already moved past is recorded `superseded`.
5. The outcome (commit, release tag, source commit, Worker version id, times, error) goes to R2 `artyfact-ci-cache` under `site-deploys/v1/<commit>.json` and `site-deploys/v1/latest.json`, readable at `GET /site-deploys/latest|<commit>` with the operator bearer.

`artyfact release --site-via-ci` pushes and deploys only `artyfact-platform` locally. The platform keeps its local `wrangler deploy`.

## Not in this slice

- Rollback by tag (`wrangler rollback` still works on Worker versions; a `release --tag v…` that redeploys an old release is the natural next step).
- Deploying `artyfact-ci` (it has a container image; its deploy stays `wrangler deploy` in `apps/ci`).
- Recording the release in the platform's deployments API.
