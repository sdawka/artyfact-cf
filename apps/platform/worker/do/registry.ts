/**
 * Registry state held by the `__registry` SystemAuthority instance: imported Systems and the
 * realization → System / fork index used by `/realizations/:rid` and the queue's `resolveFork`.
 */
import type { SystemSummary } from "../../shared/api";
import { nowIso } from "../util";

// Realization ids are unique only within a System, so the index is keyed on the fork repo (unique per namespace)
// with (system_id, realization_id) unique. `registry_realizations` was the earlier rid-keyed table; it is migrated once.
const REGISTRY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS registry_systems (system_id TEXT PRIMARY KEY, summary_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS registry_forks (fork_repo TEXT PRIMARY KEY, system_id TEXT NOT NULL, realization_id TEXT NOT NULL,
     evolution_id TEXT NOT NULL DEFAULT '', UNIQUE (system_id, realization_id))`,
  "CREATE INDEX IF NOT EXISTS registry_forks_by_rid ON registry_forks (realization_id)",
];

export type ResolvedRealization = { systemId: string; evolutionId: string; forkRepo: string };

type Row = Record<string, SqlStorageValue>;

export class RegistryStore {
  constructor(private readonly sql: SqlStorage) {
    for (const stmt of REGISTRY_SCHEMA) sql.exec(stmt);
    if (this.one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'registry_realizations'")) {
      const hasEvolution = !!this.one("SELECT 1 AS x FROM pragma_table_info('registry_realizations') WHERE name = 'evolution_id'");
      sql.exec(`INSERT OR IGNORE INTO registry_forks (fork_repo, system_id, realization_id, evolution_id)
        SELECT fork_repo, system_id, realization_id, ${hasEvolution ? "evolution_id" : "''"} FROM registry_realizations`);
      sql.exec("DROP TABLE registry_realizations");
    }
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

  hasSystem(systemId: string): boolean {
    return !!this.one("SELECT 1 AS x FROM registry_systems WHERE system_id = ?", systemId);
  }

  listSystems(): SystemSummary[] {
    return (this.sql.exec("SELECT summary_json FROM registry_systems ORDER BY system_id").toArray() as Row[])
      .map((r) => JSON.parse(String(r.summary_json)) as SystemSummary);
  }

  registerRealization(realizationId: string, systemId: string, evolutionId: string, forkRepo: string): void {
    // REPLACE resolves a clash on either key: the fork repo or the (system, realization) pair.
    this.sql.exec(
      "INSERT OR REPLACE INTO registry_forks (fork_repo, system_id, realization_id, evolution_id) VALUES (?, ?, ?, ?)",
      forkRepo, systemId, realizationId, evolutionId,
    );
  }

  unregisterRealization(systemId: string, realizationId: string): void {
    this.sql.exec("DELETE FROM registry_forks WHERE system_id = ? AND realization_id = ?", systemId, realizationId);
  }

  /** The System owning `realizationId`; `ambiguous` lists the Systems when more than one has that id. */
  resolveRealization(realizationId: string): ResolvedRealization | { ambiguous: string[] } | null {
    const rows = this.sql.exec("SELECT system_id, evolution_id, fork_repo FROM registry_forks WHERE realization_id = ? ORDER BY system_id", realizationId).toArray() as Row[];
    if (rows.length > 1) return { ambiguous: rows.map((r) => String(r.system_id)) };
    const r = rows[0];
    return r ? { systemId: String(r.system_id), evolutionId: String(r.evolution_id), forkRepo: String(r.fork_repo) } : null;
  }

  resolveFork(forkRepo: string): { systemId: string; evolutionId: string; realizationId: string } | null {
    const r = this.one("SELECT system_id, evolution_id, realization_id FROM registry_forks WHERE fork_repo = ?", forkRepo);
    return r ? { systemId: String(r.system_id), evolutionId: String(r.evolution_id), realizationId: String(r.realization_id) } : null;
  }
}
