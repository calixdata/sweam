-- Scout portal (v0.3): scout identities, creator opt-in visibility, daily
-- counters for momentum boards, furthest-watched positions for retention
-- curves, and the one-sheet view / interest loop.

-- Scouts apply with an organization identity; approval is an operations step
-- until the admin console ships (v0.4). Only approved scouts can read the
-- portal.
CREATE TABLE scout_profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_name      TEXT NOT NULL,
  org_url       TEXT,
  contact_email TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at    TEXT NOT NULL,
  approved_at   TEXT
);

-- Creator opt-in, per title. Titles stay out of every scout surface until the
-- creator flips this on in the Studio.
ALTER TABLE titles ADD COLUMN scoutable INTEGER NOT NULL DEFAULT 0;

-- Furthest position ever reached, distinct from the resume position (which
-- moves backward when a viewer seeks back). Retention curves read this.
ALTER TABLE progress ADD COLUMN max_position_s INTEGER NOT NULL DEFAULT 0;
UPDATE progress SET max_position_s = position_s;

-- Daily deltas, maintained in the same batches as the lifetime counters in
-- title_stats. `day` is a UTC YYYY-MM-DD string. The `likes` column counts
-- like events and is not decremented on unlike; lifetime stats stay
-- authoritative for net totals.
CREATE TABLE title_stats_daily (
  title_id      TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  impressions   INTEGER NOT NULL DEFAULT 0,
  plays         INTEGER NOT NULL DEFAULT 0,
  completes     INTEGER NOT NULL DEFAULT 0,
  likes         INTEGER NOT NULL DEFAULT 0,
  watch_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (title_id, day)
);

-- Every one-sheet open is logged and visible to the title's creator.
CREATE TABLE onesheet_views (
  id            TEXT PRIMARY KEY,
  scout_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id      TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  viewed_at     TEXT NOT NULL
);

CREATE INDEX idx_onesheet_views_title ON onesheet_views(title_id, viewed_at);

CREATE TABLE scout_interests (
  id            TEXT PRIMARY KEY,
  scout_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id      TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (scout_user_id, title_id)
);

CREATE INDEX idx_scout_interests_title ON scout_interests(title_id, created_at);
