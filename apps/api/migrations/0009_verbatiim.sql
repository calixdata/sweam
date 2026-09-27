-- Verbatiim integration: creators make an episode from their prose, a
-- screenplay, or one prompt. Sweam keeps its own record of each job; the
-- finished film is copied into R2 and becomes an ordinary episode that goes
-- through the same transcode pipeline as an upload.

CREATE TABLE verbatiim_jobs (
  id          TEXT PRIMARY KEY,
  -- The job id on the Verbatiim side; webhooks and polling look it up by this.
  remote_id   TEXT NOT NULL UNIQUE,
  creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id    TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id  TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('adapt', 'fountain', 'prompt')),
  season      INTEGER NOT NULL,
  episode     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  synopsis    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'importing', 'done', 'failed')),
  progress    TEXT,
  error       TEXT,
  clips_json  TEXT NOT NULL DEFAULT '[]',
  credits     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_verbatiim_jobs_title ON verbatiim_jobs(title_id, created_at);

-- The signed credits Verbatiim issues (whose words, which engines), shown to
-- viewers on the watch page so AI involvement is disclosed automatically.
ALTER TABLE episodes ADD COLUMN ai_credits TEXT;
