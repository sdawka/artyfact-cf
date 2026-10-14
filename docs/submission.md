# Submission draft

Competition: Cloudflare "Build the Next-Gen Git Platform". Submissions close 2026-10-14 23:59 PDT.

## Title
artyfact

## Tagline (140 characters or fewer)
The next GitHub keeps track of the product, not just the files, so agents working in parallel can't break what a clean merge hides.

## Links
- Site: https://artyfact.ing
- Platform demo: https://artyfact-platform.dawka.workers.dev
- Repository: https://github.com/sdawka/artyfact-cf
- Video: `TODO(video-url)`
- Licence: Apache-2.0

## Description (under 500 words)

GitHub keeps track of files. Two agents can change different files, merge cleanly and still break checkout: both changed the "Place order" step, and one broke the rule "guests can still check out". Artyfact is a Git platform that keeps track of the product, not just the files.

It keeps a typed, multi-level model of the product, the Genome, in its own Git repository next to the code. The levels run from System to Thing, section, screen, component and affordance. Purposes, people, journeys, data, policies and acceptance criteria attach to the parts they describe. Practices that now live in separate files and tools become one model and one workflow: spec.md, PRDs, AGENTS.md, worktrees, policy-as-code, CI gates, merge queues, changelogs, journey maps, ERDs and release tracking.

A person describes a change and agrees it node by node in an agreement tree. Accepting commits exactly the agreed change to the Genome. Rule Packs run over the model in a Datalog engine and record the facts behind each finding, so a rule violation is kept apart from a deliberate choice. An imported System is reviewed before any work can start.

Implementation is a plan of Tasks pinned to that Genome. The platform computes interference from the model nodes each Task writes and reads, with no language model involved. Tasks that touch the same screen, rule or journey conflict even in different files, and a Task whose footprint is unknown conflicts too. Conflicting Tasks go to later waves. A dependent Task is refused until its predecessors are selected. Each Task gets a private fork, a 15-minute write token and a brief cut from the model. Agents run locally with any harness.

Selected results integrate into one candidate per binding and one review. Promotion is a compare-and-swap on the System head inside a Durable Object. Work reviewed against an old head is refused.

Verdicts are strict. Only pass is green. On a blocking criterion, anything but a completed pass blocks promotion, and missing evidence counts as unknown. System One is asked only for judgments, with a confidence score. Below the threshold its answer stays unknown. A language model also drafts plans and model edits; its output is checked like any other edit.

On Cloudflare, the platform Worker serves the API and the review app through Static Assets, with one Durable Object with SQLite per System. Artifacts hold the Genome and app repositories and a fork per Task. A separate artyfact-ci Worker runs a Workflow, started through a cross-script binding, that builds app commits in a container and deploys previews and production. Agents push through the CLI submit command. A Queue consumer for Artifacts push events is wired up, but the per-fork subscription it needs is not created automatically. The site at artyfact.ing is its own Worker.

Direction, not shipped: several agents taking the same Task contract in parallel, keeping any version that meets it, and measuring outcomes against the theory of change.

## Judging criteria

- Originality (50%): the unit of version control is the product model, not the file tree. Interference, readiness and promotion are computed over model nodes, so a clean textual merge can still be flagged. One model replaces the spec, the policy files, the agent instructions and the release notes.
- Multi-agent concurrency (25%): Task footprints from the model, deterministic conflicts and waves, one fork and one writer per Task, server-side refusal of dependent Tasks until their predecessors are selected, one integrated review, and a compare-and-swap promote in a Durable Object.
- User experience (25%): an agreement tree to accept a change node by node, a wave board with one claim command per Task, one review across all Tasks, verdicts that are never green without a pass, and a changelog and compare at System, Genome and file level.

## Features
- Home with a card per System and signifiers for evolving, pending, awaiting review, not built, deployed and observed.
- Describe a change in the browser or hand it to an agent: an agreement tree to agree, reject or defer node by node, then a plan of Tasks in waves with one claim command per Task (`artyfact task claim`), a task packet and a real Git push to a fork.
- Intent edits: a message is routed through the Genome tree by the ontology engine and becomes ops to review and accept. Artyfact describes itself with ten Things in the same format.
- Changelog and Compare across System, Genome and file level.
- Preview builds and production deployments through the CI Worker, with a health check on the deployed preview.
- Deployments page with runtime events from the running app, tied to the System commit.
- Parts: reusable packages with pinned versions, composed with recorded provenance.
- A fake platform (`FAKE_ARTIFACTS=1`) and Playwright specs that drive the use cases through the UI for Peopling and for Artyfact's own Genome.

## How Workers and Artifacts are used
- Workers: the platform Worker (Static Assets for the review app, a Hono API, a Queue consumer and the `SystemAuthority` Durable Object with SQLite); the `artyfact-ci` Worker (a Workflow, a container sandbox and an R2 cache), started by the platform through a cross-script Workflow binding; the site Worker on artyfact.ing.
- Artifacts: one namespace with a Genome repository and an app repository per System, plus a shared `platform` repository of templates and Rule Packs. Binding reads of commits and trees, a fork per Task, and scoped write tokens that expire with the claim's lease (15 minutes by default, at most 60). The CLI submit command is the primary push path; the Queue consumer for `cf.artifacts.repo.pushed` needs a per-fork subscription, created by hand.
- Concurrency: several agents fork, work and push at once, one writer per Task. The platform computes Task footprints and conflicts, orders dependent Tasks, integrates the selected results and promotes with a compare-and-swap.

## Not done on purpose
Platform-hosted agents, a reasoning-model evaluator beyond System One, paid runs and a Git-parity suite.

## Team
Team: solo — sahil.pro

## Open items
- Video URL.
- Eligibility: the official terms require the source to be under MIT, Apache-2.0 or a BSD 2/3-Clause licence, which is why the licence stays Apache-2.0, and they make US or Canada residency an eligibility condition.
