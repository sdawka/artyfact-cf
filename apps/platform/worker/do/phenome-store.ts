/**
 * Phenome events held by a System's DO: ingest (dedupe, retention), listing with the per-version aggregate, and the
 * lookups that resolve an ingest token to a deployment or a realization. Pattern: `worker/do/registry.ts`.
 */
import { PHENOME_LIMITS } from "@artyfact/model";
import type { PhenomeEvent, PhenomeEventsQuery, PhenomeEventsResponse, RealizedArtifact } from "../../shared/api";
import { phenomeVersionKey } from "../../shared/phenome";
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;
const str = (v: SqlStorageValue | undefined): string | null => (typeof v === "string" ? v : null);

/** What an ingest token stands for. A deployment token may only report its own deployment's build. */
export type PhenomePrincipal =
  | {
      kind: "deployment"; id: string; commit: string; buildId: string | null; realizationId: string | null; repo: string;
      systemCommit: string | null; association: RealizedArtifact | null;
    }
  | { kind: "realization"; id: string; commits: string[] };

/** A validated event ready to store. `eventId` is the emitter's id or a content hash. */
export interface PhenomeRow {
  eventId: string;
  deploymentId: string | null;
  thingId: string;
  artifactId: string;
  buildId: string;
  commit: string;
  kind: string;
  subject: string | null;
  criterion: string | null;
  emittedAt: string;
  payload: unknown;
  realizedArtifactId?: string | null;
  genomeCommit?: string | null;
  sourceRepo?: string;
}

const FULL_HASH = /^[0-9a-f]{40}$/;
const DEFAULT_LIMIT = 50, MAX_LIMIT = 200, MAX_VERSIONS = 50;

export class PhenomeStore {
  constructor(private readonly sql: SqlStorage) {}

  private all(q: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec(q, ...args).toArray() as Row[];
  }

  /** The deployment or realization whose ingest token / secret hashes to `digest` (SHA-256 hex), if any. */
  principalForHash(digest: string): PhenomePrincipal | null {
    const dep = this.all(
      `SELECT id, commit_hash, build_id, realization_id, repo, system_commit, realized_artifact_id, build_row
       FROM deployments WHERE ingest_token_hash = ? AND status IN ('pending', 'live') LIMIT 1`, digest,
    )[0];
    if (dep) {
      const outputId = str(dep.realized_artifact_id);
      const association = outputId ? this.realizedArtifact(outputId) : this.realizedArtifactForBuild(str(dep.build_row));
      return {
        kind: "deployment", id: String(dep.id), commit: String(dep.commit_hash), buildId: str(dep.build_id),
        realizationId: str(dep.realization_id), repo: String(dep.repo), systemCommit: str(dep.system_commit), association,
      };
    }
    // A finished realization (promoted, rejected, abandoned) can no longer add evidence.
    const rz = this.all("SELECT id FROM realizations WHERE secret_hash = ? AND status NOT IN ('promoted', 'rejected', 'abandoned') LIMIT 1", digest)[0];
    if (!rz) return null;
    const commits = this.all("SELECT commit_hash FROM candidates WHERE realization_id = ?", String(rz.id)).map((r) => String(r.commit_hash));
    return { kind: "realization", id: String(rz.id), commits };
  }

  private realizedArtifact(id: string): RealizedArtifact | null {
    const r = this.all("SELECT * FROM realized_artifacts WHERE id = ?", id)[0];
    return r ? this.outputDto(r) : null;
  }

  private realizedArtifactForBuild(buildRow: string | null): RealizedArtifact | null {
    if (!buildRow) return null;
    const output = this.all("SELECT * FROM realized_artifacts WHERE build_row = ?", buildRow)[0];
    if (output) return this.outputDto(output);
    const r = this.all("SELECT source_repo, commit_hash, genome_commit, thing_id, artifact_id, created_at FROM builds WHERE id = ?", buildRow)[0];
    if (!r || !str(r.source_repo) || !str(r.genome_commit) || !str(r.thing_id) || !str(r.artifact_id)) return null;
    return {
      id: "", thingId: String(r.thing_id), artifactId: String(r.artifact_id), source: { repo: String(r.source_repo), commit: String(r.commit_hash) },
      genomeCommit: String(r.genome_commit), build: buildRow, createdAt: String(r.created_at),
    };
  }

  private outputDto(r: Row): RealizedArtifact {
    return {
      id: String(r.id), thingId: String(r.thing_id), artifactId: String(r.artifact_id), source: { repo: String(r.source_repo), commit: String(r.source_commit) },
      genomeCommit: String(r.genome_commit), build: String(r.build_row), ...(str(r.locator) && { locator: str(r.locator)! }),
      ...(str(r.digest) && { digest: str(r.digest)! }), createdAt: String(r.created_at),
    };
  }

  /** The realization a deployment belongs to, for attributing events that name it. */
  deploymentRealization(deploymentId: string): string | null {
    return str(this.all("SELECT realization_id FROM deployments WHERE id = ?", deploymentId)[0]?.realization_id);
  }

  /** The newest System commit whose manifest binds exactly the full app commit `commit`; null when none does. */
  systemCommitFor(commit: string): string | null {
    if (!FULL_HASH.test(commit)) return null;
    for (const r of this.all("SELECT id, manifest_json FROM system_commits ORDER BY rowid DESC")) {
      try {
        const m = JSON.parse(String(r.manifest_json)) as { artifacts?: Record<string, { commit?: string }> };
        if (Object.values(m.artifacts ?? {}).some((a) => a.commit === commit)) return String(r.id);
      } catch { /* unreadable manifest binds nothing */ }
    }
    return null;
  }

  /** Whether deployment `id` exists and deploys exactly the full commit `commit`. */
  deploymentDeploys(id: string, commit: string, sourceRepo?: string): boolean {
    const d = this.all("SELECT commit_hash, repo FROM deployments WHERE id = ?", id)[0];
    return FULL_HASH.test(commit) && str(d?.commit_hash) === commit && (!sourceRepo || str(d?.repo) === sourceRepo);
  }

  /**
   * Store `rows` in order; a row whose `event_id` is already stored is skipped. Returns, per row, whether it was new
   * and the deployment id kept. The System commit is always derived here from the commit, never taken from the emitter. When `verifyDeployment` is
   * set (realization principals) a claimed deployment id is kept only if that deployment deploys the event's commit.
   * Event ids of rows trimmed by retention are free again, so a replay of an evicted event is accepted (accepted trade-off).
   * Afterwards the oldest rows beyond the System cap are deleted.
   */
  insert(rows: PhenomeRow[], realizationId: string | null, verifyDeployment: boolean): { fresh: boolean; deploymentId: string | null }[] {
    const receivedAt = nowIso();
    const scCache = new Map<string, string | null>();
    const systemCommitOf = (commit: string) => {
      if (!scCache.has(commit)) scCache.set(commit, this.systemCommitFor(commit));
      return scCache.get(commit)!;
    };
    const out = rows.map((r) => {
      const deploymentId = r.deploymentId && (!verifyDeployment || this.deploymentDeploys(r.deploymentId, r.commit, r.sourceRepo)) ? r.deploymentId : null;
      const payloadJson = JSON.stringify({ ...(r.criterion ? { criterion: r.criterion } : {}), payload: r.payload ?? null });
      this.sql.exec(
        `INSERT OR IGNORE INTO phenome_events (event_id, deployment_id, realization_id, thing_id, artifact_id, build_id, commit_hash,
           system_commit, kind, subject, emitted_at, received_at, payload_json, realized_artifact_id, genome_commit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.eventId, deploymentId, (deploymentId && this.deploymentRealization(deploymentId)) || realizationId, r.thingId, r.artifactId,
        r.buildId, r.commit, systemCommitOf(r.commit), r.kind, r.subject, r.emittedAt, receivedAt, payloadJson, r.realizedArtifactId ?? null, r.genomeCommit ?? null,
      );
      return { fresh: Number(this.all("SELECT changes() AS n")[0].n) > 0, deploymentId };
    });
    this.sql.exec(
      "DELETE FROM phenome_events WHERE seq <= (SELECT seq FROM phenome_events ORDER BY seq DESC LIMIT 1 OFFSET ?)",
      PHENOME_LIMITS.rowsPerSystem,
    );
    return out;
  }

  count(): number {
    return Number(this.all("SELECT COUNT(*) AS n FROM phenome_events")[0].n);
  }

  list(systemId: string, q: PhenomeEventsQuery = {}): PhenomeEventsResponse {
    const limit = Math.min(Math.max(Math.trunc(q.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: string[] = [], args: SqlStorageValue[] = [];
    if (q.thing) { where.push("thing_id = ?"); args.push(q.thing); }
    if (q.build) { where.push("build_id = ?"); args.push(q.build); }
    if (q.output) { where.push("realized_artifact_id = ?"); args.push(q.output); }
    if (q.deployment) { where.push("deployment_id = ?"); args.push(q.deployment); }
    if (q.commit) { where.push("commit_hash LIKE ? ESCAPE '\\'"); args.push(`${q.commit.replace(/[\\%_]/g, "\\$&")}%`); }
    if (q.kind) { where.push("kind = ?"); args.push(q.kind); }
    if (q.realization) { where.push("realization_id = ?"); args.push(q.realization); }
    const scopeWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const scopeArgs = [...args];
    if (q.before !== undefined && Number.isFinite(q.before)) { where.push("seq < ?"); args.push(q.before); }
    const rows = this.all(
      `SELECT * FROM phenome_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`,
      ...args, limit + 1,
    );
    const page = rows.slice(0, limit);
    const events = page.map((r) => this.dto(systemId, r));
    // Aggregates describe the full non-cursor scope. A nullable identity is universal only when every row agrees.
    const consistent = (column: string) => `CASE WHEN COUNT(${column}) = COUNT(*) AND MIN(${column}) = MAX(${column}) THEN MIN(${column}) ELSE NULL END AS ${column}`;
    const versions = this.all(
      `SELECT build_id, commit_hash, realized_artifact_id, ${consistent("genome_commit")}, ${consistent("deployment_id")}, ${consistent("system_commit")}, COUNT(*) AS n, MAX(seq) AS newest FROM phenome_events
       ${scopeWhere} GROUP BY build_id, commit_hash, realized_artifact_id ORDER BY newest DESC LIMIT ?`,
      ...scopeArgs, MAX_VERSIONS,
    ).map((r) => ({
      key: phenomeVersionKey(str(r.realized_artifact_id), String(r.build_id), String(r.commit_hash)), buildId: String(r.build_id), commit: String(r.commit_hash),
      output: str(r.realized_artifact_id), genomeCommit: str(r.genome_commit), deployment: str(r.deployment_id), systemCommit: str(r.system_commit), count: Number(r.n),
    }));
    return { events, ...(rows.length > limit && { nextBefore: Number(page[page.length - 1].seq) }), versions };
  }

  private dto(systemId: string, r: Row): PhenomeEvent {
    let envelope: { criterion?: string; payload?: unknown } = {};
    try { envelope = JSON.parse(String(r.payload_json ?? "{}")) as typeof envelope; } catch { /* unreadable payload stays empty */ }
    const eventId = String(r.event_id);
    const opt = <K extends string>(k: K, v: string | null) => (v === null ? {} : { [k]: v } as Record<K, string>);
    return {
      id: eventId.slice(eventId.indexOf("\u001f") + 1), seq: Number(r.seq), systemId, thingId: String(r.thing_id), artifactId: String(r.artifact_id),
      buildId: String(r.build_id), commit: String(r.commit_hash), ...opt("systemCommit", str(r.system_commit)),
      ...opt("outputId", str(r.realized_artifact_id)), ...opt("genomeCommit", str(r.genome_commit)),
      ...opt("deploymentId", str(r.deployment_id)), emittedAt: String(r.emitted_at), receivedAt: String(r.received_at),
      kind: String(r.kind), ...opt("subject", str(r.subject)), ...(envelope.criterion ? { criterion: envelope.criterion } : {}),
      payload: envelope.payload ?? null, ...opt("realization", str(r.realization_id)),
    };
  }
}
