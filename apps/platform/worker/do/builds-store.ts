/**
 * Builds and deployments of one System (tables `builds`, `deployments` in schema.ts). Held by the SystemAuthority
 * DO, which exposes thin delegates (the `B3 builds` region) and emits the SSE events.
 */
import type {
  Build, BuildKind, BuildReporter, BuildStatus, BuildStep, BuildSummary, DeployState, Deployment, DeploymentStatus,
  RealizedArtifact, RealizedArtifactReport,
} from "../../shared/api";
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;
const str = (v: SqlStorageValue | undefined) => (v == null ? undefined : String(v));

/** Statuses a build ends in; a late `queued`/`running` report never overwrites one. */
export const TERMINAL_BUILD: BuildStatus[] = ["passed", "failed", "error"];

export interface BuildUpsert {
  id: string;
  realization: string | null;
  candidate: string | null;
  commit: string;
  kind: BuildKind;
  status: BuildStatus;
  reporter: BuildReporter;
  url?: string;
  buildId?: string;
  logsUrl?: string;
  externalId?: string;
  steps?: BuildStep[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  sourceRepo?: string;
  genomeCommit?: string;
  thingId?: string;
  artifactId?: string;
  output?: RealizedArtifactReport;
}

export interface DeploymentInput {
  artifactId?: string;
  id?: string;
  kind: BuildKind;
  status?: DeploymentStatus;
  repo: string;
  commit: string;
  systemCommit?: string;
  realization?: string;
  buildRow?: string;
  url?: string;
  buildId?: string;
  realizedArtifactId?: string;
  by: string;
  ingestTokenHash?: string;
}

export interface BuildsSummaryPart {
  latestBuild: BuildSummary | null;
  deployment: { production: Deployment | null; previews: number };
  deployState: DeployState;
}

export const buildSummary = (b: Build): BuildSummary => ({
  id: b.id, status: b.status, kind: b.kind, commit: b.commit,
  ...(b.url !== undefined && { url: b.url }), ...(b.buildId !== undefined && { buildId: b.buildId }), ...(b.finishedAt !== undefined && { finishedAt: b.finishedAt }),
});

export class BuildsStore {
  constructor(private readonly sql: SqlStorage) {}

  private all(q: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec(q, ...args).toArray() as Row[];
  }
  private one(q: string, ...args: SqlStorageValue[]): Row | undefined {
    return this.all(q, ...args)[0];
  }

  // ---------------------------------------------------------------- builds

  private buildDto(r: Row): Build {
    const opt = (k: string) => str(r[k]);
    const steps = opt("steps_json");
    const output = this.realizedArtifactForBuild(String(r.id));
    const sourceRepo = opt("source_repo");
    return {
      id: String(r.id), status: String(r.status) as BuildStatus, kind: String(r.kind) as BuildKind, commit: String(r.commit_hash),
      realization: str(r.realization_id) ?? null, candidate: str(r.candidate_id) ?? null, reporter: String(r.reporter) as BuildReporter,
      ...(sourceRepo && { source: { repo: sourceRepo, commit: String(r.commit_hash) } }),
      ...(opt("genome_commit") && { genomeCommit: opt("genome_commit") }), ...(opt("thing_id") && { thingId: opt("thing_id") }),
      ...(opt("artifact_id") && { artifactId: opt("artifact_id") }), ...(output && { output }),
      ...(opt("url") && { url: opt("url") }), ...(opt("build_id") && { buildId: opt("build_id") }), ...(opt("logs_url") && { logsUrl: opt("logs_url") }),
      ...(opt("external_id") && { externalId: opt("external_id") }), ...(steps && { steps: JSON.parse(steps) as BuildStep[] }),
      ...(opt("error") && { error: opt("error") }), ...(opt("started_at") && { startedAt: opt("started_at") }), ...(opt("finished_at") && { finishedAt: opt("finished_at") }),
      createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    };
  }

  build(id: string): Build | null {
    const r = this.one("SELECT * FROM builds WHERE id = ?", id);
    return r ? this.buildDto(r) : null;
  }

  /**
   * Insert or merge a build row. Fields the report leaves out keep their stored value; a terminal status is never
   * replaced by `queued`/`running` (a late or replayed report), so the call is idempotent. `changed` is false when
   * nothing new was stored.
   */
  upsertBuild(input: BuildUpsert): { build: Build; changed: boolean } {
    const prevRow = this.one("SELECT * FROM builds WHERE id = ?", input.id);
    const prev = prevRow ? this.buildDto(prevRow) : null;
    if (prev && TERMINAL_BUILD.includes(prev.status) && !TERMINAL_BUILD.includes(input.status)) return { build: prev, changed: false };
    const lineage = [
      ["source repo", input.sourceRepo, prev?.source?.repo], ["source commit", input.commit, prev?.source?.commit],
      ["Genome commit", input.genomeCommit, prev?.genomeCommit], ["Thing", input.thingId, prev?.thingId], ["artifact", input.artifactId, prev?.artifactId],
    ] as const;
    for (const [name, next, before] of lineage) {
      if (next !== undefined && before !== undefined && next !== before) throw new Error(`build ${input.id} lineage cannot change its ${name}`);
    }
    const priorOutput = prev?.output;
    if (input.output) {
      if (!input.output.locator && !input.output.digest) throw new Error("a realized output needs a locator or digest");
      if (input.status !== "passed") throw new Error("a realized output may be recorded only for a passed build");
      if (priorOutput && (input.output.locator !== priorOutput.locator || input.output.digest !== priorOutput.digest)) {
        throw new Error(`realized output ${priorOutput.id} cannot change`);
      }
    }
    const now = nowIso();
    const merged = {
      realization_id: input.realization ?? prev?.realization ?? null,
      candidate_id: input.candidate ?? prev?.candidate ?? null,
      commit_hash: input.commit,
      kind: input.kind,
      status: input.status,
      url: input.url ?? prev?.url ?? null,
      build_id: input.buildId ?? prev?.buildId ?? null,
      logs_url: input.logsUrl ?? prev?.logsUrl ?? null,
      reporter: input.reporter,
      external_id: input.externalId ?? prev?.externalId ?? null,
      steps_json: input.steps ? JSON.stringify(input.steps) : prev?.steps ? JSON.stringify(prev.steps) : null,
      // An error belongs to the report that carried it: a later passed report clears it.
      error: input.error ?? (input.status === "failed" || input.status === "error" ? prev?.error ?? null : null),
      started_at: input.startedAt ?? prev?.startedAt ?? null,
      finished_at: input.finishedAt ?? prev?.finishedAt ?? (TERMINAL_BUILD.includes(input.status) ? now : null),
      source_repo: input.sourceRepo ?? prev?.source?.repo ?? null,
      genome_commit: input.genomeCommit ?? prev?.genomeCommit ?? null,
      thing_id: input.thingId ?? prev?.thingId ?? null,
      artifact_id: input.artifactId ?? prev?.artifactId ?? null,
    };
    let changed = false;
    if (prev) {
      changed = !(Object.keys(merged) as (keyof typeof merged)[]).every((k) => (prevRow![k] ?? null) === merged[k]);
      if (changed) {
        this.sql.exec(
          `UPDATE builds SET realization_id = ?, candidate_id = ?, commit_hash = ?, kind = ?, status = ?, url = ?, build_id = ?, logs_url = ?, reporter = ?,
           external_id = ?, steps_json = ?, error = ?, started_at = ?, finished_at = ?, source_repo = ?, genome_commit = ?, thing_id = ?, artifact_id = ?, updated_at = ? WHERE id = ?`,
          ...Object.values(merged), now, input.id,
        );
      }
    } else {
      this.sql.exec(
        `INSERT INTO builds (realization_id, candidate_id, commit_hash, kind, status, url, build_id, logs_url, reporter, external_id, steps_json, error,
         started_at, finished_at, source_repo, genome_commit, thing_id, artifact_id, id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...Object.values(merged), input.id, now, now,
      );
      changed = true;
    }
    if (input.output && !priorOutput) {
      const sourceRepo = merged.source_repo, genomeCommit = merged.genome_commit, thingId = merged.thing_id, artifactId = merged.artifact_id;
      if (!sourceRepo || !genomeCommit || !thingId || !artifactId) throw new Error(`build ${input.id} needs complete lineage before recording an output`);
      this.sql.exec(
        `INSERT INTO realized_artifacts (id, thing_id, artifact_id, source_repo, source_commit, genome_commit, build_row, locator, digest, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `output.${input.id}`, thingId, artifactId, sourceRepo, input.commit, genomeCommit, input.id,
        input.output.locator ?? null, input.output.digest ?? null, now,
      );
      changed = true;
    }
    return { build: this.build(input.id)!, changed };
  }

  private realizedArtifactDto(r: Row): RealizedArtifact {
    return {
      id: String(r.id), thingId: String(r.thing_id), artifactId: String(r.artifact_id),
      source: { repo: String(r.source_repo), commit: String(r.source_commit) }, genomeCommit: String(r.genome_commit),
      build: String(r.build_row), ...(str(r.locator) && { locator: str(r.locator) }), ...(str(r.digest) && { digest: str(r.digest) }),
      createdAt: String(r.created_at),
    };
  }

  realizedArtifactForBuild(buildRow: string): RealizedArtifact | null {
    const r = this.one("SELECT * FROM realized_artifacts WHERE build_row = ?", buildRow);
    return r ? this.realizedArtifactDto(r) : null;
  }

  realizedArtifact(id: string): RealizedArtifact | null {
    const r = this.one("SELECT * FROM realized_artifacts WHERE id = ?", id);
    return r ? this.realizedArtifactDto(r) : null;
  }

  realizedArtifacts(): RealizedArtifact[] {
    return this.all("SELECT * FROM realized_artifacts ORDER BY created_at DESC, rowid DESC").map((r) => this.realizedArtifactDto(r));
  }

  /** Newest first. */
  builds(filter: { realization?: string; candidate?: string; commit?: string; kind?: BuildKind; limit?: number } = {}): Build[] {
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (filter.realization) (where.push("realization_id = ?"), args.push(filter.realization));
    if (filter.candidate) (where.push("candidate_id = ?"), args.push(filter.candidate));
    if (filter.commit) (where.push("commit_hash = ?"), args.push(filter.commit));
    if (filter.kind) (where.push("kind = ?"), args.push(filter.kind));
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
    return this.all(`SELECT * FROM builds ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, rowid DESC LIMIT ${limit}`, ...args)
      .map((r) => this.buildDto(r));
  }

  /** The latest build of `commit` (optionally of one kind), by last update. */
  latestBuild(commit: string, kind?: BuildKind): BuildSummary | null {
    const r = kind
      ? this.one("SELECT * FROM builds WHERE commit_hash = ? AND kind = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1", commit, kind)
      : this.one("SELECT * FROM builds WHERE commit_hash = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1", commit);
    return r ? buildSummary(this.buildDto(r)) : null;
  }

  /** The latest build of a candidate: by candidate id, else a preview build of its realization at its commit. */
  candidateBuild(candidateId: string, realizationId: string, commit: string): BuildSummary | null {
    const r = this.one(
      `SELECT * FROM builds WHERE candidate_id = ? OR (realization_id = ? AND commit_hash = ? AND kind = 'preview')
       ORDER BY updated_at DESC, rowid DESC LIMIT 1`, candidateId, realizationId, commit,
    );
    return r ? buildSummary(this.buildDto(r)) : null;
  }

  // ---------------------------------------------------------------- deployments

  private deploymentDto(r: Row): Deployment {
    const opt = (k: string) => str(r[k]);
    const candidate = opt("build_row") ? str(this.one("SELECT candidate_id FROM builds WHERE id = ?", String(r.build_row))?.candidate_id) : undefined;
    return {
      id: String(r.id), kind: String(r.kind) as BuildKind, status: String(r.status) as DeploymentStatus, repo: String(r.repo), commit: String(r.commit_hash),
      ...(opt("artifact_id") && { artifactId: opt("artifact_id") }), ...(opt("system_commit") && { systemCommit: opt("system_commit") }), ...(opt("realization_id") && { realization: opt("realization_id") }),
      ...(candidate && { candidate }), ...(opt("build_row") && { build: opt("build_row") }), ...(opt("url") && { url: opt("url") }),
      ...(opt("build_id") && { buildId: opt("build_id") }), ...(opt("realized_artifact_id") && { output: opt("realized_artifact_id") }),
      by: String(r.by), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    };
  }

  deployment(id: string): Deployment | null {
    const r = this.one("SELECT * FROM deployments WHERE id = ?", id);
    return r ? this.deploymentDto(r) : null;
  }

  /** Newest first. */
  deployments(filter: { kind?: BuildKind; limit?: number } = {}): Deployment[] {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 500));
    const rows = filter.kind
      ? this.all(`SELECT * FROM deployments WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ${limit}`, filter.kind)
      : this.all(`SELECT * FROM deployments ORDER BY created_at DESC, rowid DESC LIMIT ${limit}`);
    return rows.map((r) => this.deploymentDto(r));
  }

  /** "The deployment version that represents" the System: the latest live production deployment. */
  liveProduction(): Deployment | null {
    const r = this.one("SELECT * FROM deployments WHERE kind = 'production' AND status = 'live' ORDER BY updated_at DESC, rowid DESC LIMIT 1");
    return r ? this.deploymentDto(r) : null;
  }

  /** Ids are `deployment.<n>`, numbered per System. A `live` row supersedes the previous live one of its scope. */
  createDeployment(input: DeploymentInput): { deployment: Deployment; superseded: Deployment[] } {
    const n = Number(this.one("SELECT COUNT(*) AS n FROM deployments")?.n ?? 0) + 1;
    let id = input.id ?? `deployment.${n}`;
    for (let i = n + 1; !input.id && this.one("SELECT 1 AS x FROM deployments WHERE id = ?", id); i++) id = `deployment.${i}`;
    const now = nowIso();
    const status = input.status ?? "pending";
    this.sql.exec(
      `INSERT INTO deployments (id, kind, status, repo, commit_hash, system_commit, realization_id, build_row, url, build_id, by, ingest_token_hash, realized_artifact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.kind, status, input.repo, input.commit, input.systemCommit ?? null, input.realization ?? null, input.buildRow ?? null,
      input.url ?? null, input.buildId ?? null, input.by, input.ingestTokenHash ?? null, input.realizedArtifactId ?? null, now, now,
    );
    if(input.artifactId)this.sql.exec("UPDATE deployments SET artifact_id=? WHERE id=?",input.artifactId,id);
    const superseded = status === "live" ? this.supersede(id) : [];
    return { deployment: this.deployment(id)!, superseded };
  }

  /** Mark the other live deployments of `id`'s scope (production; or previews of the same realization) superseded. */
  private supersede(id: string): Deployment[] {
    const d = this.one("SELECT kind, realization_id, artifact_id FROM deployments WHERE id = ?", id);
    if (!d) return [];
    const rows = d.kind === "production"
      ? this.all("SELECT id FROM deployments WHERE kind = 'production' AND status = 'live' AND artifact_id IS ? AND id != ?", d.artifact_id??null,id)
      : this.all("SELECT id FROM deployments WHERE kind = 'preview' AND status = 'live' AND realization_id IS ? AND id != ?", d.realization_id ?? null, id);
    const now = nowIso();
    for (const r of rows) this.sql.exec("UPDATE deployments SET status = 'superseded', updated_at = ? WHERE id = ?", now, r.id);
    return rows.map((r) => this.deployment(String(r.id))!);
  }

  /**
   * Record a build outcome on a deployment: `live` (supersedes the previous live one) or `failed`; anything else only
   * links the build row. A superseded deployment stays superseded. Returns null for an unknown id.
   */
  setDeploymentResult(id: string, result: { status?: "live" | "failed"; buildRow?: string; url?: string; buildId?: string; realizedArtifactId?: string }): { deployment: Deployment; superseded: Deployment[]; changed: boolean } | null {
    const prev = this.one("SELECT * FROM deployments WHERE id = ?", id);
    if (!prev) return null;
    const status = prev.status === "superseded" ? "superseded" : (result.status ?? String(prev.status));
    const next = {
      status, build_row: result.buildRow ?? prev.build_row ?? null, url: result.url ?? prev.url ?? null, build_id: result.buildId ?? prev.build_id ?? null,
      realized_artifact_id: result.realizedArtifactId ?? prev.realized_artifact_id ?? null,
    };
    const changed = next.status !== prev.status || next.build_row !== (prev.build_row ?? null) || next.url !== (prev.url ?? null)
      || next.build_id !== (prev.build_id ?? null) || next.realized_artifact_id !== (prev.realized_artifact_id ?? null);
    if (changed) {
      this.sql.exec("UPDATE deployments SET status = ?, build_row = ?, url = ?, build_id = ?, realized_artifact_id = ?, updated_at = ? WHERE id = ?",
        next.status, next.build_row, next.url, next.build_id, next.realized_artifact_id, nowIso(), id);
    }
    const superseded = changed && next.status === "live" ? this.supersede(id) : [];
    return { deployment: this.deployment(id)!, superseded, changed };
  }

  setIngestTokenHash(id: string, hash: string): Deployment | null {
    if (!this.one("SELECT 1 AS x FROM deployments WHERE id = ?", id)) return null;
    this.sql.exec("UPDATE deployments SET ingest_token_hash = ?, updated_at = ? WHERE id = ?", hash, nowIso(), id);
    return this.deployment(id);
  }

  /** The deployment whose ingest token hashes to `hash` (Phenome ingest auth). */
  deploymentByIngestHash(hash: string): Deployment | null {
    const r = this.one("SELECT * FROM deployments WHERE ingest_token_hash = ?", hash);
    return r ? this.deploymentDto(r) : null;
  }

  /**
   * Production state against `appCommit`: `live` when the live production deployment is on it; `pending`/`failed`
   * from the newest production deployment of it; `behind` when production is live on an older commit; else `none`.
   */
  deployState(appCommit: string | null | undefined): DeployState {
    const live = this.liveProduction();
    if (live && appCommit && live.commit === appCommit) return "live";
    const forHead = appCommit
      ? this.one("SELECT status FROM deployments WHERE kind = 'production' AND commit_hash = ? AND status != 'superseded' ORDER BY created_at DESC, rowid DESC LIMIT 1", appCommit)
      : undefined;
    if (forHead?.status === "pending") return "pending";
    if (forHead?.status === "failed") return "failed";
    return live ? "behind" : "none";
  }

  summaryPart(appCommit: string | null | undefined): BuildsSummaryPart {
    const latest = this.one("SELECT * FROM builds ORDER BY updated_at DESC, rowid DESC LIMIT 1");
    const previews = Number(this.one("SELECT COUNT(*) AS n FROM deployments WHERE kind = 'preview' AND status = 'live'")?.n ?? 0);
    return {
      latestBuild: latest ? buildSummary(this.buildDto(latest)) : null,
      deployment: { production: this.liveProduction(), previews },
      deployState: this.deployState(appCommit),
    };
  }
}
