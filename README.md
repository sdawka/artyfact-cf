# artyfact

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

A collaboration platform whose main object is the whole System, not a repository. It runs on Cloudflare Workers and Cloudflare Artifacts. It was built for the Cloudflare "Build the Next-Gen Git Platform" competition.

## Thesis

A file-centred platform can tell you that two agents changed different files. It cannot tell you that their changes disagree about what the product is. artyfact keeps a typed model of the System next to the code. The model is the Genome. It holds the purpose, the screens, the entities, the policies, the journeys and the criteria that say when each part counts as done.

Start a System with an imported ontology or one authored by your agent. Map its subjects to implementation artifacts, files and folders. Ask for a change, review its Evolution from the purpose down to individual nodes, and accept a new Genome revision. Then create a separate Realization with scoped Tasks for one or more local agents. Select their candidates, review the combined implementation, and promote it with exact evidence and a compare-and-swap on the reviewed System head. Deployment and operational flags are separate actions. A verdict is `pass`, `fail`, `unknown`, `stale` or `waived`; only `pass` is drawn in the success colour.

## See it in 90 seconds

Hosted demo: https://artyfact-platform.dawka.workers.dev. Until a System is imported it shows a fixture-mode banner and the bundled example. Deployment steps are in [docs/deploy.md](docs/deploy.md); `npm run release` pushes each build to the Artifacts repo `artyfact/platform.builds` and deploys the Workers from there.

![Map with two candidates overlapping on operation.contact.save](docs/images/map-candidates.png)

The Map with candidates switched on. A bracket halo marks a node a candidate touches. A double bracket and an "overlap" chip mark a node that two candidates share. The layer switch swaps Genome, Proteome and Phenome over the same nodes.

![Work, two realizations and the soft-semantic conflict](docs/images/work-conflict.png)

The Work board groups Evolutions by state. Each realization shows its agent, fork, last checkpoint and the nodes its files map to. The soft-semantic chip is the conflict between the two agents. Their files do not overlap.

![Amendment review, a rules violation](docs/images/amendment-violation.png)

![Amendment review, a deliberate choice](docs/images/amendment-deliberate.png)

The amendment review shows the semantic delta, the Readiness findings that were added and resolved, and System One's signals. The first amendment adds a recipient list to a draft and is blocked by a rule. Its screenshot shows the delta and the findings only. The second rewords a commitment and is a deliberate choice, and its screenshot also shows System One's signals. These shots were taken from a local run with the fake System One provider, and the panel labels those judgments, as the second shot shows.

More views: [Map on screen.people, Phenome layer](docs/images/map-screen-people-phenome.png), [Journeys](docs/images/journeys-connect.png), [Theory](docs/images/theory.png), [Overview](docs/images/overview.png).

## Features

- **Home.** Every System as a card with signifiers: evolving, pending realization, awaiting review, not built, deployed or behind, observed.
- **Start a System.** Review native ontology packages or agent conversions, then bootstrap the accepted Genome through the local CLI. Domain vocabulary is open; reusable Parts and outcomes conventions are optional.
- **Realizations and Tasks.** Pin an accepted Genome, inspect read/write interference and dependencies, run scoped attempts in isolated forks, and review one integrated implementation.
- **Intent edits.** Describe a change in words. The ontology engine proposes node updates linked to a durable Evolution. Accepting the reviewed proposal changes only the Genome.
- **Code.** Browse Genome and implementation revisions. Genome changes use Evolutions; new implementation work uses Realization Tasks. Legacy editor and agent histories remain readable.
- **Changelog and Compare.** One row per System commit with its semantic delta, files, criteria, builds and deployment. Compare any two revisions at System, Genome or file level.
- **Builds and deployments.** Record preview and production builds with source/output lineage. A Realization promotion records its implementation manifest; deployment is a separate action. Historical promotion flows retain their existing deployment behavior.
- **Phenome.** Deployments, configured Cloudflare runtime metrics, custom measurements and audited Flagship controls. An optional outcomes pack adds versioned event contracts, expected effects and assay links.
- **Fake platform.** `FAKE_ARTIFACTS=1` runs the whole backend with no account, and the Playwright `@fake` specs drive the use cases through it for both Peopling and Artyfact itself.

## How Cloudflare is used

One Worker serves everything. Static Assets serve the React single-page app. A Hono app handles `/api/*`, and the Worker also exports the queue handler and the Durable Object class.

**Artifacts.** The Genome and the app live in Artifacts repositories in one namespace, next to a shared `platform` repository of templates and Rule Packs. The Worker reads them through the `ARTIFACTS` binding: it reads commits and trees, walks them, and loads the Genome at an exact commit. No Git library runs in the Worker. Starting a Task forks its explicit artifact binding, commits the pinned Genome into the fork under `system/` over Git, and returns a short-lived write token and attempt secret. Resuming fences the previous attempt and replaces its credentials while preserving its fork. Older agent-level Realizations and Genome amendments keep their existing API. Agents clone and push with ordinary Git over HTTPS.

**Submission and push events on Queues.** The primary path is the CLI `submit` command, which pushes to the fork and then calls the API with the commit. The Worker also has a Queue consumer for Artifacts push events (`cf.artifacts.repo.pushed`). It resolves the fork to its realization and submits the new head. Artifacts emits push events only for a repository-level subscription, and this version does not create one per fork automatically, so the consumer is wired and tested but is a deployed-only convenience. Both paths are idempotent on realization and commit, and a redelivered event does nothing.

**Durable Object with SQLite.** `SystemAuthority` is one Durable Object per System. It stores the head, System commits, Evolutions, realizations, candidates, evaluations and seen events. `promote` runs in one synchronous transaction. It reads the head, compares it with the caller's expected head, checks the promotion gate, writes a new System commit with a hashed manifest, moves the head and rejects sibling candidates. Promotion changes the manifest, not Git history.

**Storage.** The System's state lives in two places: the Artifacts repositories and the Durable Object's SQLite. Evaluations and their observations are stored in the Durable Object.

**System One.** Semantic judgments, such as classifying a Genome change, go to System One. Providers are tried in this order: the fake provider (`FAKE_S1=1`), TypeSafe (`TYPESAFE_API_KEY`), Cloudflare Clef through the Workers AI binding (`AI`, `@cf/cloudflare/clef`), then OpenRouter (`OPENROUTER_API_KEY`). `S1_PROVIDER` (`auto`, `clef`, `jev`, `openrouter`, `fake` or `off`) names one instead, and a named one without its key or binding is off with the reason rather than another provider; `jev` is TypeSafe's Jev, through `TYPESAFE_API_KEY` or, with only `OPENROUTER_API_KEY`, OpenRouter's `typesafe/jev-1.13`. Without a provider every judgment is `unknown`. The hosted platform is a read-only demo: its judgments, visual checks, translations and plan drafts are simulated and labelled so, and it reads no model key. Clef, Jev and Browser Run run when you run Artyfact locally on your own Cloudflare account. Keys are Worker secrets. Text generation (intent translation and plan drafting) stays on OpenRouter, because Clef does not generate text. See the run notes for `FAKE_S1`.

**Visual checks.** A criterion can be judged from screenshots. A `browser` hook with `inputs.judgment: visual` captures the candidate's CI preview at desktop (1280×800) and mobile (390×844) widths through Cloudflare Browser Run, and reads any screenshots the agent attached with `artyfact task submit --screenshot page.png` (up to 4 per submit). Visual checks always use Clef when the `AI` binding is present, even when TypeSafe judges text. Each image is labelled as a platform capture or an agent screenshot and kept in the R2 bucket `artyfact-evidence`, linked from the evaluation. Agent screenshots are unverified: they can fail a check but never pass it without a platform capture. An ask takes up to 4 images (PNG, JPEG or WebP, 4 MiB each, 8 MiB per ask), and a check makes at most 3 asks. Clef returns a probability: 0.9 or above passes, 0.1 or below fails with a named concern (broken layout, unreadable text, missing content, weak hierarchy or error state), and anything between is `unknown`. With no images, or no model that can read them, the check is `not-run`; it is never judged from text alone. Artyfact judges its own /model page this way, through `C.site.model.compelling-visual-presentation`.

The longer version, with a diagram, is in [docs/architecture.md](docs/architecture.md).

## Architecture

```mermaid
flowchart LR
  subgraph Agents["Agents (local, any harness)"]
    A1[Agent A + CLI]
    A2[Agent B + CLI]
  end
  UI[React SPA<br/>Static Assets]
  subgraph Worker["Worker: artyfact-platform"]
    API[Hono /api]
    Q[Queue consumer]
    Hooks["Hook runner<br/>manifest, diff, rules, System One, http,<br/>browser (Clef visual)"]
  end
  DO[(SystemAuthority<br/>Durable Object + SQLite)]
  ART[(Artifacts<br/>genome repo, app repo, forks)]
  QUE[[Queue<br/>artifacts events]]
  S1[System One]

  UI -->|polls, SSE| API
  API --> DO
  API -->|binding reads, fork, token| ART
  A1 -->|git push to fork| ART
  A2 -->|git push to fork| ART
  A1 -->|submit| API
  ART -.->|cf.artifacts.repo.pushed, optional| QUE --> Q
  Q --> Hooks
  API --> Hooks
  Hooks --> S1
  Hooks --> DO
```

## What is deterministic and what is model-judged

The Genome is loaded and validated by a Datalog engine running versioned Rule Packs. The same Genome and the same packs give the same findings, and each finding carries its derivation. File mapping, scope checks, existence checks, overlap detection and the promotion gate are plain code.

System One is asked only questions that need judgment: is a change a deliberate non-standard choice or a violation, does an edit contradict a stated commitment, would two changes interfere. Its answers are probabilities. At 0.9 or above they count as confident, between 0.5 and 0.9 they are labelled "review", and low confidence never produces a pass. The admin decides. Promotion blocks on hard criteria that have a bound hook, and an Evolution's acceptance criteria are always in the gate pool. Those that are hard and have a bound hook block. A blocking criterion with no completed evaluation is `unknown`, and `unknown` blocks. The exception is an outcome hook that only runs after deployment: its `not-run` row is disregarded.

Without a System One provider (`TYPESAFE_API_KEY`, the Workers AI `AI` binding for Clef, or `OPENROUTER_API_KEY`), set `FAKE_S1=1` or the purpose gate stays `unknown` and promotion stays closed. The UI labels judgments from the fake provider. `.dev.vars.example` sets `FAKE_S1=1`, and it takes precedence over real keys. A local run copied from the example therefore uses the fake provider until you remove that line.

## The model in two paragraphs

A System has a Purpose, a set of Externals (the people, devices and services outside it), one or more Things and a Theory of how the System should produce its outcome. The Genome is the intended model: a General Description, then nested ontologies for the System and each Thing, refined into requirements and criteria. The Proteome is the layer of agents and execution arrangements that realize the Genome. The Phenome is the layer of measurements and evidence. The three are views over the same nodes, so selecting `screen.people` keeps its identity when you switch layers.

An Evolution changes only the Genome. Its acceptance and implementation approval are distinct decisions. A Realization pins an accepted Genome revision and contains Tasks, each with scope, dependencies, steps and agent attempts. Task candidates integrate by artifact binding into one reviewed implementation manifest. Promotion preserves the current accepted Genome and records the Genome actually realized by each changed binding. Criteria and their assay hooks supply evaluations with explicit methods, verdicts and limitations. The optional outcomes pack extends the base Phenome with expected effects and versioned event contracts.

## The agent loop

Your local coordinator creates the plan, inspects dependency waves and starts eligible Tasks. `artyfact task start` clones a Task fork and writes its packet and `AGENTS.md` block. Agents checkpoint and submit exact candidates. The coordinator selects results and runs `artyfact plan integrate`, then reviews the whole implementation before promotion. The platform checks scopes, dependencies, active writers and exact evidence. See the [agent guide](apps/site/src/pages.tsx), [CLI commands](packages/cli/README.md) and [lifecycle contract](docs/design/lifecycle.md).

## Earlier demonstration scenarios

These recorded scenarios use the preserved legacy Evolution-owned agent workflow. New implementation plans follow the separate lifecycle above.

**Two agents, different files, one conflict.** Agent A edits the add-contact dialog's save handler. Agent B edits the contacts routes. No file is shared. Through the source map (the `files` globs on Genome nodes) both files reach the node `operation.contact.save`, and the platform reports a soft-semantic conflict between the candidates. The overlap is derived from the Genome and the source map, so it does not depend on a model. System One is also asked whether the changes interfere. With the fake provider it answers "low", and the video says so. The reviewer sees the conflict on the Work board and the Map before promotion. Promoting A and then trying B returns 409 `stale-base`, and promoting B on the current head is refused because it was built on the old one.

**A rule violation is not a deliberate choice.** One agent amends the Genome so that a draft message has a list of recipients. The rules engine proves a `topology.recipientArray` violation and shows its derivation. Accepting the amendment returns 409 and the admin rejects it with a reason. A second agent rewords a commitment. No rule fires, the review panel shows System One's signals, and the admin accepts it with an interpretation. The commit records which provider backed the evidence, here `fake`. The fake provider labels both amendments "deliberate choice", including the violating one, and the rules engine and the gate do not rely on it.

The exact commands and output for both are in [docs/demo-runbook.md](docs/demo-runbook.md) (steps 7 to 10).

## Run it locally

### Prerequisites

- Node 24 (`.nvmrc`) and npm. The repo is one npm workspace: run `npm install` once at the root.
- A Playwright browser for the end-to-end suites: `npx playwright install chromium`.
- For the real backend only: a Cloudflare account on Workers Paid (Artifacts is unavailable on Free), `npx wrangler login`, and the Cloudflare `cf` CLI logged in with `cf auth login`. Wrangler and `cf` log in separately; `npx wrangler whoami` and `cf auth whoami` must show the same account. `artyfact init` and `npm run release` check this.
- Cost. Fixture and fake mode are free and talk to no Cloudflare service. The real backend uses Artifacts, which has a free tier of operations, and adds Workers AI (`AI`, for Clef) and Browser Run (`BROWSER`, for preview screenshots), both billed to the logged-in account. [docs/costs.md](docs/costs.md) has the numbers.

### Three ways to run, cheapest first

**Fixture mode** needs no backend and no login. The SPA uses a bundled copy of the Peopling System.

```sh
npm test                                          # unit tests; the live System One smoke test is skipped without a key
npm run typecheck
npm run e2e                                       # builds the SPA and runs the Playwright suite on port 1338
npm run preview:fixture -w @artyfact/platform     # http://localhost:1338
npm run dev:amendment -w @artyfact/platform       # amendment review fixture page:
# http://localhost:5199/amendment-dev.html?scenario=deliberate|hard|review|fake|off|findings
```

**Fake platform** runs the whole backend on in-memory Artifacts seeded from `examples/`, with the fake System One and no AI or Browser Run. It needs no login and keeps no state between runs. The variables go in the shell, not in `.dev.vars`, because the Vite config reads them to drop the remote binding.

```sh
FAKE_ARTIFACTS=1 npm run dev -w @artyfact/platform               # http://localhost:1337, Peopling imported
FAKE_ARTIFACTS=1 FAKE_SEED=both npm run dev -w @artyfact/platform  # also Artyfact's own genome/
npm run e2e:fake -w @artyfact/platform                           # use-case specs on port 1339 (self-model on 1340)
```

`FAKE_SEED` is `peopling` (default), `artyfact` or `both`. `FAKE_MODEL_DELTA=1` also seeds Task candidates that change the pinned model, for the Review view. The admin token is `fake-admin-token` unless `ADMIN_TOKEN` is set in the shell. Driving it with the real CLI and a local git transport is in [the runbook](docs/demo-runbook.md#the-fake-platform).

**Real backend** uses the `ARTIFACTS` binding, which is remote even in development, plus `AI` and `BROWSER` on your account. `npm run dev` sets `HOSTED_DEMO=0`, so judgments are real.

```sh
cp apps/platform/.dev.vars.example apps/platform/.dev.vars   # set ADMIN_TOKEN=$(openssl rand -hex 32) and ACCOUNT_ID
npm run dev -w @artyfact/platform                            # http://localhost:1337 (Vite moves to the next free port)
```

`apps/platform/wrangler.jsonc` carries the maintainer's account values (`ACCOUNT_ID`, `PUBLIC_URL`, `WORKERS_SUBDOMAIN`, the Flagship `app_id`). `ACCOUNT_ID` in `.dev.vars` overrides the first locally; change the rest before deploying to your own account. Read routes are unauthenticated; admin routes (import, start work, accept, reject, promote) need `ADMIN_TOKEN`.

### Platform Worker variables

Set in: `.dev.vars` (local, git-ignored), `vars` in `wrangler.jsonc`, a deployed secret (`npx wrangler secret put` in `apps/platform`), or the shell that starts Vite.

| Variable | Needed for | Set in | Default | Meaning |
| --- | --- | --- | --- | --- |
| `ADMIN_TOKEN` | admin routes | `.dev.vars`, secret | unset: admin routes return 503 | Bearer for import, start, accept, reject and promote. |
| `ACCOUNT_ID` | real backend | `.dev.vars` or vars | the maintainer's id | Builds fork remotes `https://<id>.artifacts.cloudflare.net/git/<ns>/<repo>.git`. |
| `ARTIFACTS_NAMESPACE` | always | vars | `artyfact` | Artifacts namespace of the deployment. |
| `PUBLIC_URL` | CI builds | vars | the hosted origin | Deployed origin, used in CI report URLs and app vars. Local pages use the request origin. |
| `WORKERS_SUBDOMAIN` | nothing in the Worker | vars | `dawka` | Recorded only; the CI Worker's own copy builds preview URLs. |
| `HOSTED_DEMO` | deployed demo | vars | `1`; `npm run dev` forces `0` | `1` simulates System One, visual checks, translation and plan drafts and reads no model key. |
| `S1_PROVIDER` | System One | `.dev.vars`, secret | `auto` | `auto` tries TypeSafe, then Clef, then OpenRouter; `clef`, `jev`, `openrouter`, `fake` or `off` pick one and never fall through. |
| `FAKE_S1` | gate without keys | `.dev.vars` only | `1` in the example | Answers from the fake provider; the UI labels those judgments fake. Never deployed. |
| `TYPESAFE_API_KEY` | Jev | `.dev.vars`, secret | unset | TypeSafe key; Jev model `jev-latest`. |
| `OPENROUTER_API_KEY` | OpenRouter, Jev, translator, planner | `.dev.vars`, secret | unset | OpenRouter key. |
| `OPENROUTER_MODEL` | OpenRouter | `.dev.vars`, secret | `perplexity/pplx-decider-v1.1-27b` | Decisions API model. |
| `CLEF_MODEL` | Clef | `.dev.vars`, secret | `@cf/cloudflare/clef` | Workers AI model; `@cf/cloudflare/clef-flash` is the 9B one. |
| `JEV_MODEL` | Jev | `.dev.vars`, secret | `jev-latest` or `typesafe/jev-1.13` | Overrides the Jev model. |
| `TRANSLATE` | intents, plans | `.dev.vars`, secret | on | `0` turns off the LLM intent translator and plan draft planner. |
| `OPENROUTER_TRANSLATE_MODEL`, `OPENROUTER_PLAN_MODEL` | intents, plans | `.dev.vars`, secret | provider default | Translator model, and planner model (falls back to the translator's). |
| `CI_REPORT_TOKEN` | CI | `.dev.vars`, secret | unset: no CI | Bearer the `artyfact-ci` Workflow sends with build reports; same value on both Workers. |
| `CF_API_TOKEN` | push events | `.dev.vars`, secret | unset | API token for per-fork Artifacts event subscriptions. |
| `EVENTS_QUEUE_ID` | push events | `.dev.vars`, secret | unset | Queue id of `artyfact-artifacts-events`; subscriptions are skipped without it, `CF_API_TOKEN` and `ACCOUNT_ID`. |
| `OPERATIONS_BINDINGS` | runtime operations | `.dev.vars`, secret | unset: unavailable | JSON map of System and binding ids to `{accountId, scriptName, environment, flagshipAppId?}`. |
| `OPERATIONS_API_TOKEN` | runtime operations | `.dev.vars`, secret | unset | Server-only token for metrics and Flagship management. |
| `VERIFICATION_URL` | cloud verification | `.dev.vars` | the example points at the maintainer's CI | `artyfact-ci` origin the local operator calls; unset returns 503. |
| `VERIFICATION_TOKEN` | cloud verification | `.dev.vars` | unset | Same value as the CI Worker's `VERIFICATION_TOKEN`. |
| `ALLOW_LOCAL_PREVIEW` | local previews | `.dev.vars` only | `1` in the example | Lets the health hook fetch `http://localhost` and `127.0.0.1` previews. Never deployed. |
| `PREVIEW_HOST_ALLOWLIST` | custom preview hosts | vars or `.dev.vars` | empty | Extra hosts, comma-separated; `*.workers.dev` and `*.pages.dev` are always allowed. |
| `FAKE_ARTIFACTS`, `FAKE_SEED`, `FAKE_MODEL_DELTA` | fake platform | shell | unset | See fake platform above. A build refuses `FAKE_ARTIFACTS=1`. |
| `ARTYFACT_PERSIST_STATE_DIR` | local state | shell | `.wrangler/state` | Where `npm run dev` keeps Durable Object state. |
| `ARTYFACT_E2E_PORT` | e2e | shell | 1338, or 1339 fake | Port for the Playwright suites when the default is taken. |

Bindings need no variable. `FLAGS` is the Flagship app that gates the `cat-mode` flag; absent or failing, every flag is off. `EVIDENCE` is the R2 bucket `artyfact-evidence`, `SYSTEMS` the Durable Object, `CI` the cross-script Workflow in `artyfact-ci`.

### CI Worker and site

`apps/ci` has its own configuration. Setup and the token scopes are in [apps/ci/README.md](apps/ci/README.md).

| Variable | Set in | Meaning |
| --- | --- | --- |
| `CI_REPORT_TOKEN` | secret | Same value as the platform's. |
| `CF_TOKEN` | secret | Workers Scripts Edit token (plus D1 Edit) used only by the deploy step. Never the platform's `CF_API_TOKEN`. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secret | R2 token for the `artyfact-ci-cache` bucket. |
| `VERIFICATION_TOKEN` | secret | Operator bearer for `/verify` and `/site-deploys`. |
| `PLATFORM_URL` | vars | Platform origin; reports elsewhere are refused. |
| `WORKERS_SUBDOMAIN`, `CLOUDFLARE_ACCOUNT_ID` | vars | Preview URLs, and the account for checkout and deploy. |
| `BACKUP_BUCKET_NAME` | vars | Equal to the R2 bucket name. |
| `D1_DATABASE_IDS`, `FLAGSHIP_APP_IDS` | vars (JSON) | Per System, the D1 ids and Flagship app ids an app may bind. |

The site (`apps/site`) has no runtime variables. Its build reads optional `SITE_PLATFORM_URL`, `SITE_PLATFORM_READY` and `SITE_SOURCE_URL` ([apps/site/README.md](apps/site/README.md)).

### CLI variables

| Variable | Meaning |
| --- | --- |
| `ARTYFACT_PLATFORM`, `ARTYFACT_URL` | Platform URL, after `--platform`. Without either the CLI probes ports 1337 to 1346 for a server that identifies as artyfact, and sends no credential otherwise. |
| `ARTYFACT_ADMIN_TOKEN` | Admin bearer. Pass it inline per command; never export it. |
| `ARTYFACT_TOKEN`, `ARTYFACT_SECRET` | A Task's fork write token and attempt secret; override the copies saved in the workspace. |
| `ARTYFACT_SYSTEM`, `ARTYFACT_EVOLUTION` | Defaults for `--system` and `--evolution`. |
| `ARTYFACT_ALLOW_REMOTE_HOST` | One extra git host allowed for local dev, such as the fake platform's. |
| `ARTIFACTS_NAMESPACE`, `ARTYFACT_NAMESPACE` | Namespace for `init` and `platform-sync`, and for `release` and `operator`; default `artyfact`. |
| `CLOUDFLARE_ACCOUNT_ID` | Picks the account when Wrangler and `cf` see several. |

### Import a project

`npx artyfact init --dir <project>` takes a cloned project from its Genome (`genome/node.yaml`) to an imported System in one command. `scripts/bootstrap.sh` runs it on the Peopling example in `examples/`. It needs the real backend and `ARTYFACT_ADMIN_TOKEN`; without the token it prints the `curl` line and exits 0.

- **Names.** One Artifacts namespace per deployment. `system.peopling` gives the repositories `peopling.genome` and `peopling.app`. Task forks are `<repo>--task-<id>` and carry the pinned Genome under `system/` ([task fork model](docs/design/task-fork-model.md)); integration forks are `<repo>--integrate-<id>`.
- **The `platform` repository** holds the templates and Rule Packs. `init` creates it when missing, `npx artyfact platform-sync` updates it, and imports record its commit as provenance.
- **Pushes.** `init` never rewrites history. It fast-forwards only from the head it last pushed, and `--adopt` commits on top of history it did not push. Secret files (`.dev.vars`, `.env` and variants, except `*.example`), `node_modules`, `.wrangler` and `dist` are never pushed.
- **Templates.** `--from-template template.thing.<id>@<version>` seeds a new app from a scaffold in `platform`.

A re-run pushes nothing and re-imports as a no-op. An older recorded run is in step 2 of [the runbook](docs/demo-runbook.md); flags are in [packages/cli/README.md](packages/cli/README.md). The full loop against real Artifacts, with agents, a conflict, a promotion and Genome amendments, is the rest of the runbook.

### Deploy and release

`npm run release`, from a clean checkout of main, builds the platform and the site, commits them to the Artifacts repo `artyfact/platform.builds` and deploys both Workers from there ([design](docs/design/release-artifacts.md)). `npm run deploy` is the manual fallback. Resources, first deploy and the production admin token are in [docs/deploy.md](docs/deploy.md).

## Artyfact describes itself

The repo-root `genome/` is Artyfact's own Genome (`system.artyfact`, on the dev-platform template): ten Things (platform, ci, site, model, ontology, semantic, rules, templates, cli and effects), with their real endpoints, commands, Durable Objects, Workflow and bindings, `dependsOn` links that match the workspace dependencies, and node `files` that cover every source file outside `.artyfactignore`. `packages/templates/test/self-genome.test.ts` checks all of that. To browse it on the fake platform, with no login:

```sh
cd apps/platform
FAKE_ARTIFACTS=1 FAKE_SEED=artyfact npx vite --port 1337   # FAKE_SEED=both imports Peopling too
```

## Phenome event header

A deployed app reports what it observes with `POST /api/systems/:id/phenome/events` and `{"events": [...]}` (up to 100 per request, 8 KB each). The bearer is the deployment's ingest token, a realization secret for a preview, or the admin token. Every event carries this header. Most event payloads are free-form JSON; `measurement` and `outcome.event` use the contracts below.

| Field | Meaning |
|---|---|
| `systemId`, `thingId`, `artifactId` | Which System, Thing and Artifact emitted the event |
| `buildId` | The app's `BUILD_ID`, which is its commit |
| `commit` | The app commit, 7 to 64 hex characters |
| `systemCommit` | The System commit the app was built for (optional) |
| `deploymentId` | The deployment that reported it (optional) |
| `emittedAt` | ISO 8601 time with offset |
| `kind` | Dotted event kind such as `journey.step` or `criterion.observed` |
| `subject`, `criterion` | A Genome node and a criterion the event is about (optional) |
| `id` | Emitter-chosen id; a repeated id is dropped (optional) |
| `payload` | Kind-specific JSON |

The platform stamps `seq`, `receivedAt` and the realization. The Deployments page groups events by `buildId`, else `commit`. The schema is `PhenomeEventHeader` in `packages/model/src/phenome.ts`.

A `measurement` payload is `{name, value, unit?}` with a finite numeric value. Its lineage comes from authenticated deployment, build and Task records, never from payload claims. `outcome.event` carries `{contractId, version, payload}` and is validated against the event contract in the emitting implementation’s Genome. Event validity alone does not establish an expected effect. Retention is capped at 5,000 events per System.

Runtime operations require server configuration. `OPERATIONS_BINDINGS` maps System IDs to artifact binding IDs and `{accountId, scriptName, environment, flagshipAppId?, metricsRetentionDays?}`. `OPERATIONS_API_TOKEN` stays server-side. With either missing, the UI reports unavailable data. Workers analytics aggregates span versions and carry no inferred output lineage. Flag updates require the reviewed version fingerprint and record an operational audit; changes made outside Artyfact may race the provider write because the API has no documented conditional-write guarantee. For deployment, the CI Worker’s `FLAGSHIP_APP_IDS` allowlist maps System IDs to allowed binding names/app IDs. Provision these resources separately; tests use fake providers. The platform Worker's own `FLAGS` Flagship binding (app `artyfact`) gates `cat-mode`; the test configs omit it, so the flag reads as off there.

## Repository layout

| Path | What it holds |
|---|---|
| `packages/model` | Schemas, loader, validation, diff, overlap |
| `packages/rules` | Datalog engine with derivation trees |
| `packages/templates` | System and Thing templates, Rule Packs |
| `packages/semantic` | System One client, question catalog, policy |
| `packages/cli` | The `artyfact` command for agents |
| `apps/platform` | The Worker, the Durable Object and the SPA |
| `genome` | Artyfact's own Genome (node tree) |
| `examples/peopling-system` | The worked example Genome |
| `examples/peopling-app` | The example app that agents change |
| `docs/design` | Design notes for each part |
| `docs/costs.md` | Cloudflare cost plan, usage checks and guardrails |

## Not done on purpose

- The Ascent and WASM evaluator.
- Reasoning-model hooks beyond System One.
- Paid runs.
- A Git-parity suite. Artifacts is used for what a Git platform needs here, and nothing more is claimed.
- Platform-hosted agents. Agents run on the user's machine.
- Replay of server-sent events after a disconnect. The UI polls and refetches on reconnect.
- Composing more than one app candidate or Genome candidate in one promotion. The API returns `invalid-state`.
- Authentication beyond one admin bearer token and per-realization secrets. Start work needs the admin bearer. Checkpoint, submit, sync, status and packet need the per-realization secret returned once by start work, or the admin bearer. The platform keeps only the secret's hash, and rejecting a realization revokes it. There are no user accounts.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
