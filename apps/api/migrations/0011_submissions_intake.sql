-- Submissions v2: direct upload intake, a richer review pipeline, and the
-- fields the admin CRM and AI review need.
--
-- Submissions used to carry only an external screener link (work_url). They now
-- can host content on Sweam directly (source_url), carry captions, remember a
-- Verbatiim project they were imported from, move through more review states,
-- and store the most recent AI review. SQLite cannot widen a CHECK constraint
-- in place, so the table is rebuilt (the project's established pattern) and the
-- existing rows are copied across unchanged.

CREATE TABLE submissions_new (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_name           TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('film', 'series', 'short', 'documentary')),
  genre                TEXT NOT NULL,
  synopsis             TEXT NOT NULL,
  work_url             TEXT NOT NULL DEFAULT '',
  source_url           TEXT,
  captions_url         TEXT,
  verbatiim_project_id TEXT,
  rights_confirmed     INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'under_review', 'accepted', 'declined', 'withdrawn')),
  note                 TEXT NOT NULL DEFAULT '',
  reviewer_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  ai_review            TEXT,
  ai_reviewed_at       TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT,
  decided_at           TEXT,
  decided_by           TEXT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO submissions_new
  (id, user_id, title_name, kind, genre, synopsis, work_url, rights_confirmed, status, note, created_at, decided_at, decided_by)
  SELECT id, user_id, title_name, kind, genre, synopsis, work_url, rights_confirmed, status, note, created_at, decided_at, decided_by
  FROM submissions;

DROP TABLE submissions;
ALTER TABLE submissions_new RENAME TO submissions;

CREATE INDEX idx_submissions_status ON submissions(status, created_at);
CREATE INDEX idx_submissions_user ON submissions(user_id, created_at);
