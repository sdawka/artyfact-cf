/**
 * Phenome events held by a System's DO: ingest (dedupe, retention), listing with the per-version aggregate, and the
 * lookups that resolve an ingest token to a deployment or a realization. Pattern: `worker/do/registry.ts`.
 */
import { PHENOME_LIMITS } from "@artyfact/model";
import type { PhenomeEvent, PhenomeEventsQuery, PhenomeEventsResponse } from "../../shared/api";
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;
const str = (v: SqlStorageValue | undefined): string | null => (typeof v === "string" ? v : null);

/** What an ingest token stands for. A deployment token may only report its own deployment's build. */
export type PhenomePrincipal =
  | { kind: "deployment"; id: string; commit: string; realizationId: string | null }
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
}

const DEFAULT_LIMIT = 50, MAX_LIMIT = 200, MAX_VERSIONS = 50;

export class PhenomeStore {
  constructor(private readonly sql: SqlStorage) {}

  private all(q: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec(q, ...args).toArray() as Row[];
  }

  /** The deployment or realization whose ingest token / secret hashes to `digest` (SHA-256 hex), if any. */
  principalForHash(digest: string): PhenomePrincipal | null {
    const dep = this.all("SELECT id, commit_hash, realization_id FROM deployments WHERE ingest_token_hash = ? AND status IN ('pending', 'live') LIMIT 1", digest)[0];
    if (dep) return { kind: "deployment", id: String(dep.id), commit: String(dep.commit_hash), realizationId: str(dep.realization_id) };
    // A finished realization (promoted, rejected, abandoned) can no longer add evidence.
    const rz = this.all("SELECT id FROM realizations WHERE secret_hash = ? AND status NOT IN ('promoted', 'rejected', 'abandoned') LIMIT 1", digest)[0];
    if (!rz) return null;
    const commits = this.all("SELECT commit_hash FROM candidates WHERE realization_id = ?", String(rz.id)).map((r) => String(r.commit_hash));
    return { kind: "realization", id: String(rz.id), commits };
  }

  /** The realization a deployment belongs to, for attributing events that name it. */
  deploymentRealization(deploymentId: string): string | null {
    return str(this.all("SELECT realization_id FROM deployments WHERE id = ?", deploymentId)[0]?.realization_id);
  }

  /** The newest System commit whose manifest binds an app commit starting with `commit`; null when none does. */
  systemCommitFor(commit: string): string | null {
    for (const r of this.all("SELECT id, manifest_json FROM system_commits ORDER BY rowid DESC")) {
      try {
        const m = JSON.parse(String(r.manifest_json)) as { artifacts?: Record<string, { commit?: string }> };
        if (Object.values(m.artifacts ?? {}).some((a) => a.commit?.startsWith(commit))) return String(r.id);
      } catch { /* unreadable manifest binds nothing */ }
    }
    return null;
  }

  /** Whether deployment `id` exists and deploys a commit starting with `commit`. */
  deploymentDeploys(id: string, commit: string): boolean {
    const c = str(this.all("SELECT commit_hash FROM deployments WHERE id = ?", id)[0]?.commit_hash);
    return !!c && c.startsWith(commit);
  }

  /**
   * Store `rows` in order; a row whose `event_id` is already stored is skipped. Returns, per row, whether it was new
   * and the deployment id kept. The System commit is always derived here from the commit, never taken from the emitter. When `verifyDeployment` is
   * set (realization principals) a claimed deployment id is kept only if that deployment deploys the event's commit.
   * Afterwards the oldest rows beyond the System cap are deleted.
   */
  insert(rows: PhenomeRow[], realizationId: string | null, verifyDeployment: boolean): { fresh: boolean; deploymentId: string | null }[] {
    const receivedAt = nowIso();
    const out = rows.map((r) => {
      const deploymentId = r.deploymentId && (!verifyDeployment || this.deploymentDeploys(r.deploymentId, r.commit)) ? r.deploymentId : null;
      const payloadJson = JSON.stringify({ ...(r.criterion ? { criterion: r.criterion } : {}), payload: r.payload ?? null });
      this.sql.exec(
        `INSERT OR IGNORE INTO phenome_events (event_id, deployment_id, realization_id, thing_id, artifact_id, build_id, commit_hash,
           system_commit, kind, subject, emitted_at, received_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.eventId, deploymentId, (deploymentId && this.deploymentRealization(deploymentId)) || realizationId, r.thingId, r.artifactId,
        r.buildId, r.commit, this.systemCommitFor(r.commit), r.kind, r.subject, r.emittedAt, receivedAt, payloadJson,
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
    if (q.deployment) { where.push("deployment_id = ?"); args.push(q.deployment); }
    if (q.commit) { where.push("commit_hash LIKE ? ESCAPE '\\'"); args.push(`${q.commit.replace(/[\\%_]/g, "\\$&")}%`); }
    if (q.kind) { where.push("kind = ?"); args.push(q.kind); }
    if (q.realization) { where.push("realization_id = ?"); args.push(q.realization); }
    if (q.before !== undefined && Number.isFinite(q.before)) { where.push("seq < ?"); args.push(q.before); }
    const rows = this.all(
      `SELECT * FROM phenome_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`,
      ...args, limit + 1,
    );
    const page = rows.slice(0, limit);
    const events = page.map((r) => this.dto(systemId, r));
    // Bare columns alongside MAX(seq) come from the newest event of each version.
    const versions = this.all(
      `SELECT build_id, commit_hash, deployment_id, system_commit, COUNT(*) AS n, MAX(seq) AS newest FROM phenome_events
       GROUP BY build_id, commit_hash ORDER BY newest DESC LIMIT ?`,
      MAX_VERSIONS,
    ).map((r) => ({
      key: String(r.build_id), buildId: String(r.build_id), commit: String(r.commit_hash),
      deployment: str(r.deployment_id), systemCommit: str(r.system_commit), count: Number(r.n),
    }));
    return { events, ...(rows.length > limit && { nextBefore: Number(page[page.length - 1].seq) }), versions };
  }

  private dto(systemId: string, r: Row): PhenomeEvent {
    let envelope: { criterion?: string; payload?: unknown } = {};
    try { envelope = JSON.parse(String(r.payload_json ?? "{}")) as typeof envelope; } catch { /* unreadable payload stays empty */ }
    const opt = <K extends string>(k: K, v: string | null) => (v === null ? {} : { [k]: v } as Record<K, string>);
    return {
      id: String(r.event_id).replace(/^(admin|deployment:[^:]+|realization:[^:]+):/, ""), seq: Number(r.seq), systemId, thingId: String(r.thing_id), artifactId: String(r.artifact_id),
      buildId: String(r.build_id), commit: String(r.commit_hash), ...opt("systemCommit", str(r.system_commit)),
      ...opt("deploymentId", str(r.deployment_id)), emittedAt: String(r.emitted_at), receivedAt: String(r.received_at),
      kind: String(r.kind), ...opt("subject", str(r.subject)), ...(envelope.criterion ? { criterion: envelope.criterion } : {}),
      payload: envelope.payload ?? null, ...opt("realization", str(r.realization_id)),
    };
  }
}
