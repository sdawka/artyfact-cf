# @artyfact/cli

`artyfact init|platform-sync|start|checkpoint|submit|status|compose`. Platform URL from `--platform`, else `ARTYFACT_PLATFORM` (or the older `ARTYFACT_URL`),
else http://localhost:1337. When Vite moved to the next free port, the CLI uses the first of the next ten ports that
answers `/api/health` as artyfact.

## `init` and `platform-sync`

```sh
npx artyfact init --dir <project>                    # <project>/system (Genome) and <project>/app
npx artyfact init --genome <dir> --app <dir>         # examples layout; scripts/bootstrap.sh does this for Keep in Touch
npx artyfact init --dir <project> --from-template template.thing.cloudflare-worker-webapp@1   # no app yet
npx artyfact platform-sync [--namespace ns]
```

`init` reads `system.yaml`, derives the repo names (`src/naming.ts`, shared with the Worker), checks that
`npx wrangler whoami` and `cf auth whoami` agree on the account (set `CLOUDFLARE_ACCOUNT_ID` when several are
visible), and creates the namespace (`--namespace`, else `ARTIFACTS_NAMESPACE`, else `artyfact`) and repos when
missing. It then pushes `platform`, the Genome and the app, and calls `POST /api/systems/import` with
`Authorization: Bearer $ARTYFACT_ADMIN_TOKEN`. Without that variable it prints the `curl` line instead and exits 0.
A 409 `already-imported` asks for `--force`. A re-run pushes nothing and re-imports as a no-op.

Pushes never rewrite history. An empty repo gets a root commit. A repo whose head already has the project's tree is
left alone. Otherwise init commits on top of the head, but only when that head is the one this checkout last pushed,
recorded in `<project>/.artyfact/init.json`. History it did not push stops init with a message; `--adopt` commits on
top of it instead. Files are selected by the checkout's own ignore rules, plus `node_modules`, `.wrangler`, `dist`,
`.dev.vars` and `.env`. Write tokens come from `npx wrangler artifacts repos issue-token --json` and reach git only
through `GIT_CONFIG_*`. They are never printed or put on an argv.

`--from-template` reads the Thing template's `scaffold.yaml` from `platform`. With a `path`, it copies that subtree of
`scaffold.repo` into `<slug>.app`. Without one, it forks the whole repo (`cf artifacts namespaces repos fork`), which
also works for another System's `<slug>.app`. The source `{repo, commit, path}` is sent as `scaffoldFrom`.

`platform-sync` lays out `packages/templates` as the `platform` repo, copying each scaffold's `bundle` directory. It
pushes only when the content changed.

## Agent commands

The fork write token is read only from the `ARTYFACT_TOKEN` environment variable (there is no `--token` flag, since
argv is visible to other processes). It is handed to git through `GIT_CONFIG_*` environment variables for the
duration of one command, and is never written to `.artyfact.json`, `TASK_PACKET.md`, `AGENTS.md` or git config.
Set it again for each `start` and `submit`.

Every platform call carries the realization secret as `Authorization: Bearer <secret>`. Start work returns it once,
inside the printed start line as `ARTYFACT_SECRET=…`. `start` reads it from `ARTYFACT_SECRET` and saves it in
`.artyfact.json` (mode 0600, git-excluded); later commands use the saved copy, and `ARTYFACT_SECRET` overrides it. It
is never taken from argv, never printed, and scrubbed from `TASK_PACKET.md` and `AGENTS.md`. A rejected realization's
secret stops working (403).

`TASK_PACKET.md`, `AGENTS.md` and `.artyfact.json` are listed in the clone's `.git/info/exclude`, so they are never
committed. If the repo already tracks `AGENTS.md`, the CLI keeps it tracked and maintains a block between
`<!-- artyfact:start -->` and `<!-- artyfact:end -->`. The remote must be an Artifacts host
(`<32-hex>.artifacts.cloudflare.net`); `ARTYFACT_ALLOW_REMOTE_HOST=<host>` opts one other host in for local dev.
`submit` pushes to the remote recorded in `.artyfact.json`, not to `origin`.
