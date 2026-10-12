# Submission draft

Competition: Cloudflare "Build the Next-Gen Git Platform". Submissions close 2026-10-14.

## Title
artyfact

## Tagline (140 characters or fewer)
A Git platform where the System is the unit: agents change a typed model, hooks check it, promotion is compare-and-swap.

## Links
- Repository: `TODO(repo-url)`
- Demo: `TODO(demo-url)`
- Video: `TODO(video-url)`
- Licence: Apache-2.0

## Description (under 500 words)

Git tells you which files changed. It does not tell you whether two changes agree about the product. When several agents work at once, that is the part that breaks.

artyfact makes the whole System the main object. A System has a Purpose, Externals, Things and a Theory, kept as a typed model called the Genome in its own repository. The Genome says what the screens, entities, policies and journeys are, and which criteria decide whether each is done. Agents realize changes to it in forks of the app repository.

A person starts work on an Evolution. The platform forks the repository, issues a scoped write token and returns a task packet cut from the Genome. The agent clones the fork and works with any harness it likes. On push, the platform maps changed files back to Genome nodes, runs the hooks bound to the affected criteria and compares the candidate with every other candidate in flight.

The comparison is the point. Two agents can change different files and still disagree. If both touch nodes that serve the same journey or policy, the platform reports a soft-semantic conflict and shows it before promotion. Promotion is a compare-and-swap on the System head inside a Durable Object. A candidate built on an old head gets a 409 and has to rebase.

Genome amendments get a review of their own. An agent can propose a change to the model. Rule Packs recompute readiness and System One classifies each change. The panel separates a deliberate non-standard choice from a rule violation. The admin decides and writes down the interpretation.

The platform is strict about what counts as evidence. A verdict is pass, fail, unknown, stale or waived. Only pass is drawn green. Missing evidence is unknown and blocks promotion. The model is asked only for judgment, never for a pass without confidence. Everything else is deterministic code and a Datalog rule engine that records its derivations.

Everything runs on Cloudflare. One Worker serves the API and the single-page app through Static Assets. Artifacts hold the Genome and the app. The Worker reads them through the binding, forks them and issues tokens. Push events arrive on a Queue. A Durable Object with SQLite holds the System state and does the promotion swap. Evaluations and their evidence are stored in the Durable Object's SQLite.

Not done on purpose: platform-hosted agents, a reasoning-model evaluator beyond System One, paid runs and a Git-parity suite.

## How Workers and Artifacts are used
- Workers: one Worker with Static Assets for the SPA, a Hono API, a Queue consumer and the `SystemAuthority` Durable Object with SQLite.
- Artifacts: namespace with a Genome repository and an app repository. Binding reads of commits and trees, forks per realization, scoped write tokens, and `cf.artifacts.repo.pushed` events delivered through a Queue.
- Concurrency: several agents fork, work and push at once. The platform records each candidate, detects file and semantic overlap and resolves them through a compare-and-swap promotion.

## Team
`TODO(team)`: names and roles are not recorded in the repository.

## Open items
- Team names and roles.
- Copyright owner for LICENSE. It reads "artyfact contributors" until the owner names one.
- Repository, demo and video URLs.
