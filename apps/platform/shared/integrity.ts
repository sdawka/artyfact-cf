import type {
  AgreementEligibility, AgreementStatus, IntegrityDisposition, IntegrityReport, IntegritySnapshot,
} from "@artyfact/model";

export const INTEGRITY_POLICY_VERSION = "integrity.v1";
export const INTEGRITY_DEFAULT_CALLS = 200;
export const INTEGRITY_MAX_CALLS = 500;

export type IntegritySnapshotKind = "initial-preview" | "imported";
export type StoredIntegritySnapshot = IntegritySnapshot & {
  id: string;
  createdAt: string;
  kind: IntegritySnapshotKind;
};
export type IntegrityRunState = "queued" | "running" | "completed" | "failed" | "cancelled";
export type IntegrityProviderChoice = "auto" | "clef" | "jev" | "openrouter" | "off";
export interface IntegrityPreviewRequest { files: Record<string, string> }
export interface IntegritySnapshotResponse { snapshot: StoredIntegritySnapshot }
export interface IntegrityRunRequest {
  snapshotId?: string;
  provider?: IntegrityProviderChoice;
  model?: string;
  thresholds?: { confident?: number; review?: number };
  budget?: { maxCalls?: number };
  rerun?: boolean;
}
export interface IntegrityAgreement {
  status: AgreementStatus;
  actor: string;
  at: string;
  reportId: string;
  snapshotHash: string;
  dispositions: IntegrityDisposition[];
  eligibility: AgreementEligibility;
}
export interface IntegrityRun {
  id: string;
  systemId: string;
  state: IntegrityRunState;
  snapshotId: string;
  snapshotHash: string;
  provider: IntegrityProviderChoice;
  model?: string;
  requestedCalls: number;
  thresholds: { confident: number; review: number };
  attempt: number;
  createdAt: string;
  updatedAt: string;
  report?: IntegrityReport;
  agreement?: IntegrityAgreement;
  error?: { code: string; message: string };
  reviewUrl: string;
}
export interface IntegrityRunResponse { run: IntegrityRun }
export interface IntegrityRunsResponse { runs: IntegrityRun[] }
export interface IntegrityAgreementRequest {
  dispositions: Array<Pick<IntegrityDisposition, "findingId" | "decision" | "rationale">>;
}
export interface IntegrityReviewBinding {
  runId: string;
  reportId: string;
  snapshotHash: string;
  agreementStatus: AgreementStatus;
}
