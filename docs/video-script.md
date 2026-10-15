# Video script

Target length about 9 minutes, hard limits 5 to 10. Two parts: about 3 minutes on the public site https://artyfact.ing, then about 6 minutes on the platform with a real System. Every platform command comes from [demo-runbook.md](demo-runbook.md); step numbers below refer to it. Timings come from the runbook's recorded run of the older commands, so treat the waits as approximate. Fixed names: System `system.peopling`, repos `peopling.genome` and `peopling.app`, namespace `artyfact`.

## Screen layout
- Browser tab 1: https://artyfact.ing. Browser tab 2: the platform UI. Both at 1440 by 900 or larger.
- Two terminals side by side labelled "agent t1" and "agent t2", then "agent t3". A third terminal "ops" for the claim and admin commands, shown when used.
- Optional small terminal with the event stream (step 3).
- Part 2 runs on the hosted platform, a read-only demo. Its System One judgments, visual checks, intent translations and plan drafts are simulated, labelled "simulated", and a header pill says so. Say it once when Part 2 starts, and again at the rule moment.

## Pre-flight checklist
- [ ] artyfact.ing open in a tab, scrolled to the top.
- [ ] `pnpm exec wrangler login` and `cf auth login` show the same account (runbook step 0).
- [ ] For the optional local visual-check beat: `apps/platform/.dev.vars` has `ADMIN_TOKEN`, `ACCOUNT_ID` and the model keys, and `pnpm run dev` provides the Workers AI and Browser Run bindings. Never show it.
- [ ] Reset to a clean state first (runbook "Reset"), so no earlier forks or plans exist.
- [ ] `validate-genome` and `init` are done before recording (steps 1 and 2). Leave the import review pending so step 4 is live.
- [ ] The `export` block from step 0 is run in every terminal: ops, sse. The admin token is a shell variable in ops only and is passed inline to the commands that need it. Never export it in a shell that starts an agent.
- [ ] A claim's write token and lease last 15 minutes (`leaseSeconds` default 900 in `apps/platform/worker/lifecycle-service.ts`). Claim on camera and submit within 15 minutes. If a token expires, run `artyfact task resume` (runbook "Troubleshooting").
- [ ] Decide whether `claude -p` runs live or a prepared edit stands in for the agent. A live agent must finish inside the 15 minutes. Say which on camera.
- [ ] Do not expect real judgments on the hosted platform. They are simulated. Clef, Jev and Browser Run run only on your own account with `pnpm run dev`; `S1_PROVIDER` picks the judge.
- [ ] After recording, delete `./work` and `$RUN`.

## Part 1: the site (0:00 to 3:00)

The page scrolls in this order: hero, agent environment, practices, model, checkout story, Cloudflare. Follow the page, then open artyfact.ing/how-it-works for the last beat.

| Time | Beat | On screen | Say |
|---|---|---|---|
| 0:00 | The headline | artyfact.ing hero | "The next Git platform keeps track of the product, not just the files." GitHub knows which files changed. It does not know whether two changes agree about the product. When several agents work at once, that is the part that breaks. |
| 0:30 | The agent environment | "Give your coding agents the environment to thrive." Three columns | Agents need three things. Context: a brief cut from the model, with the pinned version, the nodes to change, the steps and the checks. Guardrails: a private fork, the paths they may write, and a promote that refuses unproven work. Freedom: any harness, their own approach. Running several agents on one contract is the direction we are taking it. |
| 1:00 | The practices | Scroll the "You know → In Artyfact" cards, Engineering first | These are practices teams already use, in separate files and tools. Artyfact keeps them and ties each one to the model. Some are built in: worktrees become a fork per Task, AGENTS.md a brief cut from the model, merge queues a compare-and-swap promote. Some are extended: CI gates, changelogs, LLM evals. Some are connected: PRDs, personas, journey maps, ERDs and tracking plans become part of the model. OKRs are marked partial: measurement is still in progress. |
| 1:35 | The model | "A model of the whole product, not just a spec." | A spec file is flat text. This is a model with levels: System, Thing, section, screen, component, down to one button. The purpose, the people, the journey, the data, the policy and the criteria attach to the parts they describe. We call it the Genome. |
| 2:00 | The checkout story | Click steps 1 to 7 of the stepper | This example is illustrative. Two agents work in parallel on one change, in different files. On GitHub: no conflicts, merged. Here, both touch the "Place order" step and its rule "guests can still check out", so the overlap is flagged. A asks for a login and fails the rule. B is integrated and promoted. A updates onto B and revises. Then deploy, observe, and the next change. |
| 2:30 | How it works | artyfact.ing/how-it-works: open "Work in parallel", then "Check each candidate" | This page is drawn from Artyfact's own model when the site is built. Ten phases, from describing the product to watching it run. Here the work fans out: each Task gets its own fork and its own agent. Each candidate is checked: deterministic hooks first, then Cloudflare Clef, which can also judge screenshots of the preview. Then the work joins in one review. |

## Transition (3:00)

Switch to the platform tab. Say: "Now the real platform, with a real System. Peopling is a small contacts app. Its purpose is to help you stay in touch with the people you choose." Then: "This is the hosted demo. Its model judgments are simulated, and the header says so. Run it on your own Cloudflare account and Clef, Jev and Browser Run do the judging."

## Part 2: the platform (3:05 to 9:00)

Each beat names the site claim it makes real.

| Time | Beat | Runbook step | On screen | Say | Site claim |
|---|---|---|---|---|---|
| 3:05 | Review the import | 4 | Review: the "Import" group, the containment tree, unmapped paths; accept | This is the model from the site, for a real app: the System, its Thing, sections, screens. An import is a claim about the code, so a person reviews it first. Until then no work can start: the platform answers 409 import-unreviewed. | Multi-level model; spec.md built in |
| 3:35 | Describe a change | 5 | Work, "Describe a change": message, routed path, agreement tree. Agree node by node, defer one, "Accept agreed" | A change request is agreed node by node, from the purpose down. Exactly what is agreed commits to the Genome. Deferred changes wait in a new proposal. Nothing is built yet. | PRDs and backlog connected |
| 4:20 | Plan the tasks | 6 | Terminal: `artyfact plan draft`, then `plan draft --create`. Plan view: Wave 1 with two tasks, Wave 2 with one | The planner splits the change into Tasks. Goals and contact events touch separate nodes, so they share a wave. The Today screen depends on both, so it waits. The conflicts come from the model, not from a language model. | Merge conflicts extended |
| 5:00 | Claim and run the agents | 7 | Wave 1 commands, "Copy all". Terminals t1 and t2: `artyfact task claim`, then `env -u ARTYFACT_ADMIN_TOKEN claude -p`, then `artyfact task submit` | Each claim makes a private fork and a 15-minute write token, and writes the brief: TASK_PACKET.md and AGENTS.md. The agent line unsets the admin token. The fork token is stored in the workspace, never printed. Any harness works. | Worktrees and AGENTS.md built in; context, guardrails, freedom |
| 5:45 | The dependent task | 8 | Terminal ops: `task claim` of t3, refused "blocked by t1, t2 (not yet selected)". Select both, claim again | A Task whose predecessors are not selected cannot start. The server refuses it. Once they are selected, its packet says what it builds on. | Merge queue and branch protection built in |
| 6:15 | Violation or choice | 5 | Work: a proposal with a rule finding; the node cannot be agreed. Then the deliberate wording change | See Moment 2. | Policy-as-code extended |
| 7:05 | Integrate, review, promote | 9 | Task detail select form; `plan integrate`, `plan review`, `plan promote` | Selected results become one candidate per binding and one review. Only pass is green; a check that did not run stays unknown and blocks. Promotion is a compare-and-swap on the System head. If the head moved since the review, it is refused. | CI gates and definition of done extended; merge queues built in |
| 7:40 | A real visual check | none | The evaluation from a local run: `C.site.model.compelling-visual-presentation`, two Browser Run captures of artyfact.ing/model, Clef 0.83, unknown | Off camera, a local run on my own account checked our own /model page. Clef judged the desktop and mobile captures at 0.83, no concern but low confidence. That is unknown, not a pass: a pass needs 0.9. The whole check took about 13 seconds. | CI gates extended; LLM evals extended |
| 7:55 | Changelog | 9 | Changelog timeline, Compare | One System commit per decision, with the manifest hash and the evidence provider. Compare the model or the files. | Changelogs extended |
| 8:15 | How it runs | none | Site "Built on Cloudflare" section (artyfact.ing/#cloudflare): the Artifacts diagram top to bottom, then the products below it | Artifacts is the backbone. The model and the app are Git repos. Each Task gets its own fork with a token for that fork only, and agents use plain git. The selected results are combined in an integration fork. Promote writes a System commit that pins the model commit and the app commit together, through a compare-and-swap in the System's Durable Object. The platform Worker serves the API and the review app. A separate CI Worker runs a Workflow that builds each commit in a container, with an R2 cache, and deploys. On your own account, Workers AI runs Cloudflare Clef and Browser Run takes the screenshots it checks. Feature flags come from Flagship. Email is coming soon. | Cloudflare section |
| 8:50 | Close | none | artyfact.ing hero | The next Git platform keeps track of the product, not just the files. artyfact.ing. | Headline |

Simulated steps on the hosted demo: the agent can be a prepared file edit, System One, visual checks, the translator and the planner draft are simulated, and CI builds and previews do not run (health stays unknown). The plan-to-promote walk has run on the fake platform, not on real Artifacts.

## Moment 1: independent, then ordered (steps 6 to 8)

Setup. The plan has waves `[[t1, t2], [t3]]`: goals (t1) and contact events (t2), then the Today screen (t3).

On screen. `artyfact plan tasks` shows the table with t3 depending on t1 and t2 and the two dependency conflicts. The wave board shows "Wave 1 · 2 tasks" and "Wave 2 · 1 task". Claim t3 early and show the refusal: `blocked by t1, t2 (not yet selected)`.

Say. The platform maps each Task's nodes to the files that realise them and to the nodes they read. Writes, reads and explicit dependencies decide interference, with no language model involved. Where the platform cannot tell, it says unknown and does not launch in parallel. This is the checkout story from the site, for real: overlap is found in the model, not in the diff.

## Moment 2: a rule violation, then a deliberate choice (step 5)

Violation. Describe a change that gives `MessageDraft` a recipients list. The proposal carries `topology.recipientArray` as a problem with its derivation of two facts, and the node cannot be agreed, so the change never reaches the Genome. System One is the fake provider and would call it a deliberate choice. That is wrong, and it does not matter, because the gate does not rely on it.

Deliberate choice. Reword `commitment.no-engagement-mechanics`. No rule fires, the node is agreed and "Accept agreed" commits it. Show the new Genome commit and 0 errors.

Say. A new wording can look like a violation when it is a decision. The platform shows its evidence, says how sure the model is and leaves the call to a person, who records why.

## Not on camera
- The Queue consumer. Pushes reach it only through a per-fork repository subscription, which is not created automatically, so the CLI submit path is what the video shows.
- Several agents on the same Task contract, and outcome measurement. The site shows them as direction. Say so if they come up; do not demo them.
- Bootstrap internals. The video uses `scripts/bootstrap.sh`, a wrapper over `npx artyfact init` (runbook step 2).

## Screenshots
Saved in `docs/images/`. The platform images below predate the plan flow and show the older realization views; retake them from a `FAKE_S1=1` run of steps 4 to 9 before publishing. Site screenshots, if needed, come from artyfact.ing at 1440 by 900.

| File | Shows |
|---|---|
| `work-conflict.png` | Older Work view with two realizations and a soft-semantic chip. Retake as the plan wave board with its dependency chips |
| `amendment-violation.png`, `amendment-deliberate.png` | Older amendment review. Retake as the agreement tree with a blocked node and an agreed one |
| `map-candidates.png` | Map with a candidate halo and the overlap chip on `operation.contact.save` (older flow) |
| `map-screen-people-phenome.png`, `journeys-connect.png`, `theory.png`, `overview.png` | The Genome views |
