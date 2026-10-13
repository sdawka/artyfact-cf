# @artyfact/cli

`artyfact init|platform-sync|validate-genome|skill|start|tasks|claim|checkpoint|submit|build-report|status|compose|parts`. Platform URL from `--platform`, else
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
variable it prints the `curl` line instead and exits 0, even when no platform is running. A 409 `already-imported` asks for `--force`.
A new import is left in review: `init` prints `review: pending` and the Review URL, and nothing can start until a person agrees
the Genome node by node there (`--no-review` skips it, for a Genome you wrote yourself; `docs/design/backend.md` B.10). A re-run pushes
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
file the template has not changed since the lock is left to the app. The upgrade is one commit on a new Evolution
("Upgrade app template to <commit>"), so it runs the gates and CI preview and is promoted like any other change; it
rewrites the lock. Run `platform-sync` after changing a scaffold so existing apps see it. A whole-repo (fork) scaffold
gets no lock.

`platform-sync` lays out `packages/templates` as the `platform` repo, copying each scaffold's `bundle` directory. It
pushes only when the content changed.

A Genome with no `worker-fullstack` artifact imports without an app repo. `init` does not invent source or send an
`appRepo` for that System.

## Bring in a System: `validate-genome` and `skill`

```sh
npx artyfact skill --write                       # install the artyfact-genome skill (and an AGENTS.md pointer) into this repo
npx artyfact validate-genome ./genome --app .    # load the tree like the platform, report findings, unmapped files, stale globs
```

`skill` prints the skill, or with `--write` installs it: `--agent claude` (the default when `.claude/` exists) writes
`.claude/skills/artyfact-genome/` and an `AGENTS.md` pointer, `generic` puts the whole skill in `AGENTS.md`; symlinked targets are refused. A local agent follows it to write `./genome` for existing code. `validate-genome` takes a Genome directory
(`--app dir` maps the app's tracked files, minus `.artyfactignore`; `--json`; `--strict` also fails on unmapped files and
stale globs). Errors exit 1. When it ends in `ok:`, run `init`, then agree or reject the nodes in the platform's Review
(Import). The rules are in `docs/design/ontology.md` §3.

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

## Agent commands

The fork write token is read only from the `ARTYFACT_TOKEN` environment variable (there is no `--token` flag, since
argv is visible to other processes). It is handed to git through `GIT_CONFIG_*` environment variables for the
duration of one command, and is never written to `TASK_PACKET.md`, `AGENTS.md` or git config. `start` keeps it out of
`.artyfact.json` too, so set it again for each `start` and `submit`. The one exception is `claim` (below).

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

## Tasks and claims

```sh
npx artyfact tasks --system <sid> [--evolution <eid>] [--json]
ARTYFACT_ADMIN_TOKEN=… npx artyfact claim <taskId> --system <sid> --agent "claude:<task>" --dir ./work/<task> [--role r]
```

`tasks` is public. It prints `task | evolution | status | wave | depends-on | nodes | footprint`, one `conflicts:` line
per task pair that overlaps, and the first planned, unblocked task's claim line. `--json` prints the response as is.

`claim` posts `{ agentLabel, role }` to `POST /api/systems/:id/tasks/:tid/claim` with `ARTYFACT_ADMIN_TOKEN` as the
bearer (a wave-scoped claim token is deferred; the same https or localhost rule as the other bearer calls applies).
It then does what `start` does: clones the task's fork, writes `TASK_PACKET.md`, writes the packet's `agentsMd`
verbatim as `AGENTS.md`, and saves `.artyfact.json` with `taskId`. The fork write token comes from the claim response and
is saved only in `.artyfact.json` (mode 0600, git-excluded, beside the realization secret), never printed and scrubbed
from the packet files; `submit` uses it when `ARTYFACT_TOKEN` is unset. `start` still keeps its token in the environment
only. `status` prints `task:`. One claim is one clone of its own fork, so no worktrees are needed.

- A blocked task exits 1 with `blocked by t1, t2 (not yet promoted)`; a task claimed by someone else exits 1 with
  `task <id> is claimed by <label>`.
- Claiming again with the same label returns no new credentials (`fresh: false`); the CLI reuses the directory and the
  secret already saved there. Without that directory it stops and says so.

### Orchestrating agents

The loop for one task is claim, run the agent in the claimed directory, submit:

```sh
export ARTYFACT_ADMIN_TOKEN=…                    # the orchestrator's; agents never need it
npx artyfact tasks --system <sid>                # pick tasks of the lowest unfinished wave
npx artyfact claim <task> --system <sid> --agent "claude:<task>" --dir ./work/<task>
(cd ./work/<task> && claude -p "Read AGENTS.md and TASK_PACKET.md, implement the task; then npx artyfact submit")
```

Run one such loop per task of a wave, in parallel; the plan guarantees the tasks of one wave share no files. `submit` needs
no `ARTYFACT_TOKEN` in a claimed workspace, so the agent holds only that task's fork token (at rest in `.artyfact.json`, as
above). Do not mix this with Start wave on the Work view: Start wave claims every task of the wave itself, as
`agent:<task>`, and returns the start lines in its response, so `claim` then answers `task-taken` (or, for the same label,
reports that credentials were issued once). Use one or the other per task. Release a claimed task with
`POST /api/systems/<sid>/tasks/<task>/release` (admin) and claim it again.

A task of a later wave is refused until its dependencies are promoted (`blocked by …`). After the first task is promoted,
rebase its siblings with `POST /api/systems/<sid>/realizations/<rid>/rebase` (admin; `docs/design/backend.md` B.5), then
promote them and claim the next wave. The step-by-step run is in `docs/demo-runbook.md` (steps 4b, 7b); the agent-side
instructions are in `skills/artyfact-genome/SKILL.md`; routes and lifecycle are in `docs/design/backend.md` B.9.
