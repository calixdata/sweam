-- Submission upgrades: named series, viewer rating, required cover art,
-- auto-publish on approval (admin-locked titles), and creator removal requests.

CREATE TABLE series (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_series_user ON series (user_id, name);

ALTER TABLE submissions ADD COLUMN rating TEXT;
ALTER TABLE submissions ADD COLUMN poster_url TEXT;
ALTER TABLE submissions ADD COLUMN series_id TEXT REFERENCES series(id) ON DELETE SET NULL;

-- Titles Sweam publishes on approval are admin-locked: the creator cannot
-- unpublish or delete them, only request removal with a reason. A series title
-- links back to its series so later parts add episodes to the same title.
ALTER TABLE titles ADD COLUMN admin_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE titles ADD COLUMN series_id TEXT REFERENCES series(id) ON DELETE SET NULL;

CREATE TABLE removal_requests (
  id         TEXT PRIMARY KEY,
  title_id   TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'removed', 'declined')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_removal_status ON removal_requests (status, created_at);
