# Video script (skeleton)

Target length 7 to 8 minutes, hard limits 5 to 10. Exact commands, clicks and timestamps are marked `TODO(runbook)` and get filled from `docs/demo-runbook.md` in the second pass. Nothing here invents a command.

## Screen layout
- Browser with the platform UI, large enough to read the Map.
- Two terminals side by side, one per agent, labelled "agent A" and "agent B".
- A small note on screen states whether System One is live or `FAKE_S1`. Say it aloud once.

## Pre-flight checklist
- [ ] Bootstrap done, repositories exist in Artifacts. `TODO(runbook)`
- [ ] System imported, Overview loads at the hosted URL. `TODO(runbook)`
- [ ] `ADMIN_TOKEN` set and ready to paste. Do not show it.
- [ ] Fork tokens are fresh (they last six hours). Start work close to recording.
- [ ] System One provider: live key present, or `FAKE_S1=1`. State which on screen.
- [ ] Agent harnesses start in both terminals. `TODO(runbook)`
- [ ] Preview URL host is on the allowlist, or health shows `unknown` and you say why.
- [ ] Screen recorder set to 1440 by 900 or larger.

## Beats

| Time | Beat | On screen | Say |
|---|---|---|---|
| 0:00 | The problem | Title card, then Overview | Git shows which files changed. It does not show whether two changes agree about the product. Here the System is the object. |
| 0:40 | The model | Map on `screen.people`, flip the layer switch Genome, Proteome, Phenome | One model, three layers over the same nodes. Phenome counters are grey because nothing has been evaluated. Unknown is not green. |
| 1:30 | Journeys and Theory, briefly | Journeys J.connect, Theory | Journeys are projections of the same model. The Theory is a set of hypotheses, labelled as such. |
| 2:10 | Start two realizations | Work board, Start work twice on the same Evolution | The platform forks, issues a scoped token and builds a packet from the Genome. `TODO(runbook)` for the exact Evolution and clicks. |
| 3:00 | Two agents in parallel | Both terminals: start command, agent running, checkpoints | Agents run on the user's machine. The platform only supplies tasks, workspaces and checks. `TODO(runbook)` for commands. |
| 4:00 | Moment one: conflict without a file clash | Work board conflict chips, Map candidate halos with the double bracket | The files do not overlap. The meaning does. See below. |
| 5:00 | Evaluations and promotion | Evaluations table, Promotion panel, promote candidate A, then try B | Hooks ran per criterion. Health is grey: no preview URL, so unknown. Promote A. B was built on the old head and gets 409 stale-base. |
| 6:00 | Moment two: Genome amendment | Amendment review, deliberate and violation rows | See below. |
| 7:00 | History and close | History timeline, README architecture diagram | One System commit per decision, with the manifest hash. Everything runs on Workers, Artifacts, a Queue and a Durable Object. |

## Moment one: soft-semantic conflict between two agents

Setup. Two realizations on two Evolutions, or two attempts that touch different files. Their changed paths do not overlap. Both change nodes that serve the same journey and are governed by `policy.ownerOnly` in the Keep in Touch Genome.

What the viewer should see. Each candidate shows conflict chips. The conflict is typed soft-semantic, not file. The Map, with candidates on, draws a bracket halo on each touched node and a double bracket with an "overlap" chip on the shared ones. The promotion panel lists the conflict as an advisory. Promote stays disabled until a rationale addresses it.

What to say. A file-based tool would merge both without a word. The platform compares the Genome nodes each candidate affects. If the shared nodes carry a journey or policy, it asks whether the two changes interfere, and shows the answer next to the evidence.

Commands and clicks: `TODO(runbook)`. Stale-base 409 on screen: `TODO(runbook)`.

## Moment two: Genome amendment, deliberate choice versus rule violation

Setup. A third agent targets the Genome and changes the model. One amendment is a coherent, unusual decision that no accepted rule forbids. The other contradicts a stated commitment or introduces an engagement measure the Purpose rules out.

What the viewer should see. The panel shows the semantic delta, the Readiness findings that were resolved and added, and System One's probabilities as plain numbers. The deliberate amendment gets a calm line: "deliberate choice, no rule violated", shown only when the top class is at 0.9 or more and nothing hard was added. The violating amendment gets a red row, "model flagged; admin decides", and Accept is disabled with the reason. Anything under 0.9 reads "review" and is never styled as a pass.

What to say. A new rule can look like a violation when it is a decision. The platform does not guess. It shows the evidence, labels how sure the model is and leaves the call to the admin, who writes the interpretation that gets stored with the commit.

Commands and clicks: `TODO(runbook)`. Accept action and Map re-render: `TODO(runbook)`.

## Screenshots and what to retake live

Taken now in fixture mode, saved in `docs/images/`:

| File | View | Retake live? |
|---|---|---|
| `map-screen-people-phenome.png` | Map, `screen.people`, Phenome layer | Yes. Needs candidate halos and real counters. |
| `journeys-connect.png` | Journeys, J.connect | No. Content is the Genome. |
| `theory.png` | Theory | No. |
| `work-board.png` | Work board | Yes. Needs two realizations and the soft-semantic conflict. |
| `overview.png` | Overview | Optional. |
| `amendment-deliberate.png` | Amendment review dev page | Yes. Needs a real amendment from the hosted app. |
| `amendment-hard.png` | Amendment review dev page | Yes. |
