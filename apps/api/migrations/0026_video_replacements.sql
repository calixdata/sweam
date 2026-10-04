-- In-place video replacement. A live episode's video can be swapped for a new
-- file without a fresh submission: the episode id, title, URL, and watch history
-- all stay the same. Creators submit a replacement for admin to apply; admins
-- can also swap any episode's video directly. This table is the request queue
-- and the audit trail.

CREATE TABLE IF NOT EXISTS video_replacements (
  id           TEXT PRIMARY KEY,
  episode_id   TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  title_id     TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  creator_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('creator_request', 'admin_direct')),
  source_url   TEXT NOT NULL,
  captions_url TEXT,
  note         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  created_at   TEXT NOT NULL,
  decided_at   TEXT,
  decided_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_video_replacements_status ON video_replacements (status, created_at);
CREATE INDEX IF NOT EXISTS idx_video_replacements_episode ON video_replacements (episode_id);
