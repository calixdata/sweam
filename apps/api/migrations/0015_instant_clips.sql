-- Instant clips: record in Sweam and publish immediately, with a post-hoc AI
-- review queue for the admins (TikTok-style). A clip is a normal title/episode
-- that is published right away but starts in review_state = 'pending'.

-- Every existing title is already cleared. New instant clips set 'pending'.
ALTER TABLE titles
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'cleared'
  CHECK (review_state IN ('cleared', 'pending', 'flagged', 'removed'));

-- The admin moderation queue for instantly posted clips. The AI result is
-- stored as JSON (same shape as submissions.ai_review); ai_error records a
-- failed run so the admin still sees the item and can decide manually.
CREATE TABLE clip_reviews (
  id             TEXT PRIMARY KEY,
  title_id       TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id     TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  creator_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption        TEXT NOT NULL DEFAULT '',
  state          TEXT NOT NULL DEFAULT 'pending'
                   CHECK (state IN ('pending', 'cleared', 'flagged', 'removed')),
  ai_review      TEXT,
  ai_error       TEXT,
  ai_reviewed_at TEXT,
  decided_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_clip_reviews_state ON clip_reviews (state, created_at);
CREATE INDEX idx_clip_reviews_title ON clip_reviews (title_id);
