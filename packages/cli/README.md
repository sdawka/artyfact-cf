# @artyfact/cli

`artyfact init|platform-sync|evolution|plan|task|ontology|operations|skill|validate-genome`
plus compatible historical `start|checkpoint|submit|build-report|status|compose|parts` commands. Platform URL from `--platform`, else
`ARTYFACT_PLATFORM`, else the older `ARTYFACT_URL`. An explicit URL is used as given and never probed. Empty variables
count as unset, and an empty `--platform` is a usage error. Without one, the CLI asks http://localhost:1337 to 1346
(Vite takes the next free port when 1337 is busy) and uses the first whose `/api/health` identifies as artyfact. If
none does, the command stops with "no artyfact platform found", so a credential never goes to a server that did not
identify itself. The one exception sends no credential: `init` without `ARTYFACT_ADMIN_TOKEN` prints its import line for
http://localhost:1337.

## `init` and `platform-sync`

```sh
npx artyfact init --dir <project>                    # <project>/genome (Genome) and <project>/app
npx artyfact init --genome <dir> --app <dir>         # examples layout; scripts/bootstrap.sh does this for Peopling
npx artyfact init --dir <project> --from-template template.thing.cloudflare-worker-webapp@1   # no app yet
npx artyfact platform-sync [--namespace ns]
```

`init` reads the System id from the Genome's root `node.yaml`, pushes the node tree as `<slug>.genome`, derives the repo names (`src/naming.ts`, shared with the Worker), checks that
`npx wrangler whoami` and `cf auth whoami` agree on the account (set `CLOUDFLARE_ACCOUNT_ID` when several are
visible), and creates the namespace (`--namespace`, else `ARTIFACTS_NAMESPACE`, else `artyfact`) and repos when
missing. When creating reports that the namespace exists, init confirms it with `cf artifacts namespaces list`, which
prints one page without a next cursor, so a namespace beyond the first page is refused rather than assumed. It writes `platform` only when that repo is missing or empty; an existing one is left alone, and
`platform-sync` is the update path. It then pushes the Genome and the app, and calls `POST /api/systems/import` with
`Authorization: Bearer $ARTYFACT_ADMIN_TOKEN`, over https or plain http to localhost / 127.0.0.1 only. Without that
variable it prints the `curl` line instead and exits 0, even when no platform is running. A 409 `already-imported` asks for `--force`. The import leaves a System import review pending and refuses work until it is accepted; init prints its review URL, and `--no-review` sends `review: false` to skip it. A re-run pushes
nothing and re-imports as a no-op. Error text names the account by its first 8 characters only. The System id must be lower-case
(`system.peopling`), so every id maps to its own repos.

Pushes never rewrite history. An empty repo gets a root commit. A repo whose head already has the project's tree is
left alone. Otherwise init commits on top of the head, but only when that head is the one this checkout last pushed,
recorded in `<project>/.artyfact/init.json`. History it did not push stops init with a message; `--adopt` commits on
top of it instead. Files are selected by the checkout's own ignore rules, plus `node_modules`, `.wrangler`, `dist`,
and secret files (`.dev.vars`, `.env` and any `.dev.vars.*` / `.env.*` except `*.example`), even when tracked.
Symlinks travel as links only when their target is relative and inside the project; others are skipped and listed. Write tokens come from `npx wrangler artifacts repos issue-token --json` and reach git only
through `GIT_CONFIG_*`. They are never printed or put on an argv.

`--from-template` reads the Thing template's `scaffold.yaml` from `platform`. With a `path`, it copies that subtree of
`scaffold.repo` into `<slug>.app`. Without one, it forks the whole repo (`cf artifacts namespaces repos fork`), which
also works for another System's `<slug>.app`. The source `{repo, commit, path}` is sent as `scaffoldFrom`. Later
re-runs need no flag: with no local app, init uses the app repo's head, and the platform keeps the recorded
`scaffoldFrom` on a `--force` re-import of the same repo.

A path scaffold also gets `.artyfact/template.json`, the template lock: `{template, scaffoldCommit, files}`, with the git
blob id of every file the scaffold shipped. The platform's template upgrade (Overview "App template", or
`GET`/`POST /api/systems/:id/template-upgrade`) compares the current scaffold in `platform` with the app and this lock.
Files the app left alone are updated, added or removed. Files the app edited, or every differing file when there is no
lock, are conflicts that only change when the admin includes them. READMEs and secret files are never touched, and a
file the template has not changed since the lock is left to the app. The upgrade creates a Task candidate in a Realization pinned to the accepted Genome. It runs the gates and CI
preview; select, integrate and review its implementation before promotion. It rewrites the lock. Run `platform-sync` after changing a scaffold so existing apps see it. A whole-repo (fork) scaffold
gets no lock.

`platform-sync` lays out `packages/templates` as the `platform` repo, copying each scaffold's `bundle` directory. It
pushes only when the content changed.

A Genome with no `worker-fullstack` artifact imports without an app repo. `init` does not invent source or send an
`appRepo` for that System.

## `release`

`artyfact release` (root: `npm run release`) builds `@artyfact/platform` and `@artyfact/site`, commits the outputs and a `release.json` (version, source commit, self-Genome tree hash, built-at, Worker configs, tool versions) to the Artifacts repo `<namespace>/platform.builds` as `main` with the tag `v<yyyymmdd>-<sha7>`, and runs `wrangler deploy --config …` for each Worker with its working directory in that checkout. A tag that exists is fetched and deployed again instead of rebuilt. It refuses a dirty source tree (`--allow-dirty` overrides), `--dry-run` reads at most with a read token and deploys with `wrangler deploy --dry-run`, `--no-build` reuses the outputs on disk, `--no-deploy` only pushes (for a Workers Builds connection), and `--json` prints the result. Tokens never reach stdout or argv. Design: `docs/design/release-artifacts.md`.

## Parts

```sh
npx artyfact parts create --id part.example --version 1.0.0 --name Example --source ./part-source --out part.json
npx artyfact parts validate part.json
npx artyfact parts publish part.json --apply
npx artyfact parts compose recipe.json --out ./composed --apply
npx artyfact parts upgrade recipe-v2.json --from ./composed --apply
```

`create` reads `part-source/genome/` as model content and `part-source/app/` as source content. `extract` takes an
`ExtractionRequest` JSON file; `compose` and `upgrade` take a pinned `PartRecipe` JSON file. Every mutating Parts
command previews by default and writes only with `--apply`. Catalog publication needs `ARTYFACT_ADMIN_TOKEN`.
System-private reads use `--system` plus that token or `ARTYFACT_SECRET`.

Composition writes a new directory with `genome/`, `app/`, and `.artyfact/composition.json` plus
`.artyfact/baseline.json`. It refuses an existing output; use `upgrade` for a three-way update. A conflicting upgrade
writes nothing. Package and recipe commands are displayed in the preview and remain inert unless `--run-commands`
is explicitly combined with `--apply`; execution is local, bounded, and its working directory must stay inside the
generated app. Dependencies, caches, build output, local secrets, unsafe symlinks, and binary files are excluded or
rejected. Review and accept the generated Genome before realizing the app; these commands never deploy.

## Historical agent commands

The fork write token is read only from the `ARTYFACT_TOKEN` environment variable (there is no `--token` flag, since
argv is visible to other processes). It is handed to git through `GIT_CONFIG_*` environment variables for the
duration of one command, and is never written to `.artyfact.json`, `TASK_PACKET.md`, `AGENTS.md` or git config.
Set it again for each `start` and `submit`.

Every platform call carries the realization secret as `Authorization: Bearer <secret>`, so the platform URL must be
https, or plain http to localhost / 127.0.0.1. Start work returns it once,
inside the printed start line as `ARTYFACT_SECRET=…`. `start` reads it from `ARTYFACT_SECRET` and saves it in
`.artyfact.json` (mode 0600, git-excluded); later commands use the saved copy, and `ARTYFACT_SECRET` overrides it. It
is never taken from argv, never printed, and scrubbed from `TASK_PACKET.md` and `AGENTS.md`. A rejected realization's
secret stops working (403).

`TASK_PACKET.md`, `AGENTS.md` and `.artyfact.json` are listed in the clone's `.git/info/exclude`, so they are never
committed. `start` adds `node_modules`, `.wrangler`, `dist/`, `.dev.vars*` and `.env*` (except `*.example`) there too,
the same patterns as the app scaffold's `.gitignore`. As a backstop, `checkpoint` and `submit` never stage anything in
`node_modules` or `.wrangler`, or a secret file (`.dev.vars`, `.env`, `.dev.vars.*`, `.env.*` except `*.example`). If the repo already tracks `AGENTS.md`, the CLI keeps it tracked and maintains a block between
`<!-- artyfact:start -->` and `<!-- artyfact:end -->`. The remote must be an Artifacts host
(`<32-hex>.artifacts.cloudflare.net`); `ARTYFACT_ALLOW_REMOTE_HOST=<host>` opts one other host in for local dev.
`submit` pushes to the remote recorded in `.artyfact.json`, not to `origin`.

## `build-report`

```sh
npx artyfact build-report --status passed --url https://<worker>.<subdomain>.workers.dev [--commit <sha>] [--logs-url u]
npx artyfact build-report --status failed --error "tests failed"
```

The agent's fallback when platform CI did not build a submit. It posts a preview build for the commit (default `HEAD`)
to `POST /api/systems/:id/realizations/:rid/builds` with the realization secret, like the other agent commands. A
`passed` report with `--url` stores the preview on the candidate and re-runs the hooks, so the health check runs
against it; the command prints the resulting evaluations. Statuses are `queued`, `running`, `passed`, `failed` and
`error`; URLs must be http(s).

## Genome lifecycle and local agents

Administrative commands require `ARTYFACT_ADMIN_TOKEN`. Set `ADMIN_TOKEN` in this shell without exporting it, and
pass it to each admin command only, as `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact …`; never export
`ARTYFACT_ADMIN_TOKEN` or put it in a shell profile. Pass `--platform <url>` or set `ARTYFACT_PLATFORM`; credentials are
sent only over HTTPS or local HTTP.

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology preview --system system.example --file native-package.json
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology show import.id --system system.example
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology accept import.id --system system.example --hash <reviewed-hash>
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology bootstrap import.id --system system.example --dir ./project
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact evolution propose --system system.example --file intent.json
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact evolution create --system system.example --file evolution.json
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan draft --system system.example --evolution evolution.id [--node node.id] [--hint "text"] [--create]
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan create --system system.example --file plan.json
npx artyfact plan show plan.id --system system.example     # reads: no token on a public System
npx artyfact plan tasks plan.id --system system.example
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim plan.id task.id --system system.example --dir ./task
```

Preview accepts a native package JSON directly or `{package, genomeFiles}`; `genomeFiles` maps
relative native node paths to their exact text, supporting required custom root fields and initial content.

Bootstrap materializes the exact accepted Genome files in a new directory and runs `init`.
Use `--prepare-only` to stop before authentication/provisioning, including when a declared app has no source yet.
Then install guidance with `npx artyfact skill --dir ./project --write --agent generic`.
A Genome-only System is valid without source. For implementation, prepare genuine minimal scaffold source in
`./project/app` and accurate Thing/artifact/files mappings; feature work belongs to Tasks. Import with
`ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact init --dir ./project --platform <origin>` and retain the default
import review for changed content. Custom packages rely on server import validation. After acceptance, draft actual
source-bound IDs with `plan draft --system <system> --node <node-id> --platform <origin>`, inspect scope/problems,
then repeat with `--create`. Bootstrap refuses an existing directory; resume preparation there instead of overwriting.
The normal bootstrap path
it uses the existing Cloudflare authentication and provisioning flow. `intent.json` contains
`message` and optional `anchor`. New Evolutions are always Genome amendments.

`plan draft` asks the platform to partition accepted, not-yet-realized Genome Evolutions (`--evolution`, repeatable),
plus any explicit `--node` ids and a `--hint`, into Tasks. It prints the Task table, the waves and the problems, and
saves nothing. `--create` posts the draft unchanged and prints the plan id and review URL. `--json` prints the draft
(or `{draft, plan}` with `--create`).

`plan.json` (for `plan create`) contains `title`, optional current accepted `genomeCommit`, and `tasks`; each Task declares
`id`, `title`, `artifactId`, `steps`, `dependsOn`, `readNodes`, `writeNodes`, and `checks`.
The platform resolves repository scope and dependency waves before granting a writing attempt.

`plan tasks <plan>` prints `task | status | wave | depends-on | write nodes | footprint`, one `conflicts:` line per
overlapping pair, and the claim or resume command for the lowest-wave available Task. Dependencies must have selected
candidates and no conflicting writer may hold a live lease. Pending Tasks can be claimed; expired claimed/working
Tasks are offered with `resume` and an explicit platform origin. Use the existing workspace path to preserve local
work. Submitted, selected, completed and promoted work is excluded. JSON retains `next` (Task id or null) and adds
`nextAction: {taskId, action: "claim" | "resume"}` (or null).
Like `plan show`, it needs no token for a public System.

`task claim`, `task start`, and `task resume` have the same arguments (`--agent-label` names the agent).
The target directory is checked before any request: it must be absent, empty, or this Task's earlier workspace.
The fork write token is stored in `.git/artyfact-task.json` in the workspace (mode 0600, written to a temporary file
and renamed into place) together with the scoped attempt secret. It lives inside `.git`, so no `.gitignore` rule can
stage it; checkpoint and submit also never stage a `.artyfact-task.json` or `TASK_PACKET.md`, and an older workspace's root copy moves into
`.git` on first use. Neither is printed, and both are scrubbed
from `TASK_PACKET.md` and `AGENTS.md`. `task submit` uses `ARTYFACT_TOKEN` when set, else the stored token, and
notes when the stored one has expired. Resume preserves the fork and local work, stores fresh credentials and fences
the old attempt. `AGENTS.md` is the packet's `agentsMd` when the platform sends one, else a fixed text. A claim
refused by a dependency prints `blocked by <tasks> (not yet selected)`; a Task someone else holds prints
`task <id> is taken by <label>`, and one a conflicting Task's live attempt blocks prints
`task <id> conflicts with <task>, held by <label>`.

The agent loop gives the admin token to `claim` only, inline, and runs the agent without it:

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim plan.id task.id --system system.example --dir ./work/task.id --agent-label claude:task.id
cd ./work/task.id && env -u ARTYFACT_ADMIN_TOKEN claude -p "Follow AGENTS.md and TASK_PACKET.md, then run npx artyfact task submit"
```

`env -u` removes the token from the agent's environment, and nothing the agent starts inherits it. The risk is a shell
profile that exports `ARTYFACT_ADMIN_TOKEN`: a tool shell that reads the profile gets it back. So keep `ADMIN_TOKEN`
unexported and never set either name in a profile.

Inside the Task fork:

```sh
artyfact task status
artyfact task checkpoint "What changed and what remains"
artyfact task submit
```

The agent returns the durable review URL. After reviewing each submitted candidate:

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task select plan.id task.id --system system.example --candidate candidate.id
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan integrate plan.id --system system.example
npx artyfact plan review plan.id --system system.example        # a read: no token on a public System
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan promote plan.id --system system.example --file reviewed-promotion.json
```

Promotion JSON contains the reviewed `expectedHead` (string or null), `rationale`, and exact
`candidateIds`. Promotion implements the pinned Genome without advancing the accepted Genome.
`plan list` and `ontology list` list durable records; `evolution show <proposalId>` inspects a proposal.

Runtime observations and Flagship controls use `operations bindings`, then
`operations metrics|measurements|flags|audit --system <id> --binding <id>`.
Reads accept `--from`/`--to` ISO timestamps, measurement `--before` sequence numbers, flag `--cursor`,
and audit `--limit`; responses preserve pagination and availability states.
`operations flag-create --file flag.json` takes `{flag, reason}`;
`operations flag-update --key <key> --file update.json` takes `{expectedVersion, patch, reason}`.
`operations flag-disable --key <key> --expected-version <version> --reason <reason>` preserves
fallback behavior. All operation commands also require `--system` and, except `bindings`, `--binding`.

Install local Genome and coordinator guidance with `artyfact skill --write --agent generic`
(or `--agent claude`), and validate locally with `artyfact validate-genome ./genome --app .`.
The older `start`, `checkpoint`, and `submit` commands remain available for historical workflows.

## Intent integrity

Keep new intent beside the Genome as `intent/brief.md` and `intent/manifest.json`. Manifest `briefSections` are exact, case-sensitive ATX heading text. A source-free Genome is valid; do not add a fake app binding. Run a full check through the authenticated System authority:

Before the first CLI check, create the System at `<origin>/start` and accept any custom native package there. A planned Genome using built-in packages needs no app.

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology check --system system.example --genome ./genome --provider auto --platform https://platform.example --json > reviewed-snapshot.json
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology agreement run.id --system system.example --file dispositions.json --snapshot reviewed-snapshot.json --platform https://platform.example
npx artyfact ontology materialize --file reviewed-snapshot.json --dir ./project --prepare-only
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology materialize --file reviewed-snapshot.json --dir ./project --platform https://platform.example
```

`check` sends only allowlisted Genome YAML plus the two canonical sidecars, starts a durable run and polls it. JSON returns the exact server snapshot and run; exits are 0 passed, 1 blocked and 2 needs-review. A queued/running/cancelled or provider-off check is needs-review. Transport and failed-run errors are printed as errors rather than integrity results. The Review URL in the run is the browser handoff.

`agreement` updates the snapshot envelope only after the server records the exact dispositions. `materialize` requires eligible human agreement, writes the exact `snapshot.files`, and invents no source repository. Without `--prepare-only`, it pushes that Genome and imports with `integrityRunId`; the server reloads and recomputes the snapshot before carrying agreement. Caller-supplied hashes never establish agreement. Keep `ADMIN_TOKEN` unexported and run local authoring agents with `env -u ARTYFACT_ADMIN_TOKEN`.

Direct `init` of authored intent uses `--integrity-run <eligible-run>`. A legacy or demo bootstrap may instead use `--integrity-unreviewed-reason "<reason>"` (1 to 500 characters); the two options are mutually exclusive, and the latter remains visibly pending a full integrity check and agreement.
