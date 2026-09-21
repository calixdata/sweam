-- First-party, cookieless analytics for analytics.sweam.co.
--
-- These tables live in the same database as the rest of Sweam but are written
-- and read by a separate Worker (apps/analytics). Privacy is designed in:
-- `analytics_hits` stores one page view with NO IP address and NO user agent.
-- `visitor_hash` is a salted, one-way hash of (secret salt + UTC day + IP + UA)
-- used only to count distinct visits within a single day; it cannot be reversed
-- and does not link a visitor across days. Raw hits are pruned after 90 days by
-- the analytics Worker's daily cron, which first folds each day's totals into
-- `analytics_daily` so long-term counts survive without retaining any hashes.

CREATE TABLE analytics_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,                     -- UTC YYYY-MM-DD
  ts TEXT NOT NULL,                      -- ISO 8601 timestamp
  path TEXT NOT NULL,                    -- app path only, never query strings
  ref_host TEXT NOT NULL DEFAULT '',     -- referring site host, or '' for direct
  width_bucket TEXT NOT NULL DEFAULT '', -- coarse viewport bucket (sm/md/lg/xl)
  visitor_hash TEXT NOT NULL
);

CREATE INDEX idx_analytics_hits_day ON analytics_hits (day);
CREATE INDEX idx_analytics_hits_day_path ON analytics_hits (day, path);
CREATE INDEX idx_analytics_hits_day_visitor ON analytics_hits (day, visitor_hash);

-- Permanent daily rollup. Holds no identifiers, so it is kept indefinitely.
CREATE TABLE analytics_daily (
  day TEXT PRIMARY KEY,                  -- UTC YYYY-MM-DD
  views INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0
);
