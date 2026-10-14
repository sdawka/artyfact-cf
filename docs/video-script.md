# Video script

Target length about 8 minutes, hard limits 5 to 10. Every command comes from [demo-runbook.md](demo-runbook.md); step numbers below refer to it. Timings come from the runbook's recorded run of the older commands, so treat the waits as approximate. Fixed names: System `system.peopling`, repos `peopling.genome` and `peopling.app`, namespace `artyfact`.

## Screen layout
- Browser with the platform UI at 1440 by 900 or larger.
- Two terminals side by side labelled "agent t1" and "agent t2", then "agent t3". A third terminal "ops" for the claim and admin commands, shown when used.
- Optional small terminal with the event stream (step 3).
- The top bar shows "System One: fake provider". Say it once, early, and again at the rule moment.

## Pre-flight checklist
- [ ] `npx wrangler login` and `cf auth login` show the same account (runbook step 0).
- [ ] `apps/platform/.dev.vars` has `ADMIN_TOKEN`, `ACCOUNT_ID`, `FAKE_S1=1`, `ALLOW_LOCAL_PREVIEW=1`. Never show it.
- [ ] Reset to a clean state first (runbook "Reset"), so no earlier forks or plans exist.
- [ ] `validate-genome` and `init` are done before recording, unless you want them on camera (steps 1 and 2, about 10 s and 30 s). Leave the import review pending so step 4 is live.
- [ ] The `export` block from step 0 is run in every terminal: ops, sse. The admin token is a shell variable in ops only and is passed inline to the commands that need it. Never export it in a shell that starts an agent.
- [ ] Task tokens last six hours. Claim close to recording.
- [ ] Decide whether `claude -p` runs live or a prepared edit stands in for the agent; say which.
- [ ] Do not expect real System One. Every judgment is canned and labelled fake. The fake translator proposes one op per message, so the deferral beat needs the real translator or is narrated over the tests.
- [ ] After recording, delete `./work` and `$RUN`.

## Beats

| Time | Beat | Runbook step | On screen | Say |
|---|---|---|---|---|
| 0:00 | The problem | none | Title card, then Overview | Git shows which files changed. It does not show whether two changes agree about the product. Here the System is the object. |
| 0:40 | The model | 2 | Terminal: `artyfact validate-genome`, then `init`. Map on `screen.people`, flip Genome, Proteome, Phenome | The Genome is checked before anything is pushed. One model, three layers over the same nodes. The Phenome counters are grey because nothing is evaluated. Unknown is not green. |
| 1:30 | Review the import | 4 | Review: the "Import" group, the containment tree, unmapped paths; accept | An imported System is a claim about the code, so a person reviews it first. Until it is accepted, no work can start: the platform answers 409 import-unreviewed. |
| 2:10 | Describe a change | 5 | Work, "Describe a change": message, routed path, agreement tree. Agree node by node, defer one, "Accept agreed" | The change is agreed node by node, and exactly what is agreed commits to the Genome. Deferred changes wait in a new proposal. Nothing is built yet. |
| 3:10 | Plan the tasks | 6 | Terminal: `artyfact plan draft`, then `plan create`. Work plan view: Wave 1 with two tasks, Wave 2 with one | The planner splits the accepted change into tasks. Goals and contact events are independent, so they share a wave. The Today screen invokes both, so it waits. |
| 4:00 | Claim and run the agents | 7 | Wave 1 commands, "Copy all". Terminals t1 and t2: `artyfact task claim`, then `env -u ARTYFACT_ADMIN_TOKEN claude -p`, then `artyfact task submit` | The admin token is used for the claim only. The agent line unsets it, and the fork token is stored in the workspace, never printed. Agents run on this machine with any harness. |
| 5:00 | The dependent task | 8 | Terminal ops: `task claim` of t3, refused "blocked by t1, t2 (not yet selected)". Then select both, claim again | A task whose predecessors are not selected cannot start. Once they are, its packet says what it builds on. |
| 5:50 | Moment 2: violation or choice | 5 | Work: a proposal with a rule finding; the node cannot be agreed | See below. |
| 6:40 | Select, integrate, promote | 9 | Task detail select form; `plan integrate`, `plan review`, `plan promote`; Changelog | Selected results integrate into one candidate per binding and one review. Promotion re-runs the gate on the exact commits and records the Genome actually realized. If the Genome moved under the plan, it says replan. |
| 7:40 | History and close | 9 | Changelog timeline, README architecture diagram | One System commit per decision, with the manifest hash and the evidence provider. Everything runs on one Worker, Artifacts, a Queue consumer and one Durable Object. |

Fake-only steps: the agent can be a prepared file edit, System One and the translator are canned, and CI builds and previews do not run (health stays unknown). The plan-to-promote walk has run on the fake platform, not on real Artifacts.

## Moment 1: independent, then ordered (steps 6 to 8)

Setup. The plan has waves `[[t1, t2], [t3]]`: goals (t1) and contact events (t2), then the Today screen (t3).

On screen. `artyfact plan tasks` shows the table with t3 depending on t1 and t2 and the two dependency conflicts. The wave board shows "Wave 1 · 2 tasks" and "Wave 2 · 1 task". Claim t3 early and show the refusal: `blocked by t1, t2 (not yet selected)`.

Say. The platform maps each task's nodes to the files that realise them and to the nodes they read. Writes, contracts and explicit dependencies decide interference, with no language model involved. Where the platform cannot tell, it says unknown and does not launch in parallel.

## Moment 2: a rule violation, then a deliberate choice (step 5)

Violation. Describe a change that gives `MessageDraft` a recipients list. The proposal carries `topology.recipientArray` as a problem with its derivation of two facts, and the node cannot be agreed, so the change never reaches the Genome. System One is the fake provider and would call it a deliberate choice. That is wrong, and it does not matter, because the gate does not rely on it.

Deliberate choice. Reword `commitment.no-engagement-mechanics`. No rule fires, the node is agreed and "Accept agreed" commits it. Show the new Genome commit and 0 errors.

Say. A new wording can look like a violation when it is a decision. The platform shows its evidence, says how sure the model is and leaves the call to a person, who records why.

## Not on camera
- The Queue consumer. Pushes reach it only through a per-fork repository subscription, which is not created automatically, so the CLI submit path is what the video shows.
- Bootstrap internals. The video uses `scripts/bootstrap.sh`, a wrapper over `npx artyfact init` (runbook step 2).

## Screenshots
Saved in `docs/images/`. The images below predate the plan flow and show the older realization views; retake them from a `FAKE_S1=1` run of steps 4 to 9 before publishing.

| File | Shows |
|---|---|
| `work-conflict.png` | Older Work view with two realizations and a soft-semantic chip. Retake as the plan wave board with its dependency chips |
| `amendment-violation.png`, `amendment-deliberate.png` | Older amendment review. Retake as the agreement tree with a blocked node and an agreed one |
| `map-candidates.png` | Map with a candidate halo and the overlap chip on `operation.contact.save` (older flow) |
| `map-screen-people-phenome.png`, `journeys-connect.png`, `theory.png`, `overview.png` | The Genome views |
