# Submission draft

Competition: Cloudflare "Build the Next-Gen Git Platform". Submissions close 2026-10-14.

## Title
artyfact

## Tagline (140 characters or fewer)
A Git platform where the System is the unit: agents change a typed model, hooks check it, promotion is compare-and-swap.

## Links
- Repository: https://github.com/sdawka/artyfact-cf
- Demo: https://artyfact-platform.dawka.workers.dev
- Video: `TODO(video-url)`
- Licence: Apache-2.0

## Description (under 500 words)

Git tells you which files changed. It does not tell you whether two changes agree about the product. When several agents work at once, that is the part that breaks.

artyfact makes the whole System the main object. A System has a Purpose, Externals, Things and a Theory, kept as a typed model called the Genome in its own repository. The Genome says what the screens, entities, policies and journeys are, and which criteria decide whether each is done. Agents realize changes to it in forks of the app repository.

A person starts work on an Evolution. The platform forks the repository, issues a scoped write token and returns a task packet cut from the Genome. The agent clones the fork and works with any harness it likes. On push, the platform maps changed files back to Genome nodes, runs the hooks bound to the affected criteria and compares the candidate with every other candidate in flight.

Large changes split. The platform plans an Evolution into Tasks, works out from the Genome's file bindings and links which can run in parallel, and groups them into waves. A local agent claims one task, gets its own fork and a packet naming the paths other tasks own, and submits. A dependent task stays blocked until its prerequisite is promoted.

The comparison is the point. Two agents can change different files and still disagree. If both touch nodes that serve the same journey or policy, the platform reports a soft-semantic conflict and shows it before promotion. Promotion is a compare-and-swap on the System head inside a Durable Object. A candidate built on an old head gets a 409 and has to rebase.

Genome amendments get a review of their own. An agent can propose a change to the model. Rule Packs recompute readiness and System One classifies each change. The panel separates a deliberate non-standard choice from a rule violation. The admin decides and writes down the interpretation.

The platform is strict about what counts as evidence. A verdict is pass, fail, unknown, stale or waived. Only pass is drawn green. Missing evidence is unknown and blocks promotion. The model is asked only for judgment, never for a pass without confidence. Everything else is deterministic code and a Datalog rule engine that records its derivations.

Everything runs on Cloudflare. One Worker serves the API and the single-page app through Static Assets. Artifacts hold the Genome and the app. The Worker reads them through the binding, forks them and issues tokens. A Queue consumer handles Artifacts push events, and the CLI submit command is the primary path. A Durable Object with SQLite holds the System state and does the promotion swap. Evaluations and their evidence are stored in the Durable Object's SQLite.

Not done on purpose: platform-hosted agents, a reasoning-model evaluator beyond System One, paid runs and a Git-parity suite.

## Features
- Home with a card per System and signifiers for evolving, pending, awaiting review, not built, deployed and observed.
- Describe a change in the browser or hand it to an agent: Evolution, task packet, in-browser editor with a real Git push to a fork.
- Bring in a System: `artyfact skill --write` lets a local agent write the Genome for existing code, `artyfact validate-genome` checks it before anything is pushed, and the import waits in Review until a person agrees or rejects each node.
- Intent edits: a message is routed through the Genome tree by the ontology engine and becomes ops. Review them as a tree: agree, reject or defer a Thing or any node under it, and the deferred changes continue in their own proposal. Artyfact describes itself with ten Things in the same format.
- Tasks and waves: Work, Plan splits an Evolution into Tasks, shows the waves, and starts one. Independence is derived from the nodes' file bindings and links, not from a model.
- Local agents: `artyfact tasks`, then claim, run and submit, one task per fork (below). After one task is promoted, a sibling's candidate is rebased onto the new head instead of redone.
- Changelog and Compare across System, Genome and file level.
- Preview builds and production deployments through a CI Worker, with a health assay on the deployed preview.
- Deployments page with runtime events from the running app, tied to the System commit.
- A fake platform (`FAKE_ARTIFACTS=1`) and Playwright specs that drive the use cases through the UI for Peopling and for Artyfact's own Genome.

## The local agent loop

```sh
artyfact tasks --system system.peopling
artyfact claim task.2.t1 --system system.peopling --agent "claude:task.2.t1" --dir ./work/task.2.t1
(cd ./work/task.2.t1 && claude -p "Read AGENTS.md and TASK_PACKET.md, implement the task; then npx artyfact submit")
```

| task | wave | depends on | nodes |
|---|---|---|---|
| `task.2.t1` | 1 | none | goal and contact-event entities and operations |
| `task.2.t2` | 2 | `task.2.t1` | goal, log and Today screens, the Today list |

The orchestrator holds the admin token and claims; the agent holds only its task's fork token. `claim` saves that token in the
clone's `.artyfact.json` (owner-only, git-excluded, never printed) so `submit` works without it in the environment. That is a
write token at rest on the agent's machine, scoped to one fork and six hours, the same exposure the realization secret already
has. Claiming `task.2.t2` before `task.2.t1` is promoted is refused with `blocked by task.2.t1`.

## How Workers and Artifacts are used
- Workers: one Worker with Static Assets for the SPA, a Hono API, a Queue consumer and the `SystemAuthority` Durable Object with SQLite, which also holds plans, task claims and the import review.
- Artifacts: one namespace with a Genome repository and an app repository per System, plus a shared `platform` repository of templates and Rule Packs. Binding reads of commits and trees, forks per realization, scoped write tokens, and a Queue consumer for `cf.artifacts.repo.pushed` events alongside the CLI submit path.
- Concurrency: several agents fork, work and push at once. The platform records each candidate, detects file and semantic overlap and resolves them through a compare-and-swap promotion.

## Team
Team: solo — sahil.pro

## Open items
- Repository and video URLs.
- Eligibility: the official terms require the source to be under MIT, Apache-2.0 or a BSD 2/3-Clause licence, which is why the licence stays Apache-2.0, and they make US or Canada residency an eligibility condition.
