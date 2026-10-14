# Submission draft

Competition: Cloudflare "Build the Next-Gen Git Platform". Submissions close 2026-10-14 23:59 PDT.

## Title
artyfact

## Tagline (140 characters or fewer)
The next Git platform keeps track of the product, not just the files, so coding agents working in parallel can't quietly break it.

## Links
- Site: https://artyfact.ing
- How it works, generated from Artyfact's own model: https://artyfact.ing/how-it-works
- Platform demo: https://artyfact-platform.dawka.workers.dev
- Repository: https://github.com/sdawka/artyfact-cf
- Video: `TODO(video-url)`
- Licence: Apache-2.0

## Description (under 500 words)

GitHub keeps track of files. Two agents can change different files, merge cleanly and still break checkout, because one broke the rule "guests can still check out". Artyfact keeps track of the product, not just the files.

It keeps a typed, multi-level model of the product, the Genome, in its own Git repository next to the code. The levels run from System to Thing, section, screen, component and affordance. Purposes, people, journeys, data, policies and acceptance criteria attach to the parts they describe. Practices that now live in separate tools become one model and one workflow: spec.md, PRDs, AGENTS.md, worktrees, policy-as-code, CI gates, merge queues and changelogs.

A person agrees a change node by node in an agreement tree. Accepting commits exactly the agreed change to the Genome. Rule Packs run over the model in a Datalog engine and record the facts behind each finding, so a rule violation is kept apart from a deliberate choice. An imported System is reviewed before any work can start.

Implementation is a plan of Tasks pinned to that Genome. The platform computes interference from the model nodes each Task writes and reads, with no language model. Tasks that change the same part of the model, or read what another changes, conflict even in different files. A Task whose footprint is unknown conflicts too. Conflicting Tasks go to later waves. A dependent Task is refused until its predecessors are selected. The aim is an environment where coding agents thrive. Each Task gets context (a brief cut from the model: pinned Genome, nodes, steps, checks and concurrent work), guardrails (a private fork, a 15-minute write token, protected paths, checks bound to the model's rules) and freedom (any local harness, its own approach, and the option to propose a change to the model itself).

Selected results integrate into one review. Promotion is a compare-and-swap on the System head inside a Durable Object. Work reviewed against an old head is refused.

Verdicts are strict. Only pass is green. On a blocking criterion, anything but a completed pass blocks promotion, and missing evidence counts as unknown. System One judgments are probabilities; between 0.1 and 0.9 they stay unknown. The default judge in production, Cloudflare Clef on Workers AI, also checks visual criteria against screenshots of the CI preview or the agent's own; with no screenshot there is no verdict. A language model drafts plans and model edits, checked like any other edit.

On Cloudflare, the platform Worker serves the API and the review app through Static Assets, with one Durable Object with SQLite per System. Artifacts hold the Genome and app repositories and a fork per Task. A separate artyfact-ci Worker runs a Workflow, started through a cross-script binding, that builds app commits in a container and deploys previews and production. Agents push through the CLI submit command.

Direction, not shipped: several agents taking the same Task contract in parallel, keeping any version that meets it, and measuring outcomes against the theory of change.

## Judging criteria

- Originality (50%): the unit of version control is the product model, not the file tree. Interference, readiness and promotion are computed over model nodes, so a clean textual merge can still be flagged. One model connects the practices teams already use: it builds in the spec and the agent instructions, extends checks and release notes, and connects PRDs, personas and schemas.
- Multi-agent concurrency (25%): Task footprints from the model, deterministic conflicts and waves, one fork and one writer per Task, server-side refusal of dependent Tasks until their predecessors are selected, one integrated review, and a compare-and-swap promote in a Durable Object.
- User experience (25%): an agreement tree to accept a change node by node, a wave board with one claim command per Task, one review across all Tasks, verdicts that are never green without a pass, and a changelog and compare at System, Genome and file level.

## Features
- Home with a card per System and signifiers for evolving, pending, awaiting review, not built, deployed and observed.
- Describe a change in the browser or hand it to an agent: an agreement tree to agree, reject or defer node by node, then a plan of Tasks in waves with one claim command per Task (`artyfact task claim`), a task packet and a real Git push to a fork.
- Intent edits: a message is routed through the Genome tree by the ontology engine and becomes ops to review and accept. Artyfact describes itself with ten Things in the same format.
- Changelog and Compare across System, Genome and file level.
- Preview builds and production deployments through the CI Worker, with a health check on the deployed preview.
- Visual checks: Clef judges screenshots of the preview, taken with Browser Run at desktop and mobile sizes or attached with `artyfact task submit --screenshot`, and stored in R2. Artyfact judges its own /model page this way.
- How it works: a public page drawn at build time from Artyfact's own Genome.
- Deployments page with runtime events from the running app, tied to the System commit.
- Parts: reusable packages with pinned versions, composed with recorded provenance.
- A fake platform (`FAKE_ARTIFACTS=1`) and Playwright specs that drive the use cases through the UI for Peopling and for Artyfact's own Genome.

## How Workers and Artifacts are used
- Workers: the platform Worker (Static Assets for the review app, a Hono API, a Queue consumer and the `SystemAuthority` Durable Object with SQLite); the `artyfact-ci` Worker (a Workflow, a container sandbox and an R2 cache), started by the platform through a cross-script Workflow binding; the site Worker on artyfact.ing.
- Artifacts: one namespace with a Genome repository and an app repository per System, plus a shared `platform` repository of templates and Rule Packs. Binding reads of commits and trees, a fork per Task, and scoped write tokens that expire with the claim's lease (15 minutes by default, at most 60). The CLI submit command is the primary push path; the Queue consumer for `cf.artifacts.repo.pushed` needs a per-fork subscription, created by hand.
- Workers AI and Browser Run: Cloudflare Clef (`@cf/cloudflare/clef`) through the AI binding is the default production judge and always judges visual criteria; Browser Run captures the CI preview at 1280×800 and 390×844, and screenshots are stored in R2.
- Concurrency: several agents fork, work and push at once, one writer per Task. The platform computes Task footprints and conflicts, orders dependent Tasks, integrates the selected results and promotes with a compare-and-swap.

## Not done on purpose
Platform-hosted agents, a reasoning-model evaluator beyond System One, paid runs and a Git-parity suite.

## Team
Team: solo — sahil.pro

## Open items
- Video URL.
- Eligibility: the official terms require the source to be under MIT, Apache-2.0 or a BSD 2/3-Clause licence, which is why the licence stays Apache-2.0, and they make US or Canada residency an eligibility condition.
