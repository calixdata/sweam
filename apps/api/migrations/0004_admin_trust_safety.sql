-- Admin console and trust & safety (v0.4): admin role, report flow,
-- takedowns, strikes, in-app notifications, rate limiting, and scout
-- application decisions.

-- Admins are provisioned by operations (the seed documents the one-liner);
-- there is deliberately no self-serve path to this table.
CREATE TABLE admins (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

-- One report per viewer per title. Reports feed the admin moderation queue.
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  title_id    TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'copyright', 'other')),
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution  TEXT,
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (reporter_id, title_id)
);

CREATE INDEX idx_reports_status ON reports(status, created_at);

-- A takedown unpublishes a title and blocks republishing until released.
CREATE TABLE takedowns (
  id          TEXT PRIMARY KEY,
  title_id    TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('dmca', 'guidelines')),
  reason      TEXT NOT NULL,
  report_id   TEXT REFERENCES reports(id) ON DELETE SET NULL,
  issued_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  released_at TEXT
);

CREATE INDEX idx_takedowns_title ON takedowns(title_id, released_at);

-- Three active (non-revoked) strikes in a rolling 90-day window suspends a
-- creator from publishing, uploading, and creating titles.
CREATE TABLE strikes (
  id         TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  report_id  TEXT REFERENCES reports(id) ON DELETE SET NULL,
  issued_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_strikes_creator ON strikes(creator_id, revoked_at, created_at);

-- In-app notifications; body is prerendered text, link is app-relative.
CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL,
  link       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at);

-- Fixed-window rate limiting counters. D1 is a single primary, so one row per
-- (bucket, window) is globally consistent; stale windows are pruned lazily.
CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- Scout applications can now be rejected. SQLite cannot alter a CHECK
-- constraint, so the table is rebuilt; approved_at becomes decided_at.
CREATE TABLE scout_profiles_new (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_name      TEXT NOT NULL,
  org_url       TEXT,
  contact_email TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TEXT NOT NULL,
  decided_at    TEXT
);

INSERT INTO scout_profiles_new (user_id, org_name, org_url, contact_email, status, created_at, decided_at)
SELECT user_id, org_name, org_url, contact_email, status, created_at, approved_at FROM scout_profiles;

DROP TABLE scout_profiles;

ALTER TABLE scout_profiles_new RENAME TO scout_profiles;

-- Lets the HLS garbage collector skip prefixes it has already swept.
ALTER TABLE transcode_jobs ADD COLUMN cleaned_at TEXT;
