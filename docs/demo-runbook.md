# Demo runbook

The whole loop against the real Cloudflare Artifacts service, in order. Every output below comes from one real run
on 2026-10-12 (wrangler 4.149.0, namespace `artyfact`, repos `keep-in-touch.genome`, `keep-in-touch.app` and `platform`), with
tokens and secrets redacted. Commit ids and timestamps will differ on your run. Realization numbers start at r3 here because
the namespace still held forks `keep-in-touch.app--r1` and `--r2` from an earlier run on a reset platform state: start
skips any number whose fork already exists.

The two moments to show on video:

1. **Different files, same meaning** (step 7). Agent A edits the dialog's save handler and agent B edits the
   contacts routes. No file is shared, yet the platform reports a soft-semantic conflict on `operation.contact.save`.
2. **Violation vs deliberate choice** (steps 9 and 10). Amendment 1 gives `MessageDraft` a recipients list. The rules
   engine proves a `topology.recipientArray` violation with its derivation, accept is refused, and the admin rejects
   it. Amendment 2 rewords a commitment. The rules pass, the System One signals are shown, and the admin accepts it.

**What is deterministic and what is not.** Rule findings, derivations, scope, conflicts by node overlap and the
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

**In every terminal you open** (P, ops, sse, A, B, C), run this from the checkout. Terminals share nothing else:
start responses are written to owner-only files in `$RUN`, and each terminal reads the one it needs.

```sh
export REPO=$PWD RUN=$HOME/.artyfact-demo B=localhost:1337/api/systems/system.keep-in-touch
mkdir -p -m 700 "$RUN"; umask 077
alias artyfact='npx --prefix "$REPO" --no-install artyfact'
```

**Only in terminal ops**, the one the admin uses, load the admin token. The agent terminals A, B and C never get
it: an agent holds only its own fork token and realization secret, so it cannot start, promote, accept or reject.

```sh
export ADMIN_TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' "$REPO/apps/platform/.dev.vars")
export ARTYFACT_ADMIN_TOKEN=$ADMIN_TOKEN                # what `artyfact init` reads
```

## 1. Platform (about 10 s)

Terminal **P**:

```sh
npm run dev -w @artyfact/platform          # http://localhost:1337, Artifacts binding is remote
```

## 2. `artyfact init`: push and import in one command (about 30 s)

Terminal **ops**:

```sh
./scripts/bootstrap.sh       # = npx artyfact init --genome examples/keep-in-touch-system --app examples/keep-in-touch-app
```

`init` reads `system.yaml` and derives every name from the System id: slug `keep-in-touch`, repos
`keep-in-touch.genome` and `keep-in-touch.app`, forks `<repo>--r<N>`. It checks that `npx wrangler whoami` and
`cf auth whoami` show the same account and prints only its prefix. It creates the namespace and repos when missing,
creates `platform` (templates and rule packs) when it is missing or empty, pushes both projects with short-lived write tokens, and calls
`POST /api/systems/import` with `$ARTYFACT_ADMIN_TOKEN`. Tokens reach git only through `GIT_CONFIG_*` variables,
never an argv or the output. A project laid out as `<dir>/system` and `<dir>/app` runs `npx artyfact init --dir <dir>`.

On this namespace the first run stopped, because the Genome repo still held an earlier push made by the old bootstrap
script, whose tree also carried the package's `dist/` build output:

```text
system.keep-in-touch -> keep-in-touch.genome, keep-in-touch.app (namespace artyfact)
account 1bae12d5… (wrangler and cf agree)
namespace artyfact: exists
  created repo platform
platform: created at 6bd3603921dc
artyfact: keep-in-touch.genome has commits this checkout did not push (head ffb68c7) and its tree differs from …/examples/keep-in-touch-system.
init never builds over unknown history: merge that history into your project first, or re-run with --adopt to commit your project on top of ffb68c7 (a fast-forward).
```

`--adopt` commits the project on top of that head:

```sh
./scripts/bootstrap.sh --adopt
```

```text
system.keep-in-touch -> keep-in-touch.genome, keep-in-touch.app (namespace artyfact)
account 1bae12d5… (wrangler and cf agree)
namespace artyfact: exists
platform: unchanged at 6bd3603921dc
keep-in-touch.genome: pushed at 18374568e231
keep-in-touch.app: unchanged at c945510ffdf5
imported system.keep-in-touch at sc-1-b11cb27a
System: http://localhost:1337/s/system.keep-in-touch/r/head/overview
```

That run predates the 1337 default; its last line said `5173` and was edited. `platform` was still pushed by every
run then.

A later run pushes nothing and re-imports with `force: false`, a no-op on the same commits. `platform` already exists,
so `init` leaves it alone. This run is verbatim. It went to a second local platform on port 1339, so it passed
`--platform http://localhost:1339`, and the printed URL shows the port the operator passed. With the default it is
1337. The head is `sc-3-c00256a3` because steps 3 to 11 had run on this namespace since:

```text
system.keep-in-touch -> keep-in-touch.genome, keep-in-touch.app (namespace artyfact)
account 1bae12d5… (wrangler and cf agree)
namespace artyfact: exists
platform: exists at 6bd3603921dc, left alone (update it with 'npx artyfact platform-sync --namespace artyfact')
keep-in-touch.genome: unchanged at 18374568e231
keep-in-touch.app: unchanged at c945510ffdf5
imported system.keep-in-touch at sc-3-c00256a3
System: http://localhost:1339/s/system.keep-in-touch/r/head/overview
```

On an empty namespace the first run creates everything and imports in one go. If the import answers 409
`already-imported` (the repos moved since the last import), `init` says to re-run with `--force`. Without
`ARTYFACT_ADMIN_TOKEN` it pushes, prints the exact `curl` import line with a `$ARTYFACT_ADMIN_TOKEN` placeholder, and
exits 0.

The import response records the `platform` commit; each later System commit carries it too:

```sh
curl -s -XPOST localhost:1337/api/systems/import -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"systemId":"system.keep-in-touch"}' | jq -c '{head, genomeRepo, appRepo, platform, warnings, evolutions}'
```

```text
{"head":"sc-1-b11cb27a","genomeRepo":"keep-in-touch.genome","appRepo":"keep-in-touch.app","platform":{"repo":"platform","commit":"6bd3603921dcd7e3916906a0ff38a7510195bf1a"},"warnings":[],"evolutions":["evolution.1","evolution.2","evolution.3","evolution.4","evolution.5","evolution.6"]}
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
curl -sN localhost:1337/api/systems/system.keep-in-touch/events
```

The stream sends only live events plus a `ping` every 15 s. Events emitted while nothing is connected are not
replayed, so the UI refetches after it reconnects.

## 4. Two concurrent realizations on evolution.1 (about 4 s each)

Terminal **ops**. Start work is admin only.

```sh
curl -s -XPOST $B/evolutions/evolution.1/realizations -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"agentLabel":"agent-a"}' -o $RUN/a.json &
curl -s -XPOST $B/evolutions/evolution.1/realizations -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"agentLabel":"agent-b"}' -o $RUN/b.json &
wait
for f in a b; do jq -c '{realization: .realization.id, agent: .realization.agent.id, fork: .packet.workspace.fork, baseCommit: .packet.workspace.baseCommit, expiresAt: .token.expiresAt}' $RUN/$f.json; done
```

```text
{"realization":"realization.1.r3","agent":"agent-a","fork":"keep-in-touch.app--r3","baseCommit":"c945510ffdf5c5d8a9e93ce663bd10f88714632c","expiresAt":"2026-10-12T21:53:01.637Z"}
{"realization":"realization.1.r4","agent":"agent-b","fork":"keep-in-touch.app--r4","baseCommit":"c945510ffdf5c5d8a9e93ce663bd10f88714632c","expiresAt":"2026-10-12T21:53:02.176Z"}
```

Each start forks the app repo, waits until the fork is ready, issues a 6-hour write token and a realization secret,
and builds the task packet. The platform keeps only the secret's SHA-256; the agent sends the secret on its
checkpoint, submit, sync, status and packet calls. When the two requests race, numbering follows arrival. The `cli`
field is the canonical start line:

```text
ARTYFACT_TOKEN=<redacted> ARTYFACT_SECRET=<redacted> npx artyfact start realization.1.r3 --system system.keep-in-touch --evolution evolution.1 --dir ./realization.1.r3
```

## 5. Two agents work (terminals **A** and **B**)

Run whichever agent you like on `TASK_PACKET.md`, or make the two edits by hand. `start` saves the secret in the
clone's `.artyfact.json` (mode 0600, git-excluded), so later commands need only `ARTYFACT_TOKEN`, and only for
`submit`.

Terminal **A**:

```sh
export ARTYFACT_TOKEN=$(jq -r .token.value $RUN/a.json) ARTYFACT_SECRET=$(jq -r .secret $RUN/a.json)
artyfact start realization.1.r3 --system system.keep-in-touch --evolution evolution.1 --dir /tmp/kit-a
cd /tmp/kit-a
# Add the AddContactDialog (markup in public/people/index.html) and its Save handler in
# public/people/add-contact-dialog.js: POST /api/contacts, keep the values and show one ErrorSummary on failure.
artyfact checkpoint "AddContactDialog markup and save handler"
```

Terminal **B**:

```sh
export ARTYFACT_TOKEN=$(jq -r .token.value $RUN/b.json) ARTYFACT_SECRET=$(jq -r .secret $RUN/b.json)
artyfact start realization.1.r4 --system system.keep-in-touch --evolution evolution.1 --dir /tmp/kit-b
cd /tmp/kit-b
# Owner-only read in src/worker/routes/contacts.ts: GET /api/contacts/:id answers another owner's record
# (or a guessed id) with the same non-revealing 404.
artyfact checkpoint "Owner-only GET /api/contacts/:id with non-revealing 404"
```

```text
Workspace ready in /tmp/kit-a
Next: cd /tmp/kit-a && read TASK_PACKET.md, then npm install && npm run dev
Checkpoint with 'npx artyfact checkpoint "<msg>"'; finish with 'npx artyfact submit'.
Checkpoint recorded at df7eba46bb31
```

The checkpoint commits locally and appears at once on the event stream:

```text
data: {"type":"checkpoint","realization":"realization.1.r3","checkpoint":{"seq":1,"at":"2026-10-12T15:53:42.877Z","summary":"AddContactDialog markup and save handler","commit":"df7eba46bb317d2d8437a27492eb1482e13f3fe1"},…}
```

Keep edits inside the packet's permitted paths; the scope check fails `C.system.promotion` for anything outside.

**Optional preview for A.** The health hook probes `<previewUrl>/health`. It passes only when the body says
`status: "ok"` and `buildId` matches the candidate commit. In terminal A, serve the clone with its commit as
`BUILD_ID` and leave it running in a spare terminal:

```sh
cd /tmp/kit-a && ln -s "$REPO/node_modules" node_modules && printf 'node_modules\n.wrangler\n' >> .git/info/exclude
npx wrangler dev --port 8788 --var BUILD_ID:$(git rev-parse HEAD)
```

## 6. Submit both (about 3–4 s each)

```sh
# terminal A
artyfact submit --preview-url http://localhost:8788      # drop the flag without a preview
# terminal B
artyfact submit
```

A:

```text
Submitted df7eba46bb31
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

`C.system.promotion` is `unknown` at submit: base-current, manifest-exact and evidence-fresh can only be established
at promotion. The `not-run` rows are assays that run in CI, not in the platform.

## 7. Moment 1: a soft-semantic conflict between different files

B's submit ends with the conflict:

```text
Submitted 8ca7b2a6a231
criterion                 verdict  execution
C.system.concurrency      unknown  completed
…
C.webapp.health           unknown  not-run
…
conflict [soft-semantic] operation.contact.save: Different files, but both touch nodes operation.contact.save.
```

```sh
curl -s $B/conflicts | jq -c '.conflicts[] | {kind, candidates, nodes, paths, message, interferes: .semantic.interferes}'
```

```text
{"kind":"soft-semantic","candidates":["candidate.1.r4.8ca7b2a","candidate.1.r3.df7eba4"],"nodes":["operation.contact.save"],"paths":[],"message":"Different files, but both touch nodes operation.contact.save.","interferes":0.05}
```

**Narration.** The conflict is deterministic. A's save handler maps to `affordance.AddContactDialog.save` and
`operation.contact.save` through the app's `source-map.yaml`; B's routes file maps to the same operation,
`policy.ownerOnly` and `entity.ContactRecord`. `paths` is empty because no file is shared. `interferes: 0.05` is
System One's answer to "do these changes interfere?", and 0.05 means "no". That number is from the fake provider,
whose canned answer is always the benign one, so say on video that the overlap is the platform's finding and the
interference judgment is fake here. Health is `not-run` for B because B gave no preview URL. Show the Work and
Evaluations views.

A repeat submit of the same commit converges on the same candidate:

```sh
cd /tmp/kit-a && artyfact submit --json | jq -c '{created, candidate: .candidate.id}'
```

```text
{"created":false,"candidate":"candidate.1.r3.df7eba4"}
```

## 8. Promote A, then B is stale (about 2 s)

Terminal **ops**:

```sh
curl -s -XPOST $B/promote -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{
  "candidateIds": ["candidate.1.r3.df7eba4"], "expectedHead": "sc-1-b11cb27a",
  "rationale": "Ship the save dialog first. Soft overlap with realization.1.r4 on operation.contact.save acknowledged; r4 rebases. Unbound assays are follow-ups."
}' | jq -c '{commit: .commit.id, parent: .commit.parent, manifest: .commit.manifest, rejected, acknowledged: .commit.decision.acknowledged, evidenceProviders: .commit.decision.evidenceProviders}'
```

```text
{"commit":"sc-2-88b3ec84","parent":"sc-1-b11cb27a","manifest":[{"artifact":"artifact.webapp","type":"worker-fullstack","repo":"keep-in-touch.app--r3","commit":"df7eba46bb317d2d8437a27492eb1482e13f3fe1","scope":[]}],"rejected":["candidate.1.r4.8ca7b2a"],"acknowledged":["C.webapp.private.owner","C.webapp.screen.exact","C.webapp.contact.save","C.webapp.screen.people","C.webapp.contact.storage","C.system.concurrency","C.webapp.connection.consent","C.webapp.outgoing.single","C.webapp.schedule.correct","C.webapp.prompts.bounded","C.webapp.revocation.current","C.webapp.lifecycle.data"],"evidenceProviders":["fake"]}
```

Promotion re-runs the hooks on the exact commit with the promotion facts. The blocking set (hard criteria with a bound
hook, plus the Evolution's acceptance criteria) for evolution.1 is `C.webapp.exists`, `C.system.structure`,
`C.system.purpose`, `C.system.topology`, `C.system.readiness` and `C.system.promotion`, and each passed. `C.system.purpose`'s outcome hook only runs after deployment, so its `not-run` row is disregarded; any
other non-pass row would block. Everything else that is not green is an advisory, acknowledged by the rationale and
recorded in `decision.acknowledged`; an empty rationale gets 400 `advisories-unacknowledged`.
`evidenceProviders: ["fake"]` records that the System One judgments behind the gate were canned.

```sh
curl -s -w ' HTTP %{http_code}\n' -XPOST $B/promote -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"candidateIds":["candidate.1.r4.8ca7b2a"],"expectedHead":"sc-1-b11cb27a","rationale":"B as well"}'
```

```text
{"error":{"code":"stale-base","message":"System head moved; reload and retry","details":{"currentHead":"sc-2-88b3ec84"}}} HTTP 409
```

B with the current head (`"expectedHead":"sc-2-88b3ec84"`) is refused as well, because it was built on the old head:

```text
{"error":{"code":"stale-base","message":"a candidate was built on an earlier System head; rebase it on the current head and resubmit","details":{"currentHead":"sc-2-88b3ec84"}}} HTTP 409
```

## 9. Moment 2, amendment 1: a rules violation, refused and rejected

evolution.5 is a Genome amendment; its scope covers `things/webapp/ontology.yaml`, `description.yaml` (it lists
`commitment.no-engagement-mechanics`) and `evolutions/**`. Terminal **ops** starts the work:

```sh
curl -s -XPOST $B/evolutions/evolution.5/realizations -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"agentLabel":"agent-c","target":"genome"}' -o $RUN/c1.json
jq -c '{realization: .realization.id, target: .realization.target, fork: .packet.workspace.fork, permittedPaths: .packet.permittedPaths}' $RUN/c1.json
```

Terminal **C**:

```sh
export ARTYFACT_TOKEN=$(jq -r .token.value $RUN/c1.json) ARTYFACT_SECRET=$(jq -r .secret $RUN/c1.json)
artyfact start realization.5.r5 --system system.keep-in-touch --evolution evolution.5 --dir /tmp/kit-c1
cd /tmp/kit-c1
```

```text
{"realization":"realization.5.r5","target":"genome","fork":"keep-in-touch.genome--r5","permittedPaths":["things/webapp/ontology.yaml","description.yaml","evolutions/**"]}
```

In `things/webapp/ontology.yaml`, firm up `entity.MessageDraft`: remove `provisional: true` and add
`- { name: recipients, type: "list<ref:entity.Account>" }`. (The private-pairs rule skips provisional entities, so
the field alone raises nothing.)

```sh
artyfact submit
```

```text
Submitted 9a83f5e66165
criterion             verdict  execution
C.system.autonomy     pass     completed
C.system.concurrency  pass     completed
C.system.promotion    unknown  completed
C.system.purpose      pass     completed
C.system.purpose      unknown  not-run
C.system.readiness    pass     completed
C.system.structure    pass     completed
C.system.topology     fail     completed
C.system.topology     pass     completed
```

The review shows the delta, the violation with its proof tree, and System One's signals:

```sh
curl -s $B/realizations/realization.5.r5/review | jq -c '{
  delta: [.delta.changes[] | "\(.id) \(.fieldsChanged)"],
  violations: [.readinessCandidate.findings[] | select(.level == "error") | {rule, subject, message, derivation: (.derivation | {rule, children: [.children[].tuple]})}],
  systemOne: [.review[] | {id, class: .changeClass.choice, hardRule: .changeClass.probabilities["hard-rule-violation"], weakens, level, verdict, provider: .provenance.provider}]
}'
```

```text
{"delta":["entity.MessageDraft [\"fields\",\"provisional\"]"],"violations":[{"rule":"topology.recipientArray","subject":"entity.MessageDraft","message":"entity.MessageDraft sends to a list of recipients, which the private-pairs topology forbids.","derivation":{"rule":"topology.private-pairs@1:28","children":[["entity.MessageDraft","entity","thing.webapp"],["entity.MessageDraft","recipients","list<ref:entity.Account>"]]}}],"systemOne":[{"id":"entity.MessageDraft","class":"deliberate-nonstandard-choice","hardRule":0.01666666666666668,"weakens":0.05,"level":"info","verdict":"pass","provider":"fake"}]}
```

**Narration.** The violation is the rules engine's: `topology.recipientArray`, derived from two facts about
`entity.MessageDraft`. The System One row says "deliberate choice", and it is labelled `provider: "fake"`: the fake
gives every change the benign class, so here it is plainly wrong. A real System One run would be expected to
classify this as a hard-rule violation. The gate does not depend on it either way. Terminal **ops**:

```sh
curl -s -w ' HTTP %{http_code}\n' -XPOST $B/evolutions/evolution.5/accept -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"realizationId":"realization.5.r5","interpretation":"accept anyway"}'
```

```text
{"error":{"code":"blocked","message":"blocking criteria (hard, with a bound hook) lack pass+completed evaluations","details":{"blocking":[{"candidate":"candidate.5.r5.9a83f5e","criterion":"C.system.topology","severity":"hard","verdict":"fail","execution":"completed"}],"advisories":[]}}} HTTP 409
```

Accept applies the promotion gate to the Genome candidate (its model-level criteria, scope included): scope passes,
topology blocks. The admin rejects it with a reason:

```sh
curl -s -XPOST $B/realizations/realization.5.r5/reject -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"reason":"topology.recipientArray: a recipients list on MessageDraft breaks the private-pairs topology. Drafts stay addressed to exactly one person."}' \
  | jq -c '{status: .realization.status, reason: .realization.rejectionReason}'
```

Terminal **C**:

```sh
artyfact status
```

```text
{"status":"rejected","reason":"topology.recipientArray: a recipients list on MessageDraft breaks the private-pairs topology. Drafts stay addressed to exactly one person."}
artyfact: GET /api/systems/system.keep-in-touch/evolutions/evolution.5/realizations/realization.5.r5 -> 403 forbidden: realization secret does not match
```

Reject revokes the fork's write token and the realization secret together, so agent C can no longer push or report.

## 10. Moment 2, amendment 2: a deliberate choice, accepted

A new realization. Terminal **ops**:

```sh
curl -s -XPOST $B/evolutions/evolution.5/realizations -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"agentLabel":"agent-d","target":"genome"}' -o $RUN/c2.json
```

Terminal **C**:

```sh
export ARTYFACT_TOKEN=$(jq -r .token.value $RUN/c2.json) ARTYFACT_SECRET=$(jq -r .secret $RUN/c2.json)
artyfact start realization.5.r6 --system system.keep-in-touch --evolution evolution.5 --dir /tmp/kit-c2
cd /tmp/kit-c2
```

In `description.yaml`, reword `commitment.no-engagement-mechanics` to "The core contract has no streak penalties, no
public relationship scores and no group discussion; missing a goal is never punished."

```sh
artyfact submit
```

```text
Submitted 49611c90d45f
criterion             verdict  execution
C.system.autonomy     pass     completed
C.system.concurrency  pass     completed
C.system.promotion    unknown  completed
C.system.purpose      pass     completed
C.system.purpose      unknown  not-run
C.system.readiness    pass     completed
C.system.structure    pass     completed
C.system.topology     pass     completed
C.system.topology     pass     completed
```

The same review query:

```text
{"delta":["commitment.no-engagement-mechanics [\"statement\"]"],"violations":[],"systemOne":[{"id":"commitment.no-engagement-mechanics","class":"deliberate-nonstandard-choice","hardRule":0.01666666666666668,"weakens":0.05,"level":"info","verdict":"pass","provider":"fake"}]}
```

**Narration.** No rule fires, and the change is inside evolution.5's scope. System One's signals (class, weakens,
contradicts per commitment, specificity) are shown in the review panel and labelled fake. The decision to treat the
rewording as deliberate is the admin's, recorded as the interpretation. Terminal **ops**:

```sh
curl -s -XPOST $B/evolutions/evolution.5/accept -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"realizationId":"realization.5.r6","interpretation":"Deliberate restatement: the commitment now names group discussion explicitly and says a missed goal is never punished. Meaning is unchanged for one-to-one contact."}' \
  | jq -c '{genomeCommit, status: .realization.status, commit: .commit.id, parent: .commit.parent, policy: .commit.decision.policy, evidenceProviders: .commit.decision.evidenceProviders}'
curl -s "$B/model?rev=head" | jq -c '{genomeCommit, errors: ([.readiness.findings[] | select(.level == "error")] | length), commitment: (.model.description.commitments[] | select(.id == "commitment.no-engagement-mechanics") | .statement)}'
```

```text
{"genomeCommit":"49611c90d45fcaa2be54c6774622367866d56d2d","status":"promoted","commit":"sc-3-c00256a3","parent":"sc-2-88b3ec84","policy":"admin-accept","evidenceProviders":["fake"]}
{"genomeCommit":"49611c90d45fcaa2be54c6774622367866d56d2d","errors":0,"commitment":"The core contract has no streak penalties, no public relationship scores and no group discussion; missing a goal is never punished."}
```

```sh
curl -s $B/history | jq -c '.commits[] | {id, parent, genome: .genomeCommit[:12], manifest: [.manifest[] | "\(.repo)@\(.commit[:12])"], policy: .decision.policy, providers: .decision.evidenceProviders}'
```

```text
{"id":"sc-3-c00256a3","parent":"sc-2-88b3ec84","genome":"49611c90d45f","manifest":["keep-in-touch.app--r3@df7eba46bb31"],"policy":"admin-accept","providers":["fake"]}
{"id":"sc-2-88b3ec84","parent":"sc-1-b11cb27a","genome":"18374568e231","manifest":["keep-in-touch.app--r3@df7eba46bb31"],"policy":"admin","providers":["fake"]}
{"id":"sc-1-b11cb27a","parent":null,"genome":"18374568e231","manifest":["keep-in-touch.app@c945510ffdf5"],"policy":"import","providers":null}
```

The model now renders from the accepted fork commit. History marks `sc-2` and `sc-3` "System One: fake provider".

When you are done, delete the saved start responses, which hold tokens and secrets: `rm -rf "$RUN"`.

## Queue path

Artifacts emits `pushed` only from a **repository-level** event subscription (`--source artifacts.repo` with
`--source-namespace` and `--source-repo-name`). The account-level `artifacts` source has `repo.created`,
`repo.forked`, `repo.imported` and `repo.deleted`, but no push. So pushes to a new fork reach
`artyfact-artifacts-events` only after someone creates a subscription for that fork:

```sh
npx wrangler queues subscription create artyfact-artifacts-events --source artifacts.repo --events pushed \
  --source-namespace artyfact --source-repo-name keep-in-touch.app--r3
```

The local dev server also never receives messages from a remote queue. **`artyfact submit` is therefore the primary
path.** The queue consumer is a deployed-only convenience. Wiring it needs a subscription per fork at start, which in
turn needs an API token in the Worker, and that is not built. When a push and a CLI submit both arrive, they
converge on one candidate per (realization, commit). The route tests cover that, including duplicate delivery.

## Timings (this run)

| Step | Time |
|---|---|
| dev server ready | about 1 s warm, 15 s on the very first start |
| `artyfact init`, namespace present (push, platform, import) | 22–31 s |
| two concurrent starts: fork, ready, token, packet | 10 s together; a single start about 6 s |
| `artyfact start` (clone) | 2.2–3.2 s |
| `artyfact checkpoint` | under 1 s |
| `artyfact submit`, app | 5.9–8.1 s |
| `artyfact submit`, Genome | 8.2 s |
| promote | 2.3 s |
| integration test, end to end (includes `init`) | 102–128 s |

## Integration test

```sh
cf artifacts namespaces create --namespace artyfact-test      # once
cd apps/platform && ARTYFACT_INTEGRATION=1 npx vitest run --project integration
```

The test runs its own `wrangler dev` (`wrangler.integration.jsonc`), then `artyfact init` on a copy of the example
renamed `system.itest-keep-in-touch-<run>`, so the repos are `itest-keep-in-touch-<run>.genome` and `.app` in
`artyfact-test`, next to that namespace's shared `platform` repo. It drives two starts, two real CLI starts and
submits, the conflict, promotion, the 409 and history. Then it deletes the repos and forks of its own run, never
`platform`. Without the flag it is skipped.

## Troubleshooting

- **Token expired (401/403 from git):** start tokens last 6 hours (`expiresAt` in the start response). Issue a fresh
  one for the fork and export it, without echoing it:
  `export ARTYFACT_TOKEN=$(npx wrangler artifacts repos issue-token keep-in-touch.app--r3 --namespace artyfact --scope write --ttl 3600 --json | jq -r .plaintext)`.
  The JSON fields are `id`, `plaintext`, `scope` and `expires_at`. The plaintext looks like `art_v1_<hex>?expires=<unix>`.
- **401/403 from a platform call:** start work needs `-H "authorization: Bearer $ADMIN_TOKEN"`. The CLI's calls
  need the realization secret: it is in the clone's `.artyfact.json`, or set `ARTYFACT_SECRET` from the start
  response. Another realization's secret, or the secret of a rejected realization, answers 403.
- **Fork not ready:** start waits up to 20 s for the fork and then answers with an error. Forks were ready within
  the 4 s start in every run here. Retry the start. The failed realization is abandoned and its token revoked.
- **Realization numbers jump (r3 instead of r1):** forks from an earlier platform state are still in the namespace.
  Start skips every number whose fork repo exists, so nothing is overwritten or deleted. A 409 `fork-exists` is
  still possible if two starts race past that check; retry the start.
- **`init` stops with "has commits this checkout did not push":** someone pushed to the repo, or it was pushed
  before this checkout recorded its own pushes in `.artyfact/init.json`. Merge that history into the project, or
  re-run with `--adopt` to commit the project on top (a fast-forward; init never force-pushes).
- **Health `fail` with "buildId does not match the commit":** the preview served another `BUILD_ID`. In this run the
  first preview served `dev`. Restart it with `--var BUILD_ID:$(git rev-parse HEAD)`. Promotion re-runs the probe.
- **Wrangler version:** run `npx wrangler --version`. It must be 4.145 or later; 4.149.0 is verified.
- **`cf artifacts namespaces create` prints help:** the name goes in `--namespace <name>`, not as a positional
  argument.
- **Schema mismatch after pulling new code:** stop the dev server and move `apps/platform/.wrangler/state` aside.
  There are no Durable Object migrations yet. Old forks in the namespace are skipped by number.
- **Dev server exits after a branch switch or `npm install`:** restart `npm run dev`. The Durable Object state
  survives restarts.
- **Missed events in the UI:** server-sent events are not replayed. Reload the page, or rely on the UI's polling.

## Reset

```sh
# stop the dev server first
for r in $(npx wrangler artifacts repos list --namespace artyfact --json | jq -r '.[].name'); do
  npx wrangler artifacts repos delete "$r" --namespace artyfact --force
done
rm -rf apps/platform/.wrangler/state /tmp/kit-a /tmp/kit-b /tmp/kit-c1 /tmp/kit-c2 "$RUN"
```

Then start again at step 1. To start over without deleting anything in the account, stop the dev server and move
`apps/platform/.wrangler/state` aside instead: `init` finds the repos unchanged and start skips the old fork numbers.
