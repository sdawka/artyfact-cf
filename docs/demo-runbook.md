# Demo runbook

The whole loop against the real Cloudflare Artifacts service, in order. Every output below comes from a real run on
2026-10-12 (wrangler 4.149.0, namespace `artyfact`), with tokens and the admin secret redacted. Commit ids and
timestamps will differ on your run.

The two moments to show on video:

1. **Different files, same meaning** (step 7): agent A edits the dialog's save handler and agent B edits the contacts
   routes. No file is shared, yet the platform reports a soft-semantic conflict on `operation.contact.save`.
2. **Deliberate choice vs violation** (step 10): one Genome amendment holds two changes. System One reads the reworded
   commitment as a deliberate choice. The rules engine flags the recipients list as a hard `topology.recipientArray`
   violation and shows its derivation.

System One ran on the **fake provider** (`FAKE_S1=1`), because no `TYPESAFE_API_KEY` was available. The UI labels
fake judgments. To use TypeSafe, put `TYPESAFE_API_KEY` in `apps/platform/.dev.vars` and remove `FAKE_S1`.

## 0. Prerequisites (once)

- Node 24, git, jq, `openssl`.
- Run `npx wrangler login` first. `npm run dev`, `vite preview` and `npm run e2e` all fail without it, because the
  Worker's Artifacts binding is remote even in local dev.
- `cf` logged in (`cf auth login`). Wrangler and `cf` log in separately, so check that both show the same account
  before creating anything:

  ```sh
  npx wrangler whoami      # account id 1bae12d5…a117f
  cf auth whoami           # same id
  ```

- Wrangler 4.145 or later; the repo pins 4.149.0. Older versions lack the Artifacts blob reads.
- Artifacts billing starts 14–15 October 2026. The free tier covers 10,000 operations a month, and one full run of
  this runbook uses a few hundred.

```sh
export REPO=$PWD                     # the artyfact checkout
npm install
# Run the CLI from any directory (the platform's printed start line says `npx artyfact`).
alias artyfact='npx --prefix "$REPO" --no-install artyfact'

# Local secrets (git-ignored). Never paste the token anywhere.
cat > apps/platform/.dev.vars <<EOF
ADMIN_TOKEN=$(openssl rand -hex 32)
ACCOUNT_ID=$(npx wrangler whoami 2>/dev/null | grep -Eo '[0-9a-f]{32}' | head -1)
FAKE_S1=1
ALLOW_LOCAL_PREVIEW=1
PREVIEW_HOST_ALLOWLIST=
EOF
set -a; . apps/platform/.dev.vars; set +a     # $ADMIN_TOKEN for the admin calls below
```

## 1. Bootstrap (about 15 s)

```sh
./scripts/bootstrap.sh
```

The script creates the namespace if it is missing (`cf artifacts namespaces create --namespace artyfact`). It then
creates `kit-system` and `kit-app` and pushes the two examples with a write token. The token goes to git through
`GIT_CONFIG_*` environment variables, never argv. On the first run the namespace step printed:

```text
{ "namespace": "artyfact", "jurisdiction": "unrestricted", "repo_count": 0, "created_at": "2026-10-12T09:09:30.771Z", … }
```

Bootstrap output:

```text
account: 1bae12d5089e4c2ee5c0e62c021a117f  namespace: artyfact
kit-system head: 014554b3301d3526892be057a9a54f0d5deb7d68
kit-app head: daf5934e262aaf2634f93d220224a84203dc153d

Import into the platform (apps/platform dev server):
curl -XPOST localhost:5173/api/systems/import -H "authorization: Bearer $ADMIN_TOKEN" …
```

A second run prints the same heads and pushes nothing.

## 2. Platform and import (about 10 s, then 2 s)

Terminal **P**:

```sh
npm run dev -w @artyfact/platform          # http://localhost:5173, Artifacts binding is remote
```

Terminal **ops**:

```sh
B=localhost:5173/api/systems/system.keep-in-touch
curl -s -XPOST localhost:5173/api/systems/import -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"systemId":"system.keep-in-touch","genomeRepo":"kit-system","appRepo":"kit-app"}' | jq -c '{head, genomeCommit, appCommit, evolutions}'
```

```text
{"head":"sc-1-493d7308","genomeCommit":"014554b3301d3526892be057a9a54f0d5deb7d68","appCommit":"daf5934e262aaf2634f93d220224a84203dc153d","evolutions":["evolution.1","evolution.2","evolution.3","evolution.4","evolution.5","evolution.6"]}
```

Without the header the import answers 401, and with a wrong token it answers 403.

```sh
curl -s "$B/model?rev=head" | jq -c '{genomeCommit, nodes: (.model.index.byId | length), findings: (.readiness.findings | group_by(.level + " " + .rule) | map({(.[0].level + " " + .[0].rule): length}) | add)}'
```

```text
{"genomeCommit":"014554b3301d3526892be057a9a54f0d5deb7d68","nodes":215,"findings":{"warning hook.unbound":14,"warning kit.unpinned":1}}
```

The model has 0 errors. The warnings are 14 unbound hooks and the unpinned auth kit.

Open http://localhost:5173 to see the same System. The Overview, Work, Evaluations and History views read the live API.

## 3. Event stream (keep it open)

Terminal **sse**:

```sh
curl -sN localhost:5173/api/systems/system.keep-in-touch/events
```

The stream sends only live events plus a `ping` every 15 s. Events emitted while nothing is connected are not
replayed, so the UI refetches after it reconnects.

## 4. Two concurrent realizations on evolution.1 (about 4 s each)

```sh
T=$(mktemp -d)      # private (0700); holds the responses with tokens and secrets for a moment
curl -s -XPOST $B/evolutions/evolution.1/realizations -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"agentLabel":"agent-a"}' > $T/a.json &
curl -s -XPOST $B/evolutions/evolution.1/realizations -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"agentLabel":"agent-b"}' > $T/b.json &
wait
A=$(cat $T/a.json); Bj=$(cat $T/b.json); rm -rf $T     # keep tokens and secrets in variables; never echo them
for j in "$A" "$Bj"; do echo "$j" | jq -c '{realization: .realization.id, agent: .realization.agent.id, fork: .packet.workspace.fork, baseCommit: .packet.workspace.baseCommit, expiresAt: .token.expiresAt}'; done
```

```text
{"realization":"realization.1.r2","agent":"agent-a","fork":"kit-app--r2","baseCommit":"daf5934e262aaf2634f93d220224a84203dc153d","expiresAt":"2026-10-12T15:32:19.236Z"}
{"realization":"realization.1.r1","agent":"agent-b","fork":"kit-app--r1","baseCommit":"daf5934e262aaf2634f93d220224a84203dc153d","expiresAt":"2026-10-12T15:32:18.650Z"}
```

Start work is admin only. Each start forks the app repo, waits until the fork is ready, issues a 6-hour write token
and a realization secret, and builds the task packet. The platform keeps only the secret's SHA-256; the agent sends
the secret on its checkpoint, submit, sync, status and packet calls.
When the two requests race, numbering follows arrival, so agent-a got `r2` here. The `cli` field is the canonical
start line:

```text
ARTYFACT_TOKEN=<redacted> ARTYFACT_SECRET=<redacted> npx artyfact start realization.1.r2 --system system.keep-in-touch --evolution evolution.1 --dir ./realization.1.r2
```

## 5. Two agents work (terminals **A** and **B**)

Run whichever agent you like on `TASK_PACKET.md`, or make the two edits by hand. Use the realization id from your
start response. `start` saves the secret in the clone's `.artyfact.json` (mode 0600, git-excluded), so later
commands need only `ARTYFACT_TOKEN`, and only for `submit`.

Terminal **A**:

```sh
export ARTYFACT_TOKEN=$(echo "$A" | jq -r .token.value) ARTYFACT_SECRET=$(echo "$A" | jq -r .secret)
artyfact start realization.1.r2 --system system.keep-in-touch --evolution evolution.1 --dir /tmp/kit-a
cd /tmp/kit-a
# Add the AddContactDialog (markup in public/people/index.html) and its Save handler in
# public/people/add-contact-dialog.js: POST /api/contacts, keep the values and show one ErrorSummary on failure.
artyfact checkpoint "AddContactDialog markup and save handler"
```

Terminal **B**:

```sh
export ARTYFACT_TOKEN=$(echo "$Bj" | jq -r .token.value) ARTYFACT_SECRET=$(echo "$Bj" | jq -r .secret)
artyfact start realization.1.r1 --system system.keep-in-touch --evolution evolution.1 --dir /tmp/kit-b
cd /tmp/kit-b
# Owner-only read in src/worker/routes/contacts.ts: GET /api/contacts/:id answers another owner's record
# (or a guessed id) with the same non-revealing 404.
artyfact checkpoint "Owner-only GET /api/contacts/:id with non-revealing 404"
```

```text
Workspace ready in /tmp/kit-a
Next: cd /tmp/kit-a && read TASK_PACKET.md, then npm install && npm run dev
Checkpoint with 'npx artyfact checkpoint "<msg>"'; finish with 'npx artyfact submit'.
Checkpoint recorded at 6ef491e1d7e0
```

The checkpoint commits locally and appears at once on the event stream:

```text
data: {"type":"checkpoint","realization":"realization.1.r2","checkpoint":{"seq":1,"at":"2026-10-12T09:36:07.704Z","summary":"AddContactDialog markup and save handler","commit":"6ef491e1d7e031b659230afa3a723ca9c6a602ff"},…}
```

Keep edits inside the packet's permitted paths. In this run a test file under `test/` was outside them, and the
scope check failed `C.system.promotion` for that candidate. Fixtures belong to the platform's assays.

**Optional preview for A.** The health hook probes `<previewUrl>/health`. It passes only when the body says
`status: "ok"` and `buildId` matches the candidate commit. Serve the clone with its commit as `BUILD_ID`:

```sh
cd /tmp/kit-a && ln -s "$REPO/node_modules" node_modules && printf 'node_modules\n.wrangler\n' >> .git/info/exclude
npx wrangler dev --port 8788 --var BUILD_ID:$(git rev-parse HEAD)     # leave running
```

## 6. Submit both (about 3–4 s each)

```sh
# A
artyfact submit --preview-url http://localhost:8788      # drop the flag without a preview
# B
artyfact submit
```

A:

```text
Submitted 6ef491e1d7e0
criterion                 verdict  execution
C.system.autonomy         pass     completed
C.system.concurrency      pass     completed
C.system.promotion        unknown  completed
C.system.purpose          pass     completed
C.system.purpose          unknown  not-run
C.system.readiness        pass     completed
C.system.structure        pass     completed
C.system.topology         pass     completed
C.system.topology         pass     completed
C.webapp.contact.save     unknown  not-run
C.webapp.contact.storage  unknown  not-run
C.webapp.exists           pass     completed
C.webapp.health           pass     completed
C.webapp.private.owner    unknown  not-run
C.webapp.screen.exact     unknown  not-run
C.webapp.screen.people    unknown  not-run
```

## 7. Moment 1: a soft-semantic conflict between different files

B's submit ends with the conflict:

```text
Submitted d58d0ad60f85
criterion                 verdict  execution
C.system.concurrency      unknown  completed
…
C.webapp.exists           pass     completed
C.webapp.health           unknown  not-run
…
conflict [soft-semantic] operation.contact.save: Different files, but both touch nodes operation.contact.save.
```

A's save handler maps to `affordance.AddContactDialog.save` and `operation.contact.save` through the app's
`source-map.yaml`. B's routes file maps to the operation, `policy.ownerOnly` and `entity.ContactRecord`. Health is
not-run for B because B gave no preview URL.

```sh
curl -s $B/conflicts | jq -c '.conflicts[] | {kind, candidates, nodes, paths, message, interferes: .semantic.interferes}'
```

```text
{"kind":"soft-semantic","candidates":["candidate.1.r1.d58d0ad","candidate.1.r2.6ef491e"],"nodes":["operation.contact.save"],"paths":[],"message":"Different files, but both touch nodes operation.contact.save.","interferes":0.05}
```

`interferes` is System One's judgment (fake provider here). Show the Work and Evaluations views in the UI.

A repeat submit of the same commit returns the same candidate with `created: false`. The CLI and a queue push
converge the same way.

## 8. Promote A, then B is stale (about 2 s)

```sh
curl -s -XPOST $B/promote -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{
  "candidateIds": ["candidate.1.r2.6ef491e"], "expectedHead": "sc-1-493d7308",
  "rationale": "Ship the save dialog first. Soft overlap with realization.1.r1 on operation.contact.save acknowledged; r1 rebases. Unbound assays are follow-ups."
}' | jq -c '{commit: .commit.id, parent: .commit.parent, manifest: .commit.manifest, rejected, acknowledged: .commit.decision.acknowledged}'
```

```text
{"commit":"sc-2-826c0e1b","parent":"sc-1-493d7308","manifest":[{"artifact":"artifact.webapp","type":"worker-fullstack","repo":"kit-app--r2","commit":"6ef491e1d7e031b659230afa3a723ca9c6a602ff","scope":[]}],"rejected":["candidate.1.r1.d58d0ad"],"acknowledged":["C.webapp.private.owner","C.webapp.screen.exact","C.webapp.contact.save","C.webapp.screen.people","C.webapp.contact.storage","C.system.concurrency","C.webapp.connection.consent","C.webapp.outgoing.single","C.webapp.schedule.correct","C.webapp.prompts.bounded","C.webapp.revocation.current","C.webapp.lifecycle.data"]}
```

Promotion re-runs the hooks on the exact commit with the promotion facts. The blocking set is `C.system.purpose`,
`C.system.promotion` and `C.webapp.exists`, and each passed. Everything else that is not green is an advisory,
including the soft `C.system.concurrency`. The rationale acknowledges them, and the System commit records them in
`decision.acknowledged`. An empty rationale gets 400 `advisories-unacknowledged`.

```sh
curl -s -w ' HTTP %{http_code}\n' -XPOST $B/promote -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"candidateIds":["candidate.1.r1.d58d0ad"],"expectedHead":"sc-1-493d7308","rationale":"B as well"}'
```

```text
{"error":{"code":"stale-base","message":"System head moved; reload and retry","details":{"currentHead":"sc-2-826c0e1b"}}} HTTP 409
```

B with the current head (`"expectedHead":"sc-2-826c0e1b"`) is refused as well, because it was built on the old head:

```text
{"error":{"code":"stale-base","message":"a candidate was built on an earlier System head; rebase it on the current head and resubmit","details":{"currentHead":"sc-2-826c0e1b"}}} HTTP 409
```

```sh
curl -s $B/history | jq -c '.commits[] | {id, parent, genome: .genomeCommit[:12], manifest: [.manifest[] | "\(.repo)@\(.commit[:12])"], rationale: .decision.rationale[:60]}'
```

```text
{"id":"sc-2-826c0e1b","parent":"sc-1-493d7308","genome":"014554b3301d","manifest":["kit-app--r2@6ef491e1d7e0"],"rationale":"Ship the save dialog first. Soft overlap with realization.1."}
{"id":"sc-1-493d7308","parent":null,"genome":"014554b3301d","manifest":["kit-app@daf5934e262a"],"rationale":"import kit-system@014554b + kit-app@daf5934"}
```

## 9. Genome amendment: start C (about 4 s)

```sh
C=$(curl -s -XPOST $B/evolutions/evolution.5/realizations -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"agentLabel":"agent-c","target":"genome"}')
echo "$C" | jq -c '{realization: .realization.id, target: .realization.target, fork: .packet.workspace.fork}'
export ARTYFACT_TOKEN=$(echo "$C" | jq -r .token.value) ARTYFACT_SECRET=$(echo "$C" | jq -r .secret)
artyfact start realization.5.r3 --system system.keep-in-touch --evolution evolution.5 --dir /tmp/kit-c
cd /tmp/kit-c
```

```text
{"realization":"realization.5.r3","target":"genome","fork":"kit-system--r3"}
```

Make the two edits:

- In `things/webapp/ontology.yaml`, firm up `entity.MessageDraft` by removing `provisional: true` and adding
  `- { name: recipients, type: "list<ref:entity.Account>" }`. The private-pairs rule skips provisional entities, so
  the field alone on a provisional entity raises nothing.
- In `description.yaml`, reword `commitment.no-engagement-mechanics` to "The core contract has no streak penalties,
  no public relationship scores and no group discussion; missing a goal is never punished."

```sh
artyfact submit
```

```text
Submitted 81e7dbad2bda
criterion             verdict  execution
C.system.autonomy     pass     completed
C.system.concurrency  pass     completed
C.system.promotion    fail     completed
C.system.purpose      pass     completed
C.system.purpose      unknown  not-run
C.system.readiness    pass     completed
C.system.structure    pass     completed
C.system.topology     fail     completed
C.system.topology     pass     completed
```

`C.system.promotion` fails its scope check because `description.yaml` is outside evolution.5's permitted paths. The
admin decides on Genome candidates, so this is shown and not enforced.

## 10. Moment 2: deliberate choice vs violation

```sh
curl -s $B/realizations/realization.5.r3/review | jq '{
  delta: [.delta.changes[] | "\(.id) \(.fieldsChanged)"],
  violations: [.readinessCandidate.findings[] | select(.level == "error") | {rule, subject, message, derivation: (.derivation | {rule, children: [.children[].tuple]})}],
  systemOne: [.review[] | {id, class: .changeClass.choice, hardRule: .changeClass.probabilities["hard-rule-violation"], weakens, level, verdict, provider: .provenance.provider}]
}'
```

Condensed output:

```text
delta:      commitment.no-engagement-mechanics ["statement"]; entity.MessageDraft ["fields","provisional"]
violation:  topology.recipientArray entity.MessageDraft - entity.MessageDraft sends to a list of recipients, which the private-pairs topology forbids.
derivation: topology.private-pairs@1:28 <- node(entity.MessageDraft, entity, thing.webapp), entityField(entity.MessageDraft, recipients, list<ref:entity.Account>)
System One: commitment.no-engagement-mechanics class=deliberate-nonstandard-choice p(hard-rule-violation)=0.017 weakens=0.05 level=info verdict=pass provider=fake
System One: entity.MessageDraft               class=deliberate-nonstandard-choice p(hard-rule-violation)=0.017 weakens=0.05 level=info verdict=pass provider=fake
```

The wording change is judged a deliberate choice. The recipients list is a deterministic violation with its proof
tree. A fake judgment does not override the rules, and the review panel in the UI shows both side by side.

Remove the `recipients` line, keep the rest, and submit again:

```sh
artyfact submit        # C.system.topology: pass, pass
curl -s -XPOST $B/evolutions/evolution.5/accept -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"realizationId":"realization.5.r3","interpretation":"The commitment rewording is a deliberate clarification. The recipients list was removed after topology.recipientArray; MessageDraft stays one-to-one."}' \
  | jq -c '{genomeCommit, status: .realization.status, commit: .commit.id, parent: .commit.parent}'
curl -s "$B/model?rev=head" | jq -c '{genomeCommit, errors: [.readiness.findings[] | select(.level == "error")] | length}'
```

```text
{"genomeCommit":"5d67c9146ed648e847849993d217eb7968cda3f6","status":"promoted","commit":"sc-3-77574d87","parent":"sc-2-826c0e1b"}
{"genomeCommit":"5d67c9146ed648e847849993d217eb7968cda3f6","errors":0}
```

The model now renders from the accepted fork commit, and the new commitment wording is in it. History shows
`sc-3-77574d87` on top, with the Genome at `5d67c91…` and the app still at `kit-app--r2@6ef491e`.

## Queue path

Artifacts emits `pushed` only from a **repository-level** event subscription (`--source artifacts.repo` with
`--source-namespace` and `--source-repo-name`). The account-level `artifacts` source has `repo.created`,
`repo.forked`, `repo.imported` and `repo.deleted`, but no push. So pushes to a new fork reach
`artyfact-artifacts-events` only after someone creates a subscription for that fork:

```sh
npx wrangler queues subscription create artyfact-artifacts-events --source artifacts.repo --events pushed \
  --source-namespace artyfact --source-repo-name kit-app--r1
```

The local dev server also never receives messages from a remote queue. **`artyfact submit` is therefore the primary
path.** The queue consumer is a deployed-only convenience. Wiring it needs a subscription per fork at start, which in
turn needs an API token in the Worker, and that is not built. When a push and a CLI submit both arrive, they
converge on one candidate per (realization, commit). The route tests cover that, including duplicate delivery.

## Timings (this run)

| Step | Time |
|---|---|
| bootstrap, namespace present | 15.6 s |
| dev server ready | 9 s (about 15 s on the very first start) |
| import | 2.2 s |
| start realization: fork, ready, token, packet | about 4 s |
| `artyfact start` (clone) | 1.1–2.5 s |
| `artyfact checkpoint` | under 1 s |
| `artyfact submit`, app | 3.4–3.9 s |
| `artyfact submit`, Genome | 5.1 s |
| promote | 1.6 s |
| integration test, end to end | 58 s |

## Integration test

```sh
cf artifacts namespaces create --namespace artyfact-test      # once
cd apps/platform && ARTYFACT_INTEGRATION=1 npx vitest run --project integration
```

The test bootstraps uniquely named repos into `artyfact-test` and runs its own `wrangler dev`
(`wrangler.integration.jsonc`). It drives import, two starts, two real CLI starts and submits, the conflict,
promotion, the 409 and history. Then it deletes every repo it created. Without the flag it is skipped.

## Troubleshooting

- **Token expired (401/403 from git):** start tokens last 6 hours (`expiresAt` in the start response). Issue a fresh
  one for the fork and export it, without echoing it:
  `export ARTYFACT_TOKEN=$(npx wrangler artifacts repos issue-token kit-app--r1 --namespace artyfact --scope write --ttl 3600 --json | jq -r .plaintext)`.
  The JSON fields are `id`, `plaintext`, `scope` and `expires_at`. The plaintext looks like `art_v1_<hex>?expires=<unix>`.
- **401/403 from a platform call:** start work needs `-H "authorization: Bearer $ADMIN_TOKEN"`. The CLI's calls
  need the realization secret: it is in the clone's `.artyfact.json`, or set `ARTYFACT_SECRET` from the start
  response. Another realization's secret, or the secret of a rejected realization, answers 403.
- **Fork not ready:** start waits up to 20 s for the fork and then answers with an error. Forks were ready within
  the 4 s start in every run here. Retry the start. The failed realization is abandoned and its token revoked.
- **409 `fork-exists` on start:** a fork with that name is left over from an earlier run and has moved past the base
  commit. This happens after you reset the platform state while the namespace still holds forks. Delete the old
  forks, or reset fully (below).
- **Health `fail` with "buildId does not match the commit":** the preview served another `BUILD_ID`. In this run the
  first preview served `dev`. Restart it with `--var BUILD_ID:$(git rev-parse HEAD)`. Promotion re-runs the probe.
- **Wrangler version:** run `npx wrangler --version`. It must be 4.145 or later; 4.149.0 is verified.
- **`cf artifacts namespaces create` prints help:** the name goes in `--namespace <name>`, not as a positional
  argument.
- **Schema mismatch after pulling new code:** stop the dev server and delete `apps/platform/.wrangler/state`. There
  are no Durable Object migrations yet. Then reset the namespace too, or the old forks trigger `fork-exists`.
- **Dev server exits after a branch switch or `npm install`:** restart `npm run dev`. The Durable Object state
  survives restarts.
- **Missed events in the UI:** server-sent events are not replayed. Reload the page, or rely on the UI's polling.

## Reset

```sh
# stop the dev server first
for r in $(npx wrangler artifacts repos list --namespace artyfact --json | jq -r '.[].name'); do
  npx wrangler artifacts repos delete "$r" --namespace artyfact --force
done
rm -rf apps/platform/.wrangler/state /tmp/kit-a /tmp/kit-b /tmp/kit-c
```

Then start again at step 1.
