/**
 * Registry state held by the `__registry` SystemAuthority instance: imported Systems and the
 * realization → System / fork index used by `/realizations/:rid` and the queue's `resolveFork`.
 */
import type { SystemSummary } from "../../shared/api";
import { nowIso } from "../util";

const REGISTRY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS registry_systems (system_id TEXT PRIMARY KEY, summary_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS registry_realizations (realization_id TEXT PRIMARY KEY, system_id TEXT NOT NULL, evolution_id TEXT NOT NULL DEFAULT '', fork_repo TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS registry_by_fork ON registry_realizations (fork_repo)",
];

type Row = Record<string, SqlStorageValue>;

export class RegistryStore {
  constructor(private readonly sql: SqlStorage) {
    for (const stmt of REGISTRY_SCHEMA) sql.exec(stmt);
  }

  private one(q: string, ...args: SqlStorageValue[]): Row | undefined {
    return (this.sql.exec(q, ...args).toArray() as Row[])[0];
  }

  registerSystem(summary: SystemSummary): void {
    this.sql.exec(
      `INSERT INTO registry_systems (system_id, summary_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(system_id) DO UPDATE SET summary_json = excluded.summary_json, updated_at = excluded.updated_at`,
      summary.systemId, JSON.stringify(summary), nowIso(),
    );
  }

  listSystems(): SystemSummary[] {
    return (this.sql.exec("SELECT summary_json FROM registry_systems ORDER BY system_id").toArray() as Row[])
      .map((r) => JSON.parse(String(r.summary_json)) as SystemSummary);
  }

  registerRealization(realizationId: string, systemId: string, evolutionId: string, forkRepo: string): void {
    this.sql.exec(
      `INSERT INTO registry_realizations (realization_id, system_id, evolution_id, fork_repo) VALUES (?, ?, ?, ?)
       ON CONFLICT(realization_id) DO UPDATE SET system_id = excluded.system_id, evolution_id = excluded.evolution_id, fork_repo = excluded.fork_repo`,
      realizationId, systemId, evolutionId, forkRepo,
    );
  }

  unregisterRealization(realizationId: string): void {
    this.sql.exec("DELETE FROM registry_realizations WHERE realization_id = ?", realizationId);
  }

  resolveRealization(realizationId: string): { systemId: string; evolutionId: string; forkRepo: string } | null {
    const r = this.one("SELECT system_id, evolution_id, fork_repo FROM registry_realizations WHERE realization_id = ?", realizationId);
    return r ? { systemId: String(r.system_id), evolutionId: String(r.evolution_id), forkRepo: String(r.fork_repo) } : null;
  }

  resolveFork(forkRepo: string): { systemId: string; evolutionId: string; realizationId: string } | null {
    const r = this.one("SELECT system_id, evolution_id, realization_id FROM registry_realizations WHERE fork_repo = ?", forkRepo);
    return r ? { systemId: String(r.system_id), evolutionId: String(r.evolution_id), realizationId: String(r.realization_id) } : null;
  }
}
