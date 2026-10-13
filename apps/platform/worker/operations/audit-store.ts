import type { OperationAuditEntry } from "../../shared/operations";
/** DO-local durable operational audit. Mutations record intent before external writes. */
export class OperationsAuditStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS operations_audit (id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, environment TEXT NOT NULL, flag_key TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL, entry_json TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS operations_audit_binding ON operations_audit(binding_id, at)");
  }
  begin(entry: OperationAuditEntry): boolean {
    const pending = this.sql.exec("SELECT entry_json FROM operations_audit WHERE binding_id=? AND environment=? AND flag_key=? AND status='pending' ORDER BY at DESC LIMIT 1", entry.bindingId, entry.environment, entry.key).toArray();
    for (const row of pending) {
      const old = JSON.parse(String(row.entry_json)) as OperationAuditEntry;
      if (old.environment !== entry.environment || old.key !== entry.key || old.status !== "pending") continue;
      if (Date.parse(entry.at) - Date.parse(old.at) < 60_000) return false;
      this.append({ ...old, status: "unknown" });
    }
    this.append(entry);
    return true;
  }
  append(entry: OperationAuditEntry): void {
    this.sql.exec("INSERT INTO operations_audit(id,binding_id,environment,flag_key,status,at,entry_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,entry_json=excluded.entry_json", entry.id, entry.bindingId, entry.environment, entry.key, entry.status, entry.at, JSON.stringify(entry));
  }
  list(bindingId: string, limit = 50): OperationAuditEntry[] {
    return this.sql.exec("SELECT entry_json FROM operations_audit WHERE binding_id=? ORDER BY at DESC,id DESC LIMIT ?", bindingId, Math.max(1, Math.min(200, Math.trunc(limit)))).toArray().map(r => JSON.parse(String(r.entry_json)) as OperationAuditEntry);
  }
}
