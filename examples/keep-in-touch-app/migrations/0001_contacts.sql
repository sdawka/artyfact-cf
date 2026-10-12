CREATE TABLE IF NOT EXISTS contact_records (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  channels_json TEXT NOT NULL DEFAULT '[]',
  linked_account_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_records_owner ON contact_records (owner_account_id);
