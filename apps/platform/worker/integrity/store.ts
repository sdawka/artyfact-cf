import { agreementEligibility, integrityStatus, type IntegrityDisposition, type IntegrityFinding, type IntegrityReport, type IntegritySnapshot } from "@artyfact/model";
import {
  INTEGRITY_POLICY_VERSION, type IntegrityAgreement, type IntegrityAgreementRequest, type IntegrityProviderChoice,
  type IntegrityReviewBinding, type IntegrityRun, type IntegrityRunRequest, type IntegrityRunState, type IntegritySnapshotKind, type StoredIntegritySnapshot,
} from "../../shared/integrity";
import { DEFAULT_THRESHOLDS, hashOf } from "@artyfact/ontology";
import { canonicalJson, nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;
const MAX_CHECKPOINT_ROW = 64 * 1024;
const MAX_CHECKPOINTS = 10 * 1024 * 1024;
const MAX_REPORT = 512 * 1024;
const LEASE_MS = 5 * 60_000;
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length;
const invalid = (message: string): never => { throw new Error(`[invalid-state] ${message}`); };

export interface IntegrityLease { run: IntegrityRun; snapshot: StoredIntegritySnapshot; token: string }

function boundedReport(report: IntegrityReport): IntegrityReport {
  if (bytes(report) <= MAX_REPORT) return report;
  const bounded = structuredClone(report);
  const truncation: IntegrityFinding = {
    id: `semantic.${hashOf({ code: "report.truncated", snapshot: report.snapshotHash })}`,
    section: "semantic", severity: "review", code: "report.truncated",
    message: "The stored integrity report was truncated to its durable size limit.", subjects: [], evidence: [],
    suggestion: "Run a narrower review or reduce the evaluated Genome before accepting findings.",
  };
  bounded.semantic.limitations = [...bounded.semantic.limitations.filter((finding) => finding.code !== truncation.code), truncation];
  if (bounded.semantic.provenance) bounded.semantic.provenance.truncated = true;
  for (const section of [bounded.structural, bounded.semantic]) {
    section.findings = section.findings.slice(0, 200).map((finding) => ({ ...finding, evidence: finding.evidence.slice(0, 4), sourceStatements: finding.sourceStatements?.slice(0, 2) }));
    section.limitations = section.limitations.slice(0, 100).map((finding) => ({ ...finding, evidence: finding.evidence.slice(0, 4), sourceStatements: finding.sourceStatements?.slice(0, 2) }));
    section.checkedSubjects = section.checkedSubjects.slice(0, 1000);
    section.checkedRelationships = section.checkedRelationships.slice(0, 1000);
  }
  while (bytes(bounded) > MAX_REPORT && (bounded.semantic.findings.length > 1 || bounded.structural.findings.length > 1)) {
    bounded.semantic.findings.length = Math.ceil(bounded.semantic.findings.length / 2);
    bounded.structural.findings.length = Math.ceil(bounded.structural.findings.length / 2);
  }
  if (bytes(bounded) > MAX_REPORT) invalid("integrity report cannot be represented within 512 KiB");
  bounded.status = integrityStatus(bounded);
  return bounded;
}

export class IntegrityStore {
  constructor(private readonly sql: SqlStorage, private readonly systemId: string) {
    sql.exec(`CREATE TABLE IF NOT EXISTS integrity_snapshots (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS integrity_runs (
      id TEXT PRIMARY KEY, request_key TEXT NOT NULL, active_key TEXT UNIQUE, snapshot_id TEXT NOT NULL, state TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT, requested_calls INTEGER NOT NULL, attempt INTEGER NOT NULL,
      request_json TEXT NOT NULL, report_json TEXT, agreement_json TEXT, error_json TEXT,
      lease_token TEXT, lease_expires INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS integrity_checkpoints (
      run_id TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(run_id,key))`);
  }

  putSnapshot(snapshot: IntegritySnapshot, kind: IntegritySnapshotKind): StoredIntegritySnapshot {
    if (snapshot.systemId !== this.systemId) invalid("snapshot System scope mismatch");
    const id = `snapshot.${snapshot.hash}`;
    const existing = this.snapshot(id);
    if (existing) return existing;
    const stored: StoredIntegritySnapshot = { ...snapshot, id, kind, createdAt: nowIso() };
    this.sql.exec("INSERT INTO integrity_snapshots VALUES (?,?,?,?,?)", id, snapshot.hash, kind, JSON.stringify(stored), stored.createdAt);
    return stored;
  }

  snapshot(id: string): StoredIntegritySnapshot | null {
    const row = this.sql.exec("SELECT json FROM integrity_snapshots WHERE id=?", id).toArray()[0] as Row | undefined;
    return row ? JSON.parse(String(row.json)) as StoredIntegritySnapshot : null;
  }

  start(snapshotId: string, request: IntegrityRunRequest): { run: IntegrityRun; created: boolean } {
    const snapshot = this.snapshot(snapshotId);
    if (!snapshot) throw new Error("[not-found] integrity snapshot not found");
    const provider = request.provider ?? "auto";
    const requestedCalls = Math.max(1, Math.min(request.budget?.maxCalls ?? 200, 500));
    const thresholds = { ...DEFAULT_THRESHOLDS, ...request.thresholds };
    const normalized = { snapshotId, snapshotHash: snapshot.hash, provider, model: request.model ?? null,
      thresholds, requestedCalls, policyVersion: INTEGRITY_POLICY_VERSION, questions: INTEGRITY_POLICY_VERSION };
    const requestKey = hashOf(normalized);
    const active = this.sql.exec("SELECT * FROM integrity_runs WHERE active_key=?", requestKey).toArray()[0] as Row | undefined;
    if (active) return { run: this.row(active), created: false };
    const latest = this.sql.exec("SELECT * FROM integrity_runs WHERE request_key=? ORDER BY attempt DESC LIMIT 1", requestKey).toArray()[0] as Row | undefined;
    if (latest && request.rerun !== true) return { run: this.row(latest), created: false };
    const attempt = Number((this.sql.exec("SELECT COALESCE(MAX(attempt),0)+1 AS n FROM integrity_runs WHERE request_key=?", requestKey).toArray()[0] as Row).n);
    const id = `integrity.${crypto.randomUUID()}`, at = nowIso();
    this.sql.exec("INSERT INTO integrity_runs (id,request_key,active_key,snapshot_id,state,provider,model,requested_calls,attempt,request_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      id, requestKey, requestKey, snapshotId, "queued", provider, request.model ?? null, requestedCalls, attempt, JSON.stringify(normalized), at, at);
    return { run: this.get(id)!, created: true };
  }

  get(id: string): IntegrityRun | null {
    const row = this.sql.exec("SELECT * FROM integrity_runs WHERE id=?", id).toArray()[0] as Row | undefined;
    return row ? this.row(row) : null;
  }
  list(limit = 50): IntegrityRun[] {
    const n = Math.max(1, Math.min(limit, 100));
    return (this.sql.exec("SELECT * FROM integrity_runs ORDER BY created_at DESC LIMIT ?", n).toArray() as Row[]).map((row) => this.row(row));
  }

  cancel(id: string): IntegrityRun {
    const run = this.get(id);
    if (!run) throw new Error("[not-found] integrity run not found");
    if (["completed", "failed", "cancelled"].includes(run.state)) return run;
    const checkpointCount = Number((this.sql.exec("SELECT COUNT(*) AS n FROM integrity_checkpoints WHERE run_id=?", id).toArray()[0] as Row).n);
    const error = { code: "cancelled", message: `Cancelled after ${checkpointCount} checkpointed provider ${checkpointCount === 1 ? "batch" : "batches"}.` };
    this.sql.exec("UPDATE integrity_runs SET state='cancelled',active_key=NULL,error_json=?,lease_token=NULL,lease_expires=NULL,updated_at=? WHERE id=?", JSON.stringify(error), nowIso(), id);
    return this.get(id)!;
  }

  lease(now = Date.now()): IntegrityLease | null {
    const row = this.sql.exec("SELECT * FROM integrity_runs WHERE state='queued' OR (state='running' AND lease_expires < ?) ORDER BY created_at LIMIT 1", now).toArray()[0] as Row | undefined;
    if (!row) return null;
    const token = crypto.randomUUID(), at = nowIso();
    this.sql.exec("UPDATE integrity_runs SET state='running',lease_token=?,lease_expires=?,updated_at=? WHERE id=? AND (state='queued' OR lease_expires < ?)", token, now + LEASE_MS, at, row.id, now);
    const run = this.get(String(row.id));
    return run?.state === "running" ? { run, snapshot: this.snapshot(run.snapshotId)!, token } : null;
  }

  checkpoint<T>(runId: string, key: string): T | null {
    const row = this.sql.exec("SELECT json FROM integrity_checkpoints WHERE run_id=? AND key=?", runId, key).toArray()[0] as Row | undefined;
    return row ? JSON.parse(String(row.json)) as T : null;
  }

  putCheckpoint(runId: string, key: string, value: unknown): void {
    if (this.checkpoint(runId, key) !== null) return;
    const json = JSON.stringify(value), size = bytes(json);
    if (size > MAX_CHECKPOINT_ROW) invalid("integrity checkpoint exceeds 64 KiB");
    const used = Number((this.sql.exec("SELECT COALESCE(SUM(bytes),0) AS n FROM integrity_checkpoints WHERE run_id=?", runId).toArray()[0] as Row).n);
    if (used + size > MAX_CHECKPOINTS) invalid("integrity checkpoints exceed 10 MiB");
    this.sql.exec("INSERT OR IGNORE INTO integrity_checkpoints VALUES (?,?,?,?,?)", runId, key, json, size, nowIso());
  }

  complete(id: string, token: string, report: IntegrityReport): IntegrityRun {
    const json = JSON.stringify(boundedReport(report));
    this.fence(id, token);
    this.sql.exec("UPDATE integrity_runs SET state='completed',active_key=NULL,report_json=?,lease_token=NULL,lease_expires=NULL,updated_at=? WHERE id=? AND lease_token=?",
      json, nowIso(), id, token);
    return this.get(id)!;
  }

  fail(id: string, token: string, error: { code: string; message: string }): IntegrityRun {
    this.fence(id, token);
    this.sql.exec("UPDATE integrity_runs SET state='failed',active_key=NULL,error_json=?,lease_token=NULL,lease_expires=NULL,updated_at=? WHERE id=? AND lease_token=?",
      JSON.stringify(error), nowIso(), id, token);
    return this.get(id)!;
  }

  agree(id: string, input: IntegrityAgreementRequest, actor = "admin"): IntegrityRun {
    const run = this.get(id);
    if (!run) throw new Error("[not-found] integrity run not found");
    if (run.state !== "completed") invalid("only a completed integrity run can be agreed");
    const report = run.report ?? invalid("completed integrity run has no report");
    if (run.agreement) {
      const existing = run.agreement.dispositions.map(({ findingId, decision, rationale }) => ({ findingId, decision, rationale }));
      if (canonicalJson(existing) !== canonicalJson(input.dispositions)) invalid("integrity agreement is immutable");
      return run;
    }
    const at = nowIso();
    const dispositions: IntegrityDisposition[] = input.dispositions.map((d) => ({
      ...d, actor, at, reportId: report.id, snapshotHash: run.snapshotHash,
    }));
    const eligibility = agreementEligibility(report, dispositions);
    if (!eligibility.eligible) invalid(eligibility.reason ?? `unresolved integrity findings: ${eligibility.unresolvedFindingIds.join(", ")}`);
    const agreement: IntegrityAgreement = {
      status: eligibility.status, actor, at, reportId: report.id, snapshotHash: run.snapshotHash, dispositions, eligibility,
    };
    this.sql.exec("UPDATE integrity_runs SET agreement_json=?,updated_at=? WHERE id=?", JSON.stringify(agreement), at, id);
    return this.get(id)!;
  }

  binding(id: string, snapshotHash: string): IntegrityReviewBinding {
    const run = this.get(id) ?? invalid("completed integrity agreement not found");
    if (run.state !== "completed") invalid("completed integrity agreement not found");
    const report = run.report ?? invalid("completed integrity agreement not found");
    const agreement = run.agreement ?? invalid("completed integrity agreement not found");
    if (run.snapshotHash !== snapshotHash || report.snapshotHash !== snapshotHash || agreement.snapshotHash !== snapshotHash) {
      invalid("integrity agreement snapshot does not match the candidate");
    }
    if (!agreement.eligibility.eligible) invalid("integrity agreement is not eligible");
    return { runId: run.id, reportId: report.id, snapshotHash, agreementStatus: agreement.status };
  }

  hasPending(): boolean {
    return !!this.sql.exec("SELECT 1 FROM integrity_runs WHERE state='queued' OR state='running' LIMIT 1").toArray().length;
  }

  assertLease(id: string, token: string): void { this.fence(id, token); }

  private fence(id: string, token: string): void {
    const row = this.sql.exec("SELECT state,lease_token FROM integrity_runs WHERE id=?", id).toArray()[0] as Row | undefined;
    if (!row || row.state !== "running" || row.lease_token !== token) invalid("stale integrity run lease");
  }

  private row(row: Row): IntegrityRun {
    const snapshot = this.snapshot(String(row.snapshot_id)) ?? invalid("integrity run snapshot is missing");
    const report = row.report_json ? JSON.parse(String(row.report_json)) as IntegrityReport : undefined;
    const agreement = row.agreement_json ? JSON.parse(String(row.agreement_json)) as IntegrityAgreement : undefined;
    const error = row.error_json ? JSON.parse(String(row.error_json)) as IntegrityRun["error"] : undefined;
    const request = JSON.parse(String(row.request_json)) as { thresholds?: IntegrityRun["thresholds"] };
    return {
      id: String(row.id), systemId: this.systemId, state: String(row.state) as IntegrityRunState,
      snapshotId: String(row.snapshot_id), snapshotHash: snapshot.hash,
      provider: String(row.provider) as IntegrityProviderChoice, ...(row.model && { model: String(row.model) }),
      requestedCalls: Number(row.requested_calls), thresholds: request.thresholds ?? DEFAULT_THRESHOLDS, attempt: Number(row.attempt),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      ...(report && { report }), ...(agreement && { agreement }), ...(error && { error }),
      reviewUrl: snapshot.kind === "initial-preview"
        ? `/start?system=${encodeURIComponent(this.systemId)}&integrity=${encodeURIComponent(String(row.id))}`
        : `/s/${encodeURIComponent(this.systemId)}/r/head/review?integrity=${encodeURIComponent(String(row.id))}`,
    };
  }
}
