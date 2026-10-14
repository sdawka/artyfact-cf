# Demo runbook

The whole loop in order: validate the Genome, import it, review the import, describe a change and agree it node by
node, plan the implementation as tasks in waves, run an agent per task, select, integrate and promote. Steps 0 to 2
were recorded in one real run on 2026-10-12 against the real Cloudflare Artifacts service (wrangler 4.149.0,
namespace `artyfact`, repos `peopling.genome`, `peopling.app` and `platform`), with tokens and secrets redacted;
that run predates import review, so its `init` output lacks the review line. Steps 5 to 9 were walked on the fake
platform ("The fake platform" below) and their outputs are labelled; they have not been walked on real Artifacts.
Commit ids and timestamps will differ on your run.

The two moments to show on video:

1. **Independent, then ordered** (steps 6 to 8). Goals and contact events are independent, so one wave runs both
   agents side by side. The Today screen invokes what both write, so it waits: its claim is refused with
   "blocked by t1, t2 (not yet selected)" until both results are selected.
2. **Violation vs deliberate choice** (step 5). A proposal that breaks a rule carries the rules engine's finding
   and cannot be agreed. A reworded commitment fires no rule and commits when its node is agreed.

**What is deterministic and what is not.** Rule findings, derivations, task footprints, conflicts, waves and the
promotion gate come from the rules engine and the platform. They are real in this run. System One judgments (change
class, interference, purpose measures) ran on the **fake provider** (`FAKE_S1=1`) because no `TYPESAFE_API_KEY` was
available. Fake answers are canned: each question gets its declared benign answer whatever the evidence, so the fake
labels the violation in amendment 1 a "deliberate choice" too. Every fake judgment carries `provider: "fake"`, every
System commit lists `decision.evidenceProviders`, and the UI shows "System One: fake provider" in the top bar and on
those History commits. With `TYPESAFE_API_KEY` in `apps/platform/.dev.vars` and `FAKE_S1` removed, the same steps use
the real model.

## 0. Prerequisites (once)

- Node 24, git, jq, `openssl`.
- Run `npx wrangler login` first. `npm run dev` fails without it, because the
  Worker's Artifacts binding is remote even in local dev.
- `cf` logged in (`cf auth login`). Wrangler and `cf` log in separately, so check that both show the same account
  before creating anything:

  ```sh
  npx wrangler whoami      # account id 1bae12d5…
  cf auth whoami           # same id
  ```

- Wrangler 4.145 or later; the repo pins 4.149.0. Older versions lack the Artifacts blob reads.
- Artifacts billing starts 14–15 October 2026. The free tier covers 10,000 operations a month, and one full run of
  this runbook uses a few hundred.

Once, in the checkout:

```sh
npm install
# Local secrets (git-ignored, owner-only). Never paste the token anywhere.
umask 077
cat > apps/platform/.dev.vars <<VARS
ADMIN_TOKEN=$(openssl rand -hex 32)
ACCOUNT_ID=$(npx wrangler whoami 2>/dev/null | grep -Eo '[0-9a-f]{32}' | head -1)
FAKE_S1=1
ALLOW_LOCAL_PREVIEW=1
PREVIEW_HOST_ALLOWLIST=
VARS
```

**In every terminal you open** (P, ops, sse), run this from the checkout. Terminals share nothing else.
`$RUN` is the owner-only scratch directory for anything you save, such as `plan.json`.

```sh
export REPO=$PWD RUN=$HOME/.artyfact-demo B=localhost:1337/api/systems/system.peopling
mkdir -p -m 700 "$RUN"; umask 077
alias artyfact='npx --prefix "$REPO" --no-install artyfact'
```

**Only in terminal ops**, the one the admin uses, set the admin token in a plain shell variable `ADMIN_TOKEN`, without
exporting it. Every admin command takes it inline (`ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact …`), so it is never in
the environment of a shell that starts an agent. An agent holds only its task's fork token and attempt secret, so it cannot claim,
select, integrate, promote or accept.

```sh
set +x
unset ADMIN_TOKEN ARTYFACT_ADMIN_TOKEN
ADMIN_TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' "$REPO/apps/platform/.dev.vars")
```

This is the **local** token. Production uses a separate verified macOS Keychain item: service `artyfact-platform.production`, account `1bae12d5089e4c2ee5c0e62c021a117f|artyfact-platform|https://artyfact-platform.dawka.workers.dev`. For production ops, replace the assignment above with `ADMIN_TOKEN=$(security find-generic-password -s artyfact-platform.production -a '1bae12d5089e4c2ee5c0e62c021a117f|artyfact-platform|https://artyfact-platform.dawka.workers.dev' -w)` and set the platform URL accordingly. Keep it unexported and use `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN"` only on the intended admin command. Do not copy a differing inherited CLI token or local `.dev.vars` token into production.

Follow [Deploy: production admin token](deploy.md#production-admin-token) for rotation: generate once, save pending, upload the saved bytes through stdin, verify a protected read with bounded activation retries, and promote only after HTTP 200. The browser stores its own session token; replace it after rotation. Its “saved” label does not establish authentication. No credential values belong in output, screenshots or agent shells.

## 1. Platform (about 10 s)

Terminal **P**:

```sh
npm run dev -w @artyfact/platform          # http://localhost:1337, Artifacts binding is remote
```

## 2. `artyfact init`: push and import in one command (about 30 s)

Terminal **ops**. First validate the Genome against the app; it prints the node counts, the findings (0 errors, 21
warnings for Peopling) and the exact `init` line:

```sh
artyfact validate-genome examples/peopling-system --app examples/peopling-app
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" ./scripts/bootstrap.sh   # = npx artyfact init --genome examples/peopling-system --app examples/peopling-app
```

`init` reads the root `node.yaml` and derives every name from the System id: slug `peopling`, repos
`peopling.genome` and `peopling.app`, forks `<repo>--r<N>`. It checks that `npx wrangler whoami` and
`cf auth whoami` show the same account and prints only its prefix. It creates the namespace and repos when missing,
creates `platform` (templates and rule packs) when it is missing or empty, pushes both projects with short-lived write tokens, and calls
`POST /api/systems/import` with `$ARTYFACT_ADMIN_TOKEN`. Tokens reach git only through `GIT_CONFIG_*` variables,
never an argv or the output. A project laid out as `<dir>/system` and `<dir>/app` runs `npx artyfact init --dir <dir>`.

On this namespace the first run stopped, because the Genome repo still held an earlier push made by the old bootstrap
script, whose tree also carried the package's `dist/` build output:

```text
system.peopling -> peopling.genome, peopling.app (namespace artyfact)
account 1bae12d5… (wrangler and cf agree)
namespace artyfact: exists
  created repo platform
platform: created at 6bd3603921dc
artyfact: peopling.genome has commits this checkout did not push (head ffb68c7) and its tree differs from …/examples/peopling-system.
init never builds over unknown history: merge that history into your project first, or re-run with --adopt to commit your project on top of ffb68c7 (a fast-forward).
```

`--adopt` commits the project on top of that head:

```sh
./scripts/bootstrap.sh --adopt
```

```text
system.peopling -> peopling.genome, peopling.app (namespace artyfact)
account 1bae12d5… (wrangler and cf agree)
namespace artyfact: exists
platform: unchanged at 6bd3603921dc
peopling.genome: pushed at 18374568e231
peopling.app: unchanged at c945510ffdf5
imported system.peopling at sc-1-b11cb27a
System: http://localhost:1337/s/system.peopling/r/head/overview
```

That run predates the 1337 default; its last line said `5173` and was edited. `platform` was still pushed by every
run then.

The import leaves a System import review pending (step 4): `init` ends with `review: pending, open
<platform>/s/system.peopling/r/head/review?panel=import`, and `--no-review` skips it.

A later run pushes nothing and re-imports with `force: false`, a no-op on the same commits. `platform` already exists,
so `init` leaves it alone. This run is verbatim. It went to a second local platform on port 1339, so it passed
`--platform http://localhost:1339`, and the printed URL shows the port the operator passed. With the default it is
1337. The head is `sc-3-c00256a3` because the older realization steps had run on this namespace since:

```text
system.peopling -> peopling.genome, peopling.app (namespace artyfact)
account 1bae12d5… (wrangler and cf agree)
namespace artyfact: exists
platform: exists at 6bd3603921dc, left alone (update it with 'npx artyfact platform-sync --namespace artyfact')
peopling.genome: unchanged at 18374568e231
peopling.app: unchanged at c945510ffdf5
imported system.peopling at sc-3-c00256a3
System: http://localhost:1339/s/system.peopling/r/head/overview
```

On an empty namespace the first run creates everything and imports in one go. If the import answers 409
`already-imported` (the repos moved since the last import), `init` says to re-run with `--force`. Without
`ARTYFACT_ADMIN_TOKEN` it pushes, prints the exact `curl` import line with a `$ARTYFACT_ADMIN_TOKEN` placeholder, and
exits 0.

The import response records the `platform` commit; each later System commit carries it too:

```sh
curl -s -XPOST localhost:1337/api/systems/import -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"systemId":"system.peopling"}' | jq -c '{head, genomeRepo, appRepo, platform, warnings, evolutions}'
```

```text
{"head":"sc-1-b11cb27a","genomeRepo":"peopling.genome","appRepo":"peopling.app","platform":{"repo":"platform","commit":"6bd3603921dcd7e3916906a0ff38a7510195bf1a"},"warnings":[],"evolutions":["evolution.1","evolution.2","evolution.3","evolution.4","evolution.5","evolution.6"]}
```

`genomeRepo` and `appRepo` default to the derived names. `warnings` is empty because every rule pack and template the
System pins is in `platform`. A missing pin gives `platform.pin-missing`, and a namespace without `platform` gives a
`platform.unsynced` readiness warning; neither blocks. Evaluation still uses the packages bundled into the Worker.
Without the header the import answers 401, and with a wrong token 403.

```sh
curl -s "$B/model?rev=head" | jq -c '{genomeCommit, nodes: (.model.index.byId | length), findings: (.readiness.findings | group_by(.level + " " + .rule) | map({(.[0].level + " " + .[0].rule): length}) | add)}'
```

```text
{"genomeCommit":"18374568e231dac73d5cf06517a8994b8bb20fad","nodes":215,"findings":{"warning hook.unbound":14,"warning kit.unpinned":1}}
```

The model has 0 errors. The warnings are 14 unbound hooks and the unpinned auth kit. Open the printed System URL to
see the same System; Overview, Work, Evaluations and History read the live API.

## 3. Event stream (keep it open)

Terminal **sse**:

```sh
curl -sN localhost:1337/api/systems/system.peopling/events
```

The stream sends only live events plus a `ping` every 15 s. Events emitted while nothing is connected are not
replayed, so the UI refetches after it reconnects. Realization plans emit no events: the Work view and
`artyfact plan tasks` poll.

## 4. Review the import (about 1 min)

The import left a System import review pending, so every route that starts work answers 409 `import-unreviewed`
until it is accepted: Evolutions, realizations, intents, template upgrade, and plan create, draft and claim.
Open the printed review URL, or Review (`g r`) where the queue's first group is "Import · N nodes".

On screen: the containment tree below the System, readiness findings, the app paths no node maps to (200 shown, the
total beside them) and an interpretation field. Agree the tree, or reject a node you do not want in the Genome, then
accept. Accepting with rejected nodes removes them from the Genome in the same step: the removal is an amendment that
commits and approves at once, and the outcome names its System commit. A node another node still references cannot be
rejected (422 `rejected-node-referenced`, naming both), and a live Evolution whose criteria the removal deletes is
listed as a warning. The same accept from a terminal:

```sh
curl -s -XPOST $B/import-review/accept -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"interpretation":"The imported tree matches the product.","rejectedNodes":[]}' | jq -c 'keys'
curl -s $B/import-review | jq -c '{status, nodes: (.tree | length), unmapped: (.unmapped | length), unmappedTotal}'   # public read
```

*On the fake platform* the seed imports with `review: false`, so the guards start open. To walk this step there,
delete the System and import it again with a review (the fake repos stay):

```sh
curl -s -XDELETE $B -H "authorization: Bearer $ADMIN_TOKEN" | jq -c .
curl -s -XPOST $ARTYFACT_PLATFORM/api/systems/import -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"systemId":"system.peopling","review":true}' | jq -c '.genomeCommit'
```

Until the accept, the review read gives `{"status":"pending","nodes":5,"unmapped":0,"unmappedTotal":0}` and
`POST $B/intents` answers 409 `import-unreviewed`. The accept above then prints `["review"]`, and the read gives
`"status":"accepted"`.

`artyfact init --no-review` imports with no review on a real platform.

## 5. Describe a change, agree it node by node (about 1 min)

Work, "Describe a change" (`?panel=intent`). Type a message, for example "Change what the People screen says". The
platform routes it to a node path, translates it into ops and shows the agreement tree: the ops grouped under the
nodes they touch, rooted at the Things. Agree, Reject or Defer each node (a child decided after its parent overrides
it), or press `a`, `r`, `d` on a focused row. A node with an error cannot be agreed, and an agreed op that needs a
rejected or deferred one is left out, its node saying "needs <title>".

"Accept agreed" commits exactly the agreed changes to the Genome at once. Deferred nodes move to a new proposal with
its own Genome-amendment Evolution, titled "Deferred from <proposal>", and stay open. Nothing is implemented yet.

From a terminal, the same proposal and the same decisions:

```sh
curl -s -XPOST $B/intents -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"message":"Change what the People screen says"}' | jq -c '{id, status, evolutionId, plan: (.plan | length)}'
curl -s -XPUT $B/intents/proposal.1/decisions -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"decisions":[{"nodeId":"thing.webapp","decision":"agree"}]}' | jq -c '.plan[0].decision'
curl -s -XPOST $B/intents/proposal.1/accept -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"opIds":["op.1"]}' | jq -c '{evolution: .evolution.id, state: .evolution.state, kind: .evolution.kind, systemCommit: .systemCommit.id}'
```

Fake platform output (see "The fake platform" below):

```text
{"id":"proposal.1","status":"open","evolutionId":"evolution.7","plan":1}
"agree"
{"evolution":"evolution.7","state":"promoted","kind":"genome-amendment","systemCommit":"sc-2-f72705ae"}
```

*Fake-only limit.* The fake translator proposes one op per message, so deferral is not shown on the fake platform
(the intents tests cover it). With a real translator, defer one node and watch the new proposal appear.

**Moment 2 (violation vs deliberate choice).** A proposal whose ops would break a rule carries that finding as a
`problem` with its derivation; the node cannot be agreed, so the violation never reaches the Genome. Reword a
commitment instead and no rule fires: the node is agreed and the change commits. The rules engine decides which is
which. System One's answer, labelled fake here, is advice only.

## 6. Plan the implementation (about 30 s)

The accepted Evolution changed only the Genome. Implementation is a Realization plan pinned to it. Ask the platform
to partition the accepted, not-yet-realized changes into tasks:

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact plan draft --system system.peopling
```

Fake platform output; nothing is saved:

```text
draft: Implement Change what the People screen says (1 task, genome 6da431bbaf3904f464864a6bced432169cfbadd5)
task  title             wave  depends-on  write nodes
t1    [fake] 1. People  1     -           screen.people
wave 1: t1
Nothing was saved. Re-run with --create to create this plan.
```

`--evolution <id>`, `--node <id>` and `--hint` narrow the scope, and `--create` posts the draft unchanged. In Work
(`?panel=plan`), "Draft tasks" does the same: rename, merge, split or remove tasks in the browser, then "Create plan".
Nodes held by an open plan are skipped from the next default draft, and a node counts as realized only after a promoted plan.

For the demo shape, three tasks for Peopling's goals, contact events and Today screen, create the plan from a file.
`plan draft --node` with the same eight nodes drafts the same three tasks and waves (fake planner; the planner test
checks it), adding read nodes, derived dependencies and checks:

```json
{"title":"Goals and contact memory","tasks":[
 {"id":"t1","title":"Goals","artifactId":"artifact.webapp","steps":["Add the goal operation"],"dependsOn":[],"readNodes":[],"writeNodes":["operation.goal.save"],"checks":[]},
 {"id":"t2","title":"Contact events","artifactId":"artifact.webapp","steps":["Add the contact event log"],"dependsOn":[],"readNodes":[],"writeNodes":["entity.ContactEvent","operation.contact.log"],"checks":[]},
 {"id":"t3","title":"Today screen","artifactId":"artifact.webapp","steps":["Add the goal and Today screens"],"dependsOn":[],"readNodes":[],"writeNodes":["screen.goal","screen.logContact","screen.today","component.TodayList","affordance.Today.refresh"],"checks":[]}]}
```

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact plan create --system system.peopling --file plan.json
export P=plan.…                                        # the id it prints
artyfact plan tasks $P --system system.peopling        # plan reads need no token on a public System
```

The platform expands each node to its subtree, derives the dependencies (t3 invokes what t1 and t2 write), computes
footprints per binding and the waves. Fake platform output (conflicts in full, lines cut at 110 characters):

```text
task  status   wave  depends-on  write nodes
t1    pending  1     -           operation.goal.save
t2    pending  1     -           entity.ContactEvent,operation.contact.log
t3    pending  2     t1,t2       screen.goal,screen.logContact,screen.today,component.TodayList,affordance.To…
conflicts: t1 <-> t3 [dependency] : t1 and t3: dependency interference
conflicts: t2 <-> t3 [dependency] : t2 and t3: dependency interference
claim: ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim plan.… t1 --system system.peopling --dir ./work/t1 --agent-label claude:t1
```

The waves are `[[t1, t2], [t3]]`. The Work plan view shows them as "Wave 1 · 2 tasks" and "Wave 2 · 1 task" with a
conflict chip on each dependency.

## 7. Wave 1: claim and run the agents (about 10 s each)

The wave board lists, per task, a claim line and an agent line. "Copy all" chains each claim to its agent
(`claim && { agent & }`), so a failed claim never starts its agent and the wave's agents run side by side. By hand, per task, in terminal **ops**:

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact task claim $P t1 --system system.peopling --dir ./work/t1 --agent-label claude:t1
( cd ./work/t1 && env -u ARTYFACT_ADMIN_TOKEN claude -p "Follow AGENTS.md and TASK_PACKET.md, then run npx artyfact task submit" ) &
wait
```

The claim clones the task's fork into `./work/t1`, writes `TASK_PACKET.md` and `AGENTS.md` and stores the fork token
and attempt secret in `.git/artyfact-task.json` (mode 0600, never staged, never printed). The agent never sees the
admin token: it is set for the claim only, and the agent line unsets it. Nothing started under `env -u` inherits the
token; the risk is a shell profile that exports it, which a tool shell reading that profile picks up again. Keep
`ADMIN_TOKEN` unexported and never set either name in a profile.
`AGENTS.md` carries the wave, permitted edits, do-not-touch (the other tasks' globs), concurrent tasks and what the
task builds on. A claim that fails after it landed (for example the clone) is recovered with `artyfact task resume`,
which stores fresh credentials and fences the old attempt.

Inside a workspace the agent checkpoints and submits without any token handoff:

```sh
artyfact task status
artyfact task checkpoint "Added the goal route; Today screen left to t3"
artyfact task submit                                    # uses the stored token; prints the candidate and evaluations
```

Submit commits pending changes, pushes the fork and submits the exact commit; the candidate id (for example
`candidate.task.r4.9a7d4cb`) is in its output and on the task detail. Hooks run for the task's `checks`.

## 8. Wave 2: the dependent task is refused until its dependencies are selected

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact task claim $P t3 --system system.peopling --dir ./work/t3
```

Fake platform output while t1 and t2 are only claimed or submitted:

```text
artyfact: blocked by t1, t2 (not yet selected)
```

The server's 409 carries `details {blockedOn: ["t1","t2"]}`. A task another agent holds is refused with
`task <id> is taken by <label>` (`details {by}`). Select each submitted candidate after reviewing it, in the Work task
detail or here:

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact task select $P t1 --system system.peopling --candidate candidate.task.r4.9a7d4cb
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact task select $P t2 --system system.peopling --candidate candidate.task.r5.1d0e64c
artyfact plan tasks $P --system system.peopling        # t1, t2 selected; the claim line now names t3
```

Now the claim for t3 succeeds, and its `AGENTS.md` says "Builds on: t1 (selected; its changes are in your base); t2
(selected; its changes are in your base)." Run the agent as in step 7 and submit.

## 9. Select, integrate, review, promote (about 10 s)

```sh
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact task select $P t3 --system system.peopling --candidate candidate.task.r6.7adc6e6
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact plan integrate $P --system system.peopling
artyfact plan review $P --system system.peopling
```

Integrate replays every selected task's delta onto the plan's pinned base, per binding, and builds one candidate per
changed binding. File modes and symlinks survive. If another promotion moved a binding the plan touches, integrate
answers 409 `replan-required`: draft a new plan, there is no rebase. The review lists the integrated candidates, their
evaluations, blockers and the `expectedHead`. Fake platform: the review's evaluations include `C.system.purpose` and
`C.webapp.outgoing.single` as `unknown`/`not-run`, because their hooks do not run there.

Promote with the reviewed head and the exact integrated candidate ids:

```sh
cat > promotion.json <<'JSON'
{"expectedHead":"sc-2-f72705ae","rationale":"Goals and contact memory","candidateIds":["candidate.task.r7.4784397"]}
JSON
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" artyfact plan promote $P --system system.peopling --file promotion.json
```

Promotion re-runs the gate on the exact commits and records one System commit with the realized Genome per binding.
A refused gate answers 409 `blocked` or 400 `advisories-unacknowledged` with `details {criteria, advisories}`; a head that
moved is 409 `stale-base`. Fake platform result: the plan is `promoted`, its tasks `completed`, the head moved to
`sc-3-83fdeb29` and `planCounts` is all zero.

## The fake platform

Steps 5 to 9 were walked on the fake platform, in-memory Artifacts seeded from `examples/*`, with the real CLI and a
local git transport:

```sh
cd apps/platform && FAKE_ARTIFACTS=1 ADMIN_TOKEN=test FAKE_S1=1 npx vite --port 1339 --strictPort
export ARTYFACT_PLATFORM=http://localhost:1339
export ARTYFACT_ALLOW_REMOTE_HOST=fake.artifacts.local GIT_CONFIG_GLOBAL=$PWD/gitconfig
# The fake admin token is `test`: set ADMIN_TOKEN=test in this shell without exporting it; admin commands pass it inline.
# gitconfig: [url "http://localhost:1339/api/fake-git/"] insteadOf = https://fake.artifacts.local/git/artyfact/
```

On it the agent is a file edit in each workspace instead of `claude -p`, the translator and System One are canned,
and CI builds and previews do not run (health stays `unknown`). The real-Cloudflare steps (0 to 2) were recorded on
2026-10-12 against the real service, before import review and the plan flow existed; steps 4 to 9 have not yet been
walked against real Artifacts.

## Queue path

Artifacts emits `pushed` only from a **repository-level** event subscription (`--source artifacts.repo` with
`--source-namespace` and `--source-repo-name`). The account-level `artifacts` source has `repo.created`,
`repo.forked`, `repo.imported` and `repo.deleted`, but no push. So pushes to a new fork reach
`artyfact-artifacts-events` only after someone creates a subscription for that fork:

```sh
npx wrangler queues subscription create artyfact-artifacts-events --source artifacts.repo --events pushed \
  --source-namespace artyfact --source-repo-name peopling.app--task-<id>
```

The local dev server also never receives messages from a remote queue. **`artyfact task submit` is therefore the primary
path.** The queue consumer is a deployed-only convenience. Wiring it needs a subscription per fork at start, which in
turn needs an API token in the Worker, and that is not built. When a push and a CLI submit both arrive, they
converge on one candidate per (attempt, commit). The route tests cover that, including duplicate delivery.

## Timings (recorded run, before the plan flow)

These come from the 2026-10-12 run of the older realization commands; the task commands clone and push the same way.

| Step | Time |
|---|---|
| dev server ready | about 1 s warm, 15 s on the very first start |
| `artyfact init`, namespace present (push, platform, import) | 22–31 s |
| two concurrent starts: fork, ready, token, packet | 10 s together; a single start about 6 s |
| clone | 2.2–3.2 s |
| checkpoint | under 1 s |
| submit, app | 5.9–8.1 s |
| submit, Genome | 8.2 s |
| promote | 2.3 s |
| integration test, end to end (includes `init`) | 102–128 s |

## Integration test

```sh
cf artifacts namespaces create --namespace artyfact-test      # once
cd apps/platform && ARTYFACT_INTEGRATION=1 npx vitest run --project integration
```

This test still drives the older realization commands (`start`, `submit`, `promote`), which stay available. It runs its own `wrangler dev` (`wrangler.integration.jsonc`), then `artyfact init` on a copy of the example
renamed `system.itest-peopling-<run>`, so the repos are `itest-peopling-<run>.genome` and `.app` in
`artyfact-test`, next to that namespace's shared `platform` repo. It drives two starts, two real CLI starts and
submits, the conflict, promotion, the 409 and history. Then it deletes the repos and forks of its own run, never
`platform`. Without the flag it is skipped.

## Troubleshooting

- **Token expired (401/403 from git):** a claim's write token and lease last 15 minutes (`leaseSeconds` defaults to 900 in
  `apps/platform/worker/lifecycle-service.ts`, maximum 3600; the CLI uses the default). `tokenExpires` is in
  `.git/artyfact-task.json`. Run
  `artyfact task resume <plan> <task> --system <id> --dir <dir>` with the admin token: it keeps the fork and your local
  work, stores fresh credentials and fences the old attempt. `task submit` says when the stored token has expired.
- **A claim failed after it landed (clone error):** the attempt and its lease exist, but the CLI removed the
  half-made workspace and printed the `task resume` line to run once the cause is fixed. Another agent's live lease is
  refused with "task <id> is taken by <label>".
- **"blocked by … (not yet selected)":** a dependency has no selected candidate. Select it (step 8) and claim again.
  The plan view and `plan tasks` name the next claimable task.
- **409 `import-unreviewed`:** accept the System import review (step 4), or import with `review: false`.
- **409 `replan-required` on integrate:** another promotion moved a binding this plan touches. Draft a new plan;
  there is no rebase.
- **Draft skips nodes:** an open plan holds them, or a promoted plan already realized them. Name the Evolution with
  `--evolution` to take held nodes again.
- **Fork not ready:** a claim whose fork does not come up answers with an error. Retry it. The failed attempt is ended
  and its token revoked.
- **`init` stops with "has commits this checkout did not push":** someone pushed to the repo, or it was pushed
  before this checkout recorded its own pushes in `.artyfact/init.json`. Merge that history into the project, or
  re-run with `--adopt` to commit the project on top (a fast-forward; init never force-pushes).
- **Health `fail` with "buildId does not match the commit":** the preview served another `BUILD_ID`. In this run the
  first preview served `dev`. Restart it with `--var BUILD_ID:$(git rev-parse HEAD)`. Promotion re-runs the probe.
- **Wrangler version:** run `npx wrangler --version`. It must be 4.145 or later; 4.149.0 is verified.
- **`cf artifacts namespaces create` prints help:** the name goes in `--namespace <name>`, not as a positional
  argument.
- **Schema mismatch after pulling new code:** stop the dev server and move `apps/platform/.wrangler/state` aside.
  There are no Durable Object migrations yet. Old forks in the namespace are skipped by name.
- **Dev server exits after a branch switch or `npm install`:** restart `npm run dev`. The Durable Object state
  survives restarts.
- **Missed events in the UI:** server-sent events are not replayed. Reload the page, or rely on the UI's polling.

## Reset

```sh
# stop the dev server first
for r in $(npx wrangler artifacts repos list --namespace artyfact --json | jq -r '.[].name'); do
  npx wrangler artifacts repos delete "$r" --namespace artyfact --force
done
rm -rf apps/platform/.wrangler/state ./work "$RUN"
```

Then start again at step 1. To start over without deleting anything in the account, stop the dev server and move
`apps/platform/.wrangler/state` aside instead: `init` finds the repos unchanged and new forks get new names.
