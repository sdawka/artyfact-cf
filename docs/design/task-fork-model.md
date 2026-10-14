# Task fork model

The contract for a Task fork that carries the pinned model, for the model delta a Task may submit, and for the
criteria layers that judge a candidate. Wire types: `apps/platform/shared/lifecycle.ts` (`TaskModel`, `Task.model`,
`LifecycleTaskPacket.model` / `.checkLayers`, `TaskCandidateReview.model`, `TaskReview.layers`,
`IntegratedBinding.model`, `ImplementationReview.modelDelta`, `PlanPromoteRequest.acceptModelDelta`) and
`apps/platform/shared/api.ts` (`Candidate.model`, `CandidateModel`). Layer helper: `layerOf` in `@artyfact/model`.

## 1. The fork holds the pinned model

The ontology changes first (an accepted Evolution); a Plan is pinned to that Genome revision; a Task realizes named
nodes of it. The Task fork is therefore the app repo **plus the pinned Genome under `system/`**, so the agent works
from the whole model, not an excerpt.

- At claim the Worker forks the app repo (as today), then pushes one commit over git with a short-lived write token:
  the pinned Genome's files (YAML and the intent sidecars, the layout `genomePrefix` already reads) under `system/`,
  replacing any `system/` the base carried. The commit is recorded as `Task.model = {prefix: "system", genomeCommit,
  commit}` by `lifecycleActivate`; the agent's clone starts at it. A fork whose base already holds a full `system/`
  (a downstream task forked from a predecessor's candidate) keeps it: the predecessor's model edits are part of what was
  selected. Forks the platform makes from the app base (claim, fan-in, integration) are all seeded the same way.
- Resume never re-seeds unless the fork head is still the unseeded base (a first claim that failed after the fork).
- A candidate commit with no `system/` at all (a workspace that never carried the model) did not touch the model: no
  delta, no review. Only Genome source files (YAML and the two intent sidecars) are the model; a README or build
  output beside them is neither seeded nor a delta.
- `system/` is read-only by default. The brief (`TASK_PACKET.md`) says the model is in `system/<path>` for each read
  and write node (`LifecycleTaskPacket.model.nodeFiles`, from `SystemModel.origin`), and which node ids the Task
  realizes. `AGENTS.md` carries the same rule.
- Seeding never changes a code candidate's footprint: the code-side diff, the source map and the scope check ignore
  `system/**` (it is neither a protected path nor a code path for app checks). A candidate that leaves `system/`
  untouched behaves exactly as before.

## 2. The model delta (escape hatch)

When realization shows the model cannot be realized as written, the agent may edit `system/`; it says why in a
checkpoint. The platform then treats the candidate as code **and** a model proposal:

- At submit, the candidate's `system/` subtree is diffed against the pinned Genome tree (cross-repo tree-hash diff,
  the base is always the pinned Genome, never the fork's base). A non-empty diff gives `Candidate.model`
  (`CandidateModel`): the changed `system/**` paths, the semantic delta of the two loaded models (`diffModels`) and
  its node ids. The candidate manifest stores the same under `model`; the manifest hash covers it.
- Scope: `system/**` is permitted for app Tasks and `assays/**` stays protected. `system/**` paths map to the nodes
  their file declares (the inverse of `SystemModel.origin`), so the scope check can pass a model edit; the delta's
  ids are reported beside the Task's `writeNodes` so a reviewer sees drift at once.
- Validation: the platform runs System One `reviewGenome(base, candidate, delta)` (`hooks/system-one.ts`) over the
  whole ontology and stores the result as the candidate's review (DO `candidate_reviews`, the `GenomeCandidateReview`
  shape a Genome amendment uses) plus one Evaluation row `model-review` in the candidate's evidence, so the Review
  view and the CLI's submit output show the verdicts. With the provider off or simulated every judgment is `unknown`;
  the flow never throws on review.
- Integration replays model edits with the pinned Genome as the implicit base: two Tasks that both leave `system/`
  untouched never conflict, and the integrated commit holds a full model (seeded, then the edits). The integrated
  binding's `model` is the integrated delta; `ImplementationReview.modelDelta` names it.
- Promote: when a binding carries a model delta the request must say `acceptModelDelta: true` (else 409
  `model-delta-unreviewed`); the DO then moves `genomeSource`/`genomeCommit` to the integrated fork commit in the same
  compare-and-swap that moves the app head, exactly as `accept` does for a Genome amendment fork. Open plans pinned to
  the previous Genome are checked by `assertGenomeCompatible` as after any accept.

## 3. Criteria layers

Criteria already carry `targetKind: model | artifact | runtime | observation`; the platform uses it as a layer (Genome
candidates drop `artifact` gates, Evolution defaults pick by target). The contract names the layers explicitly without
a new Genome field:

| layer | targetKind | says | engines |
| --- | --- | --- | --- |
| `genome` | `model` | the model exists and is consistent | model-rules, system-one, llm |
| `realization` | `artifact` | the code realizes the pinned nodes | manifest, diff, vitest |
| `phenome` | `runtime`, `observation` | the running Thing behaves | http, browser |

`layerOf(criterion, hooks)` derives the layer from `targetKind`, falling back to the hooks' engines. It is surfaced as
`LifecycleTaskPacket.checkLayers`, rendered grouped in `TASK_PACKET.md`, and as `TaskReview.layers` /
`ImplementationReview.layers` so evidence can be grouped. A model delta is judged on the `genome` layer; the Task's
checks stay on theirs.

## Demo

`FAKE_MODEL_DELTA=1` with `FAKE_ARTIFACTS=1` also seeds one plan (`Model fit: People screen`, task `people-screen`)
whose submitted candidate changes `screen.people`'s route under `system/` beside a code change, so Review shows a
Task candidate with a model delta and System One's simulated judgment (`apps/platform/worker/artifacts/fake-platform.ts`,
`FAKE_ACTIVITY.modelTask`). It is off by default because the e2e specs count plans and queue items.

## Review view (for the UI slice)

`TaskReview.candidates[].model`, when present, renders beside the changed files: the changed `system/**` paths (same
file compare route, `taskReviewFile`), the delta's added / changed / removed ids against the Task's `writeNodes`, and
the System One signals (`review.signals`, `review.review` like the amendment panel), each with its verdict and
provider. Evidence rows group by `layers[evaluation.criterion]`. The plan review shows `modelDelta` with an
"Accept model change" checkbox that sets `acceptModelDelta` on promote; without it the button is disabled when a
`modelDelta` exists.
