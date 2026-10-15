# Releases through Artifacts

Build output is the realized artifact, so the deployed version of the platform comes from an Artifacts repo, not from a local worktree. `artyfact release` (root: `npm run release`) is the one command. Status: implemented behind a fake cloud in `packages/cli/test/release.test.ts`; no real release has been run yet.

## What Cloudflare supports today (checked 2026-10-14)

- **Workers Builds can build and deploy a Worker directly from an Artifacts repo** ([Artifacts integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/)). Setup is in the dashboard only (**Workers & Pages → Create application → Continue with Artifacts**, or an existing Worker's **Settings → Builds → Connect**). The production branch must be `main`; non-`main` pushes make Worker Previews. A **Path** setting points a Worker at a subdirectory, so several Workers can deploy from one repo. The default deploy command is `npx wrangler deploy`; the build command is optional.
- `cf builds workers create` connects repositories whose `provider_type` is `github`, `gitlab`, `gitlab_internal` or `origin`; there is no `artifacts` choice yet, so the Artifacts connection cannot be scripted with `cf`.
- `cf deploy --prebuilt` deploys Build Output Specification files without building, but it needs a `cloudflare.config.ts` project; this repo is on `wrangler.jsonc`, so `cf deploy` is off limits here.
- A custom path exists too: an Artifacts push event starting a Workflow on `@cloudflare/ci` ([guide](https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/)), which is what `apps/ci` already does for app Systems.
- Git access to a repo uses short-lived repo tokens from `wrangler artifacts repos issue-token`, passed as a bearer header (never on argv). The platform's `ARTIFACTS` binding stays read-only; writes go over git.

## Design

1. `artyfact release` reads the source commit (refuses a dirty tree unless `--allow-dirty`) and names the release `v<yyyymmdd>-<sha7>` (UTC date).
2. It builds `@artyfact/platform` and `@artyfact/site`, then stages a self-contained tree: `platform/` (the vite plugin's `dist`, whose `artyfact_platform/wrangler.json` has `main: index.js`, `no_bundle` and `assets: ../client`), `site/wrangler.jsonc` plus `site/dist/`, and `release.json` (version, git commit, tree hash of the self-Genome `genome/`, built-at, Worker configs, node and wrangler versions).
3. It commits that tree to `artyfact/platform.builds` as `main` with an annotated tag, pushed with a write token; the repo is created on first use. A tag that already exists is fetched and reused, so re-running the same source commit never mints a second release.
4. It deploys each Worker with `wrangler deploy --config <config>` and `cwd` in the checkout of `platform.builds`, never in the worktree; `release.json` in the repo is the deployment record.
5. `--dry-run` builds, stages and commits locally, reads the repo with a read token when it exists, pushes nothing and runs `wrangler deploy --dry-run`. `--no-deploy` pushes only (for the Workers Builds path below). Tokens never reach stdout or argv.

The platform's `POST /api/systems/:id/deployments` is per imported System and binds a System commit to an app repo; the platform itself is not an imported System in production, so this slice records nothing there. When `system.artyfact` is imported, `release.json` carries what such a record needs (`gitCommit`, `genomeTree`).

## Native path (optional, one-time, dashboard)

Once `platform.builds` has its first release, connect each Worker in the dashboard to the Artifacts repo `artyfact/platform.builds`, branch `main`, no build command, deploy command `npx wrangler deploy`, Path `platform/artyfact_platform` for `artyfact-platform` and `site` for `artyfact-site`. From then on `artyfact release --no-deploy` pushes and Workers Builds deploys. Until that is set up, the command's own `wrangler deploy` step is the deploy.

## Not in this slice

- Rollback by tag (`wrangler rollback` still works on Worker versions; a `release --tag v…` that redeploys an old release is the natural next step).
- Deploying `artyfact-ci` (it has a container image; its deploy stays `wrangler deploy` in `apps/ci`).
- Recording the release in the platform's deployments API.
