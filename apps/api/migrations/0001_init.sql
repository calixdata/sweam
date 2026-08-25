-- Sweam initial schema.
--
-- Conventions:
--   * ids are opaque TEXT (crypto.randomUUID() in the app; readable ids in seeds)
--   * timestamps are ISO-8601 UTC strings written by the application
--   * booleans are INTEGER 0/1
--   * every child table cascades on delete so removing a title or user cleans up fully

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE creator_profiles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  bio        TEXT NOT NULL DEFAULT '',
  verified   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Sessions store only a SHA-256 hash of the bearer token, so a leaked database
-- cannot be replayed as live sessions.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE titles (
  id           TEXT PRIMARY KEY,
  creator_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('film', 'series', 'short', 'documentary')),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  synopsis     TEXT NOT NULL DEFAULT '',
  genre        TEXT NOT NULL,
  advisory     TEXT NOT NULL DEFAULT 'TV-PG' CHECK (advisory IN ('TV-G', 'TV-PG', 'TV-14', 'TV-MA')),
  poster_url   TEXT,
  published    INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_titles_creator ON titles(creator_id);
CREATE INDEX idx_titles_published_genre ON titles(published, genre);

CREATE TABLE episodes (
  id           TEXT PRIMARY KEY,
  title_id     TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season       INTEGER NOT NULL DEFAULT 1,
  episode      INTEGER NOT NULL DEFAULT 1,
  name         TEXT NOT NULL,
  synopsis     TEXT NOT NULL DEFAULT '',
  video_url    TEXT NOT NULL,
  captions_url TEXT,
  duration_s   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  UNIQUE (title_id, season, episode)
);

CREATE INDEX idx_episodes_title ON episodes(title_id);

-- Denormalized per-title counters that feed the discovery ranking. Kept in a
-- separate row per title (created with the title) so ranking reads are one
-- indexed join instead of aggregation over event tables.
CREATE TABLE title_stats (
  title_id      TEXT PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
  impressions   INTEGER NOT NULL DEFAULT 0,
  plays         INTEGER NOT NULL DEFAULT 0,
  completes     INTEGER NOT NULL DEFAULT 0,
  likes         INTEGER NOT NULL DEFAULT 0,
  watch_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE progress (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position_s INTEGER NOT NULL,
  duration_s INTEGER NOT NULL,
  completed  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, episode_id)
);

CREATE INDEX idx_progress_user_updated ON progress(user_id, updated_at);

CREATE TABLE watchlist (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, title_id)
);

CREATE TABLE likes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id   TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, title_id)
);
