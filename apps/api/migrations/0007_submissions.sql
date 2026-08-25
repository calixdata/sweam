-- Submissions (v0.7): the curated intake door. Anyone signed in can pitch
-- finished work with a link to a screener; every submission gets a human
-- decision, and acceptance routes the submitter into the Studio.

CREATE TABLE submissions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_name       TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('film', 'series', 'short', 'documentary')),
  genre            TEXT NOT NULL,
  synopsis         TEXT NOT NULL,
  work_url         TEXT NOT NULL,
  rights_confirmed INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  decided_at       TEXT,
  decided_by       TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_submissions_status ON submissions(status, created_at);
CREATE INDEX idx_submissions_user ON submissions(user_id, created_at);
