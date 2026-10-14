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

A person describes a change and agrees it node by node. Accepting commits exactly the agreed change to the Genome; nothing is built yet. Implementation is a separate plan of tasks pinned to that Genome, with dependencies and waves computed from the nodes each task reads and writes. Each task gets its own fork, a scoped write token and a packet cut from the Genome, and the agent works with any harness it likes. On submit, the platform maps changed files back to Genome nodes and runs the hooks bound to the task's checks.

The comparison is the point. Two agents can change different files and still disagree. If two tasks write or read the same nodes, or the platform cannot tell what a task touches, it reports the interference before anything launches in parallel, and a dependent task cannot start until its predecessors are selected. Selected results integrate into one candidate per binding and one review. Promotion is a compare-and-swap on the System head inside a Durable Object, and a plan whose binding moved must be replanned.

Changes to the model get a review of their own. Rule Packs recompute readiness and System One classifies each change. The agreement tree separates a deliberate non-standard choice from a rule violation, and an imported System is reviewed before any work can start. The admin decides and writes down the interpretation.

The platform is strict about what counts as evidence. A verdict is pass, fail, unknown, stale or waived. Only pass is drawn green. Missing evidence is unknown and blocks promotion. The model is asked only for judgment, never for a pass without confidence. Everything else is deterministic code and a Datalog rule engine that records its derivations.

Everything runs on Cloudflare. One Worker serves the API and the single-page app through Static Assets. Artifacts hold the Genome and the app. The Worker reads them through the binding, forks them and issues tokens. A Queue consumer handles Artifacts push events, and the CLI submit command is the primary path. A Durable Object with SQLite holds the System state and does the promotion swap. Evaluations and their evidence are stored in the Durable Object's SQLite.

Not done on purpose: platform-hosted agents, a reasoning-model evaluator beyond System One, paid runs and a Git-parity suite.

## Features
- Home with a card per System and signifiers for evolving, pending, awaiting review, not built, deployed and observed.
- Describe a change in the browser or hand it to an agent: an agreement tree to agree, reject or defer node by node, then a plan of tasks in waves with one claim command per task (`artyfact task claim`), a task packet and a real Git push to a fork.
- Intent edits: a message is routed through the Genome tree by the ontology engine and becomes ops to review and accept. Artyfact describes itself with ten Things in the same format.
- Changelog and Compare across System, Genome and file level.
- Preview builds and production deployments through a CI Worker, with a health assay on the deployed preview.
- Deployments page with runtime events from the running app, tied to the System commit.
- A fake platform (`FAKE_ARTIFACTS=1`) and Playwright specs that drive the use cases through the UI for Peopling and for Artyfact's own Genome.

## How Workers and Artifacts are used
- Workers: one Worker with Static Assets for the SPA, a Hono API, a Queue consumer and the `SystemAuthority` Durable Object with SQLite.
- Artifacts: one namespace with a Genome repository and an app repository per System, plus a shared `platform` repository of templates and Rule Packs. Binding reads of commits and trees, forks per realization, scoped write tokens, and a Queue consumer for `cf.artifacts.repo.pushed` events alongside the CLI submit path.
- Concurrency: several agents fork, work and push at once, one writer per task. The platform computes task footprints and conflicts, orders dependent tasks, integrates the selected results and promotes with a compare-and-swap.

## Team
Team: solo — sahil.pro

## Open items
- Repository and video URLs.
- Eligibility: the official terms require the source to be under MIT, Apache-2.0 or a BSD 2/3-Clause licence, which is why the licence stays Apache-2.0, and they make US or Canada residency an eligibility condition.
