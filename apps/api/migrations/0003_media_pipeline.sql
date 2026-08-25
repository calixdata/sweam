-- Media pipeline (v0.2, shipped after v0.3): the transcode job queue, episode
-- source/thumbnail tracking, and anonymous view sessions.

-- The original upload, kept separately from video_url so the playback URL can
-- flip to the HLS master when a transcode completes and the source remains
-- available for re-transcoding.
ALTER TABLE episodes ADD COLUMN source_url TEXT;
ALTER TABLE episodes ADD COLUMN thumbnail_url TEXT;

-- The transcode queue. Claiming is a single atomic UPDATE (at-least-once
-- delivery); attempts increment on claim so a poison job stops after
-- MAX_ATTEMPTS; a running job whose claim has gone stale (worker died) becomes
-- claimable again. Outputs land under hls/{episode}/{job}/ so a canceled
-- job's partial files can never collide with its replacement.
CREATE TABLE transcode_jobs (
  id         TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'canceled')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claimed_at TEXT,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_transcode_jobs_status ON transcode_jobs(status, created_at);
CREATE INDEX idx_transcode_jobs_episode ON transcode_jobs(episode_id);

-- Anonymous viewing sessions: a client-generated random view id per episode,
-- never linked to an account, IP, or fingerprint. Lets signed-out plays,
-- finishes, and retention count without collecting identity.
CREATE TABLE anonymous_views (
  view_id        TEXT NOT NULL,
  episode_id     TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  title_id       TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  max_position_s INTEGER NOT NULL DEFAULT 0,
  duration_s     INTEGER NOT NULL,
  completed      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (view_id, episode_id)
);

CREATE INDEX idx_anonymous_views_episode ON anonymous_views(episode_id);
