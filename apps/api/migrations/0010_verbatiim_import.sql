-- Verbatiim jobs can also start from a finished cut: a video plus captions
-- imported through Verbatiim, which adds captions, clips, and signed credits.
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt.

CREATE TABLE verbatiim_jobs_new (
  id          TEXT PRIMARY KEY,
  remote_id   TEXT NOT NULL UNIQUE,
  creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id    TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id  TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('adapt', 'fountain', 'prompt', 'import')),
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

INSERT INTO verbatiim_jobs_new SELECT id, remote_id, creator_id, title_id, episode_id, mode, season, episode, name, synopsis, status, progress, error, clips_json, credits, created_at, updated_at FROM verbatiim_jobs;
DROP TABLE verbatiim_jobs;
ALTER TABLE verbatiim_jobs_new RENAME TO verbatiim_jobs;
CREATE INDEX idx_verbatiim_jobs_title ON verbatiim_jobs(title_id, created_at);
