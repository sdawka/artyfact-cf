/** SystemAuthority SQLite schema (backend.md B.2 plus platform tables). Applied idempotently on construction. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS head (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS system_commits (id TEXT PRIMARY KEY, parent TEXT, manifest_json TEXT NOT NULL, manifest_hash TEXT NOT NULL,
  evolution_ids TEXT NOT NULL, decision_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evolutions (id TEXT PRIMARY KEY, title TEXT, status TEXT, kind TEXT, base_commit TEXT, scope_json TEXT,
  criteria_json TEXT, affected_nodes TEXT, created_at TEXT, decided_at TEXT);
CREATE TABLE IF NOT EXISTS realizations (id TEXT PRIMARY KEY, evolution_id TEXT NOT NULL, n INTEGER NOT NULL, target TEXT NOT NULL,
  fork_repo TEXT NOT NULL, token_id TEXT, token_expires TEXT, base_commit TEXT, agent_label TEXT, status TEXT NOT NULL,
  packet_json TEXT, packet_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  base_repo TEXT, base_head TEXT, role TEXT, remote TEXT, rejection_reason TEXT);
CREATE TABLE IF NOT EXISTS checkpoints (realization_id TEXT NOT NULL, seq INTEGER NOT NULL, message TEXT, commit_hash TEXT,
  created_at TEXT NOT NULL, PRIMARY KEY (realization_id, seq));
CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, realization_id TEXT NOT NULL, commit_hash TEXT NOT NULL,
  manifest_json TEXT, changed_paths TEXT, changed_nodes TEXT, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'submitted',
  UNIQUE (realization_id, commit_hash));
CREATE TABLE IF NOT EXISTS evaluations (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, criterion_id TEXT NOT NULL, hook_id TEXT,
  execution TEXT NOT NULL, verdict TEXT NOT NULL, observations_json TEXT, evidence_key TEXT, verifier TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS evaluations_by_candidate ON evaluations (candidate_id, criterion_id);
CREATE TABLE IF NOT EXISTS events_seen (event_id TEXT PRIMARY KEY, seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conflict_reports (key TEXT PRIMARY KEY, candidates_json TEXT NOT NULL, json TEXT NOT NULL, computed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conflict_runs (candidate_id TEXT PRIMARY KEY, computed_at TEXT NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS evaluation_claims (candidate_id TEXT PRIMARY KEY, claimed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blob_sizes (hash TEXT PRIMARY KEY, size INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS candidate_reviews (candidate_id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_cache (genome_commit TEXT NOT NULL, part TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (genome_commit, part));
`;

/**
 * Columns added to tables after they first shipped. `CREATE TABLE IF NOT EXISTS` never alters an existing table,
 * so each is added on construction when `pragma_table_info` lacks it.
 */
export const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ["realizations", "base_repo", "TEXT"],
  ["realizations", "base_head", "TEXT"],
  ["realizations", "role", "TEXT"],
  ["realizations", "remote", "TEXT"],
  ["realizations", "rejection_reason", "TEXT"],
];

export function applySchema(sql: SqlStorage): void {
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) sql.exec(stmt);
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (!sql.exec("SELECT 1 FROM pragma_table_info(?) WHERE name = ?", table, column).toArray().length) {
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
}
