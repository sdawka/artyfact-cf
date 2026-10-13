# 2026-10-14 — Tasks and local agents

Links: [[../execution]], [[../roadmap]], [[../analysis]]. Follows [[2026-10-13-peopling-rename]]. Filed for the delivery day; the work ran on 2026-10-13.

## What was built

An Evolution can now be planned into Tasks, and local agents claim them one at a time. Everything below sits on the `tasks-integration` branch, to land as one PR.

- **Plan.** `POST …/plan` splits an Evolution into Tasks and file-disjoint waves. A task's scope is the `files` globs bound to its nodes, matched against the app tree, and two tasks conflict by a declared dependency, a shared file, or shared nodes. Waves are 1-based. A model may propose the grouping (fake with `FAKE_S1=1`, OpenRouter otherwise); the platform validates it and falls back to a deterministic grouping. No model decides independence.
- **Start and claim.** `POST …/waves/:n/start` claims every task of a wave and returns one start line each. `POST /tasks/:id/claim` and `artyfact claim` take a single task. A claim and its fork reservation are one Durable Object transaction; a blocked task is 409 `task-blocked`, a held one `task-taken`. The task packet and `AGENTS.md` name the paths other tasks own.
- **Rebase on promote.** `POST …/realizations/:rid/rebase` replays a stale sibling's candidate onto the new head, so a wave's second task is not redone.
- **Agreement.** Intent proposals carry a plan tree with Agree, Reject and Defer per node; accept takes the agreed ops and moves deferred ones to a sibling proposal.
- **Bring in a System.** `artyfact skill --write`, `artyfact validate-genome`, and an import review that holds a new import until a person agrees or rejects each node.
- **UI.** Work, Plan with wave columns and task detail; Review's Import row and amendment tree; Home and rail signifiers (import awaits review, tasks await an agent, plan ready).
- **Data and docs.** Peopling `evolution.2` is bound to files and planned; the self-Genome has an Evolution for the new commands. The runbook, video script, submission, CLI README, skill and the two public pages describe the flow.

## Rulings and corrections

- `claim` stores the fork write token in `.artyfact.json` (0600, git-excluded). The orchestrator never sees it, so the claim, run, submit loop needs it at rest. Same exposure as the realization secret.
- A planned Evolution stays `realizing` until its last task is promoted. Genome candidates are gated by model criteria only. A deferred proposal is re-applied against the head when it is accepted. Import-review accept is a compare-and-swap, so a double click makes one amendment.
- **Start wave and `claim` are alternatives.** Start wave claims each task as `agent:<task>` and returns the credentials once, so a later `claim` is refused. The docs say to use one or the other; the plan's "Start wave, then claim" does not work.
- **Demo shapes** (checked on the merged data): Peopling `evolution.2` plans to three tasks, waves `[[t1,t2],[t3]]`; the self-Genome Evolution plans to two waves with a `file` conflict on `packages/cli/src/main.ts`. An earlier build of the data gave `[[t1],[t2]]` and one wave; the data fix restored the intended shapes.

## Deferred

Per-task PUT of a plan (all-or-nothing today); release leaves the old realization live; a clone that fails after a claim loses the once-only credentials (release and claim again); the planner is untested against the live model; live Artifacts push for rebase and claim; import-review guards on the plan, start-wave and claim routes (integration item); `refines` links into a rejected import node are not unlinked.

## Evidence and state

At `527f1cf` the platform suite passes (1128 tests, 2 skipped), typecheck is clean and the plan end-to-end spec passes. In this docs slice the site suite passes (59 units, 11 static checks) and the CLI suite passes (117). Import review, the Review view and the Peopling and self-Genome data were built in separate branches and are verified there, not yet together. Hosted CI, the user's deploy, DO version-skew wait and the production walk (Home, Review, Work, Plan) are unverified. Remote GRREAT sync stays pending. Canonical records validate (7 records). The versioned sync preview ran and applied zero commands; it proposes six new records in the existing workspace, so sync stays pending until a separate Artyfact destination exists.
