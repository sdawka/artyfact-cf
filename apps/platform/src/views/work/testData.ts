import type { Candidate, Evaluation, Realization, SystemCommit } from "../../../shared/api";

export const SYSTEM = "system.keep-in-touch";

export const evaluation = (o: Partial<Evaluation> = {}): Evaluation => ({
  id: "eval.1",
  candidate: "cand.1",
  hook: "hook.webapp.exists",
  criterion: "C.webapp.exists",
  ownerId: "thing.webapp",
  subjectId: "thing.webapp",
  targetRef: "artifact.webapp@abc1234",
  execution: "completed",
  verdict: "pass",
  verifier: "fixture-verifier",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.250Z",
  observations: [{ file: "src/app.ts", found: true }],
  interpretation: "The app entry exists.",
  limitations: ["Checked file presence only"],
  provenance: { model: "none", inputHash: "sha256:feed", p: "0.93" },
  ...o,
});

export const realization = (o: Partial<Realization> = {}): Realization => ({
  id: "realization.1",
  evolution: "evolution.1",
  agent: { id: "agent-alpha", role: "implementer" },
  target: "app",
  workspace: { repo: "artifacts/webapp", fork: "fork-alpha", baseCommit: "0123456789abcdef", tokenExpiresAt: "2026-01-01T01:00:00.000Z" },
  status: "working",
  checkpoints: [{ at: "2026-01-01T00:00:00.000Z", summary: "Scaffolded the app", commit: "fedcba9876543210" }],
  ...o,
});

export const candidate = (o: Partial<Candidate> = {}): Candidate => ({
  id: "cand.1",
  realization: "realization.1",
  evolution: "evolution.1",
  commit: "fedcba9876543210",
  baseRevision: "head",
  changedPaths: ["src/app.ts", "src/odd.ts"],
  changedSubjects: ["thing.webapp", "unmapped:src/odd.ts"],
  genomeChanges: [],
  submittedAt: "2026-01-01T00:10:00.000Z",
  state: "evaluated",
  ...o,
});

export const commit = (o: Partial<SystemCommit> = {}): SystemCommit => ({
  id: "c0ffee0000000000",
  parent: null,
  genomeCommit: "9999999999999999",
  manifest: [{ artifact: "artifact.webapp", type: "app", repo: "artifacts/webapp", commit: "abcdef1234567890", scope: [] }],
  evolutions: ["evolution.1"],
  candidates: ["cand.1"],
  rejected: [],
  evidence: ["eval.1"],
  decision: { by: "admin", policy: "single-admin", rationale: "All gates pass", at: "2026-01-02T00:00:00.000Z" },
  ...o,
});
