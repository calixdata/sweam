-- Add a "prohibited" report reason (nudity, explicit, illegal). SQLite cannot
-- widen a CHECK constraint in place, so the reports table is rebuilt; existing
-- rows are preserved.

CREATE TABLE reports_new (
  id          TEXT PRIMARY KEY,
  title_id    TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('prohibited', 'abuse', 'spam', 'copyright', 'other')),
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution  TEXT,
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (reporter_id, title_id)
);

INSERT INTO reports_new
  SELECT id, title_id, reporter_id, reason, note, status, resolved_by, resolution, created_at, resolved_at
  FROM reports;

DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX idx_reports_status ON reports (status, created_at);
