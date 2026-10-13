// Synthetic GenomeCandidateReview data for tests and the dev-only fixture page (amendment-dev.html).
import type { Candidate, DeltaReview, Finding, GenomeCandidateReview, Readiness, Realization } from "../../../../../shared/api";

export const SYSTEM_ID = "system.peopling";
export const RID = "realization.1";
export const EID = "evolution.1";
export const CHANGED = "section.purpose";
export const COMMITMENT = "C.system.purpose";

export const CLASSES = ["deliberate-nonstandard-choice", "unresolved-interpretation", "hard-rule-violation", "clarification"] as const;
export type ChangeClass = (typeof CLASSES)[number];

export const realization: Realization = {
  id: RID,
  evolution: EID,
  agent: { id: "agent.drafter", harness: "claude-code", role: "implementer" },
  target: "genome",
  workspace: { repo: "genome", fork: "forks/genome-r1", baseCommit: "a1b2c3d4e5f6" },
  status: "submitted",
  checkpoints: [],
  candidate: "candidate.1",
};

export const candidate: Candidate = {
  id: "candidate.1",
  realization: RID,
  evolution: EID,
  commit: "9f8e7d6c5b4a",
  baseRevision: "a1b2c3d4e5f6",
  changedPaths: ["sections/purpose.yaml"],
  changedSubjects: [CHANGED],
  genomeChanges: [CHANGED],
  submittedAt: "2026-10-12T09:00:00.000Z",
  state: "submitted",
};

export function finding(level: Finding["level"], rule: string, subject: string, message: string): Finding {
  return {
    level,
    rule,
    subject,
    message,
    facts: [],
    derivation: {
      relation: "violation",
      tuple: [rule, subject],
      rule: `${rule}:12`,
      edb: false,
      children: [{ relation: "node", tuple: [subject], edb: true, children: [] }],
    },
  };
}

export function readiness(findings: Finding[]): Readiness {
  return { snapshotHash: "h", packs: [], findings, derived: {}, incomplete: false, actionable: findings.every((f) => f.level !== "error") };
}

/** A DeltaReview whose `changeClass` has `top` at probability `p` (the rest is spread evenly). */
export function judged(top: ChangeClass, p: number, over: Partial<DeltaReview> = {}): DeltaReview {
  const rest = (1 - p) / (CLASSES.length - 1);
  return {
    id: CHANGED,
    changeClass: {
      choice: top,
      outcome: top,
      probabilities: Object.fromEntries(CLASSES.map((c) => [c, c === top ? p : rest])),
      confidence: p,
    },
    contradicts: { [COMMITMENT]: 0.04 },
    weakens: 0.06,
    specificity: { score: 2, probabilities: { "0": 0.02, "1": 0.08, "2": 0.85, "3": 0.05 }, confidence: 0.85 },
    touchesConsent: 0.03,
    level: top === "hard-rule-violation" && p >= 0.9 ? "error" : "info",
    verdict: "unknown",
    provenance: { provider: "typesafe", model: "jev-1", questionHash: "q", stateHash: "s", thresholds: { confident: 0.9, review: 0.5 }, ms: 420, usage: { input_tokens: 0, output_tokens: 0 } },
    ...over,
  };
}

export function makeReview(over: Partial<GenomeCandidateReview> = {}): GenomeCandidateReview {
  return {
    delta: {
      changes: [
        {
          id: CHANGED,
          kind: "section",
          before: { description: "Why the System exists." },
          after: { description: "Peopling deliberately has no feed, so nothing is optimised for time spent." },
          fieldsChanged: ["description"],
        },
      ],
    },
    readinessBase: readiness([]),
    readinessCandidate: readiness([]),
    review: [judged("deliberate-nonstandard-choice", 0.93)],
    evaluations: [],
    ...over,
  };
}
