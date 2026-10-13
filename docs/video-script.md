# Video script

Target length about 8 minutes, hard limits 5 to 10. Every command comes from [demo-runbook.md](demo-runbook.md); step numbers below refer to it. Timings for each step come from the runbook's recorded run, so the on-screen waits are real. Fixed names: System `system.peopling`, repos `peopling.genome` and `peopling.app`, namespace `artyfact`.

## Screen layout
- Browser with the platform UI at 1440 by 900 or larger.
- Two terminals side by side labelled "agent A" and "agent B". A third terminal "ops" for admin calls, shown when used.
- Optional small terminal with the event stream (step 3).
- The top bar shows "System One: fake provider". Say it once, early, and again at both conflict moments.

## Pre-flight checklist
- [ ] `npx wrangler login` and `cf auth login` show the same account (runbook step 0).
- [ ] `apps/platform/.dev.vars` has `ADMIN_TOKEN`, `ACCOUNT_ID`, `FAKE_S1=1`, `ALLOW_LOCAL_PREVIEW=1`. Never show it.
- [ ] Reset to a clean state first, so no forks from an earlier run exist (runbook "Reset"). A leftover fork makes start return 409 `fork-exists`.
- [ ] Bootstrap and import (`init`) are done before recording, unless you want them on camera (steps 1 and 2, about 10 s and 30 s).
- [ ] The `export` block from step 0 is run in every terminal: ops, sse, A, B, C.
- [ ] Start tokens last six hours. Start work close to recording.
- [ ] Decide on the preview for agent A. With it, health passes. Without it, health stays `unknown` and the narration says why (step 5, optional preview).
- [ ] Do not expect real System One. Every judgment is canned and labelled fake.
- [ ] After recording, `rm -rf "$RUN"` to delete saved tokens.

## Beats

| Time | Beat | Runbook step | On screen | Say |
|---|---|---|---|---|
| 0:00 | The problem | none | Title card, then Overview | Git shows which files changed. It does not show whether two changes agree about the product. Here the System is the object. |
| 0:40 | The model | 2 | Map on `screen.people`, flip Genome, Proteome, Phenome | One model, three layers over the same nodes. The Phenome counters are grey because nothing is evaluated. Unknown is not green. 0 errors, 15 warnings, mostly unbound hooks. |
| 1:30 | Journeys and Theory | none | Journeys J.connect, Theory | Journeys are projections of the same model. The Theory is a set of hypotheses and says so. |
| 2:10 | Start two realizations | 4 | Work board, Evolution `evolution.1`; or the two `curl` calls in ops. About 4 s each. | Starting work forks the app repo, waits for the fork, issues a six-hour token and a secret, and builds a packet from the Genome. Start is admin only. |
| 2:50 | Two agents in parallel | 5 | Terminals A and B: `artyfact start`, edit, `artyfact checkpoint`. Event stream shows both checkpoints. | Agents run on this machine with any harness. The platform supplies the task, the workspace and the checks. |
| 3:50 | Submit both | 6 | `artyfact submit` in A then B; about 3 to 4 s each | Hooks run per criterion. `C.system.promotion` is unknown at submit: it can only be settled at promotion. Rows marked not-run are assays that run in CI. |
| 4:20 | Moment 1: the conflict | 7 | B's submit prints the conflict line. Then the Work card's ≈ overlap chip, the Map with candidates on, and the overlap chip into Review. | See below. |
| 5:20 | Promote A, B is stale | 8 | Review (`g r`): the promotion desk for `evolution.1`, or the `curl` in ops. About 2 s. | Promotion re-runs the hooks on the exact commit and swaps the head in one transaction. A goes through. B was built on the old head and gets 409 stale-base; its queue row reads "behind by 1" and the desk prints the rebase line for the agent. |
| 6:00 | Moment 2: rule violation | 9 | Terminal C, then Review: the amendment row for `realization.5.r5` and its Amendment tab | See below. |
| 6:50 | Moment 2: deliberate choice | 10 | Terminal C, new realization, accept from Review's Amendment tab | See below. |
| 7:40 | History and close | 10 | Changelog timeline, README architecture diagram | One System commit per decision, with the manifest hash and the evidence provider. Everything runs on one Worker, Artifacts, a Queue consumer and one Durable Object. |

## Moment 1: different files, same meaning (step 7)

Setup. Agent A changed `public/people/add-contact-dialog.js`. Agent B changed `src/worker/routes/contacts.ts`. No file is shared.

On screen. B's submit ends with `conflict [soft-semantic] operation.contact.save: Different files, but both touch nodes operation.contact.save.` Show the conflicts call, where `paths` is empty and `nodes` holds `operation.contact.save`. Show the Work card for `evolution.1` with its ≈ overlap chip and "1 awaits review" line, then the Map with candidates on, where the double bracket and the overlap chip sit on `operation.contact.save`. Click the chip (`overlap · 2`): it opens Review with both candidates preselected.

Say. The platform maps each candidate's files to Genome nodes through the app's source map. Both reach the same operation. That overlap is derived from the model and the source map, with no language model involved. System One is also asked whether the changes interfere. Here it answers 0.05, which means no, but this is the fake provider and its answer is always the benign one. So the overlap is the signal, and the interference number is not.

Also mention. Re-submitting the same commit returns the same candidate (`created: false`). Promotion treats a soft overlap as an advisory that the rationale must address.

## Moment 2: a rule violation, then a deliberate choice (steps 9 and 10)

Amendment one. Agent C edits `entity.MessageDraft` in `thing.webapp/section.domain/entity.MessageDraft/node.yaml` and adds a recipients list. On submit, `C.system.topology` is `fail`. In Review, open the amendment row and show the delta, the finding `topology.recipientArray` with its derivation of two facts, and System One's row. Then show accept refused with 409 `blocked`, and the admin rejecting with a reason on the Amendment tab; the row leaves the queue. Show that agent C's next `artyfact status` gets 403, because reject revokes its secret.

Say. The violation is the rules engine's finding, with a proof. System One is the fake provider, so it calls this change a deliberate choice. That is wrong, and it does not matter, because the gate does not rely on it. With a real key the same step uses the real model. The admin rejects it with a written reason.

Amendment two. Agent D rewords `commitment.no-engagement-mechanics` in `commitment.no-engagement-mechanics/node.yaml`. No rule fires. Review's Amendment tab shows the signals, labelled fake, with the calm "deliberate choice, no rule violated" line. The admin accepts with an interpretation. Show the new Genome commit, 0 errors in the model, and Changelog with the evidence provider `fake` on the commit.

Say. A new wording can look like a violation when it is a decision. The platform shows its evidence, says how sure the model is and leaves the call to a person, who records why.

## Not on camera
- The Queue consumer. Pushes reach it only through a per-fork repository subscription, which is not created automatically, so the CLI submit path is what the video shows.
- Bootstrap. The video uses `scripts/bootstrap.sh`, a wrapper over `npx artyfact init` (runbook step 2).

## Screenshots
All taken from a local run of this runbook with `FAKE_S1=1`, saved in `docs/images/`.

| File | Shows |
|---|---|
| `map-candidates.png` | Map with a candidate halo and the overlap chip on `operation.contact.save` |
| `work-conflict.png` | Work, two realizations, soft-semantic chip (retake: the card now carries the ≈ overlap chip and the awaits-review line; Promote is gone) |
| `amendment-violation.png` | Amendment review blocked by `topology.recipientArray` (retake on Review, not Work) |
| `amendment-deliberate.png` | Amendment review for the reworded commitment, fake provider labelled (retake on Review, not Work) |
| `map-screen-people-phenome.png`, `journeys-connect.png`, `theory.png`, `overview.png` | The Genome views |
