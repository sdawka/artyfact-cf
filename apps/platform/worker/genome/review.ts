/**
 * Genome candidate review (admin amendment panel). Built once at submission from the base and candidate
 * Genomes plus the hooks' `runGenome` result, persisted per candidate, served by `GET …/review`.
 */
import type { Readiness, SemanticDelta as ModelDelta, SystemModel } from "@artyfact/model";
import type { ReviewResult, SemanticChange, SemanticDelta } from "@artyfact/semantic";
import type { Evaluation, GenomeCandidateReview } from "../../shared/api";
import type { DeltaReview } from "../hooks/contract";

/** Model diff → the semantic package's change list (same mapping the hooks use for System One). */
export function semanticDelta(base: SystemModel, cand: SystemModel, d: ModelDelta): SemanticDelta {
  const kindOf = (id: string) => (cand.index.byId[id] ?? base.index.byId[id])?.kind ?? "unknown";
  const mk = (id: string, fieldsChanged: string[]): SemanticChange => ({
    id, kind: kindOf(id), before: base.index.byId[id]?.item ?? null, after: cand.index.byId[id]?.item ?? null, fieldsChanged,
  });
  return {
    changes: [
      ...d.added.map((id) => mk(id, Object.keys((cand.index.byId[id]?.item as object) ?? {}))),
      ...d.changed.map((c) => mk(c.id, c.fields)),
      ...d.removed.map((id) => mk(id, [])),
    ],
  };
}

const isReviewResult = (x: unknown): x is ReviewResult => !!x && typeof x === "object" && "changeClass" in x && "contradicts" in x;

export interface ReviewInput {
  candidate: string;
  base: SystemModel;
  /** Null when the candidate Genome does not load. */
  cand: SystemModel | null;
  /** Why the candidate Genome does not load (set exactly when `cand` is null). */
  loadError?: string;
  delta: ModelDelta | null;
  readinessBase: Readiness;
  run: { readiness: Readiness; review: DeltaReview[]; evaluations: Evaluation[] };
}

export function buildGenomeReview(i: ReviewInput): GenomeCandidateReview {
  return {
    candidate: i.candidate,
    delta: i.cand && i.delta ? semanticDelta(i.base, i.cand, i.delta) : { changes: [] },
    readinessBase: i.readinessBase,
    readinessCandidate: i.run.readiness,
    review: i.run.review.filter((r) => r.judgment === "reviewDelta").map((r) => r.signals).filter(isReviewResult),
    signals: i.run.review,
    evaluations: i.run.evaluations,
    commitments: (i.base.description?.commitments ?? []) as GenomeCandidateReview["commitments"],
    ...(!i.cand && { loadError: i.loadError ?? "the candidate Genome does not load" }),
  };
}
