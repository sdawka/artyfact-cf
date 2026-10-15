/**
 * System One over a Task's model delta (docs/design/task-fork-model.md §2): the candidate's model is loaded from its
 * `system/`, judged against the pinned Genome with the same `reviewGenome` a Genome amendment gets, stored as the
 * candidate's review (the amendment review's shape) and folded into one Evaluation row of its evidence. The provider
 * off or simulated gives `unknown` judgments; a thrown review becomes `reviewUnavailable`, never a failed submit.
 */
import type { schema, SystemModel, TemplateStore } from "@artyfact/model";
import type { CandidateModel, Evaluation, GenomeCandidateReview } from "../shared/api";
import { buildGenome, type LoadedGenome } from "./artifacts/genome-source";
import { withRepo, type ArtifactsNamespaceLike } from "./artifacts/client";
import { buildGenomeReview } from "./genome/review";
import { systemOneFor } from "./hooks";
import type { DeltaReview } from "./hooks/contract";
import { toEvaluation } from "./hooks/provenance";
import { aggregate, reviewGenome, reviewsAsJudged, reviewUnavailable } from "./hooks/system-one";
import { readModelFiles, type GenomeRef } from "./lifecycle-model";

export const MODEL_REVIEW_HOOK = "model-review";
export const MODEL_REVIEW_CRITERION = "C.model.review";

/** The platform's own criterion for a Task's model delta (a `genome` layer check; the Genome need not declare it). */
export function modelReviewCriterion(m: SystemModel): schema.Criterion {
  return {
    id: MODEL_REVIEW_CRITERION, version: 1, title: "Model change fits the ontology", claim: "A Task's change to the pinned model is acceptable against the whole ontology (System One reviewDelta, topology and purpose).",
    ownerKind: "system", ownerId: m.system.id, subjectKind: "system", subjectId: m.system.id, targetKind: "model", sourceRefs: [], refines: [], satisfies: [],
    severity: "soft", gates: [], deferred: false, hooks: [],
  };
}

export interface ModelReviewInput { candidateId: string; commit: string; fork: GenomeRef; genome: GenomeRef; base: LoadedGenome; model: CandidateModel; templates: TemplateStore }

/** Review the delta and build the evidence: the stored review and the evaluation row. */
export async function reviewTaskModel(env: Env, ns: ArtifactsNamespaceLike, i: ModelReviewInput): Promise<{ review: GenomeCandidateReview; evaluation: Evaluation }> {
  const startedAt = new Date().toISOString();
  let cand: LoadedGenome | null = null, loadError = i.model.loadError;
  if (!loadError) {
    try {
      const files = await withRepo(ns, i.fork.repo, (r) => readModelFiles(r, i.fork.commit));
      cand = buildGenome(files, i.fork.commit, i.templates);
    } catch (e) {
      loadError = (e as Error)?.message ?? String(e);
    }
  }
  let reviews: DeltaReview[];
  if (!cand) reviews = [reviewUnavailable(i.candidateId, `System One review did not run: the candidate model does not load (${loadError}).`)];
  else {
    try {
      reviews = await reviewGenome(systemOneFor(env), i.base.model, cand.model, i.model.delta, cand.readiness.derived);
    } catch (e) {
      reviews = [reviewUnavailable(i.candidateId, `System One review did not run: ${(e as Error)?.message ?? e}.`)];
    }
  }
  const review = buildGenomeReview({ candidate: i.candidateId, base: i.base.model, cand: cand?.model ?? null, loadError, delta: cand ? i.model.delta : null, readinessBase: i.base.readiness, run: { readiness: cand?.readiness ?? i.base.readiness, review: reviews, evaluations: [] } });
  const outcome = aggregate(reviewsAsJudged(reviews), "model delta");
  if (!cand) outcome.verdict = "fail";
  outcome.observations.unshift({ changedNodes: i.model.changedNodes, changedPaths: i.model.changedPaths, genomeCommit: i.genome.commit, ...(i.model.outsideWriteNodes?.length && { outsideWriteNodes: i.model.outsideWriteNodes }) });
  if (i.model.outsideWriteNodes?.length) outcome.limitations.push(`Model files outside the Task's write nodes: ${i.model.outsideWriteNodes.join(", ")}; promotion needs the coordinator to accept the model delta.`);
  const evaluation = toEvaluation({ candidate: i.candidateId, hook: { id: MODEL_REVIEW_HOOK, engine: "system-one" }, criterion: modelReviewCriterion(i.base.model), targetRef: i.commit, startedAt, finishedAt: new Date().toISOString() }, outcome);
  return { review, evaluation };
}
