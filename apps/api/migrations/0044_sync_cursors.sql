-- Cursors for outbound syncs (lib/pmbSync.ts sends activity to PM Bestie
-- Analytics). One row per source, e.g. name 'pmb:follows', value = the last
-- timestamp sent (with '|more' when that page was full).
CREATE TABLE IF NOT EXISTS sync_cursors (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
