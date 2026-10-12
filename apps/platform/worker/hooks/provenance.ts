/**
 * Evaluation construction. Engines return an `Outcome`; `toEvaluation` stamps the identity fields. Helpers here are
 * the only places that produce `not-run` and `error` outcomes, so no path turns a failure into `pass`.
 */
import type { schema } from "@artyfact/model";
import type { Evaluation } from "./contract";

export const VERIFIER = "artyfact-platform";
/** Bumped when engine semantics change; recorded in every Evaluation's provenance. */
export const ENGINE_VERSION = "1";

export interface Outcome {
  execution: schema.Execution;
  verdict: schema.Verdict;
  observations: unknown[];
  interpretation?: string;
  limitations: string[];
  /** Extra provenance; values are stringified. */
  provenance?: Record<string, unknown>;
}

export interface EvaluationIdentity {
  candidate: string;
  hook: schema.AssayHook | { id: string; engine?: string; version?: number };
  criterion: schema.Criterion;
  targetRef: string;
  startedAt: string;
  finishedAt: string;
}

/** Provenance values must be strings (schema): objects become JSON, undefined is dropped. */
export function stringifyProvenance(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

export function evaluationId(candidate: string, hook: string, criterion: string): string {
  return `${candidate}:${hook}:${criterion}`;
}

export function toEvaluation(id: EvaluationIdentity, o: Outcome): Evaluation {
  return {
    id: evaluationId(id.candidate, id.hook.id, id.criterion.id),
    candidate: id.candidate,
    hook: id.hook.id,
    criterion: id.criterion.id,
    ownerId: id.criterion.ownerId,
    subjectId: id.criterion.subjectId,
    targetRef: id.targetRef,
    execution: o.execution,
    verdict: o.verdict,
    verifier: VERIFIER,
    startedAt: id.startedAt,
    finishedAt: id.finishedAt,
    observations: o.observations,
    ...(o.interpretation !== undefined && { interpretation: o.interpretation }),
    limitations: o.limitations,
    provenance: stringifyProvenance({
      engine: id.hook.engine ?? "none",
      engineVersion: ENGINE_VERSION,
      hookVersion: id.hook.version ?? 1,
      ...o.provenance,
    }),
  };
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/** The engine threw or could not run as configured: never a verdict. */
export function errored(e: unknown, extra: Partial<Outcome> = {}): Outcome {
  return {
    execution: "error",
    verdict: "unknown",
    observations: [{ error: errorMessage(e) }, ...(extra.observations ?? [])],
    limitations: extra.limitations ?? [],
    ...(extra.interpretation !== undefined && { interpretation: extra.interpretation }),
    ...(extra.provenance && { provenance: extra.provenance }),
  };
}

/** The hook was selected but cannot or should not run now (required-gate coverage). */
export function notRun(reason: string, extra: Partial<Outcome> = {}): Outcome {
  return {
    execution: "not-run",
    verdict: "unknown",
    observations: extra.observations ?? [],
    limitations: [reason, ...(extra.limitations ?? [])],
    ...(extra.provenance && { provenance: extra.provenance }),
  };
}
