/**
 * Changelog cache held by each System's SystemAuthority: one row per System commit with the computed `ChangelogRow`
 * and `ChangelogEntry` JSON. System commits are immutable, so an entry is computed once and served from here after.
 * The `changelog_cache` table is created by `schema.ts`.
 */
import { nowIso } from "../util";

type Row = Record<string, SqlStorageValue>;

/** Cached JSON for one System commit; `entry` is null when it was too large to cache (it is recomputed on read). */
export interface CachedChangelog { row: string; entry: string | null }

/**
 * Bump when the cached row/entry shape or what it counts changes: rows stored under another version (or none, before
 * the column existed) are ignored and recomputed on the next read. 2: Genome file changes counted and linked.
 */
export const CHANGELOG_CACHE_VERSION = 2;

/** One SQLite row holds at most 2 MB; an entry above this is not cached (its light row still is). */
export const CHANGELOG_ENTRY_MAX_BYTES = 1_800_000;

export class ChangelogStore {
  constructor(private readonly sql: SqlStorage) {}

  get(commitId: string): CachedChangelog | null {
    const r = (this.sql.exec("SELECT row_json, entry_json FROM changelog_cache WHERE commit_id = ? AND version = ?", commitId, CHANGELOG_CACHE_VERSION).toArray() as Row[])[0];
    return r ? { row: String(r.row_json), entry: r.entry_json == null ? null : String(r.entry_json) } : null;
  }

  /** Cached rows for `commitIds` (missing ids are absent from the result). */
  rows(commitIds: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of commitIds) {
      const r = (this.sql.exec("SELECT row_json FROM changelog_cache WHERE commit_id = ? AND version = ?", id, CHANGELOG_CACHE_VERSION).toArray() as Row[])[0];
      if (r) out[id] = String(r.row_json);
    }
    return out;
  }

  put(commitId: string, row: string, entry: string | null): void {
    const keep = entry !== null && new TextEncoder().encode(entry).length <= CHANGELOG_ENTRY_MAX_BYTES ? entry : null;
    this.sql.exec(
      `INSERT INTO changelog_cache (commit_id, row_json, entry_json, created_at, version) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(commit_id) DO UPDATE SET row_json = excluded.row_json, entry_json = excluded.entry_json, version = excluded.version`,
      commitId, row, keep, nowIso(), CHANGELOG_CACHE_VERSION,
    );
  }
}
