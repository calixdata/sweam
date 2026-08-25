-- Community (v0.6): creator follows, title comments with a moderation chain,
-- and comment reports feeding the admin queue.

CREATE TABLE follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (follower_id, creator_id)
);

CREATE INDEX idx_follows_creator ON follows(creator_id);

-- Flat comments with one level of replies (parent_id points at a top-level
-- comment). Removal is a soft-delete with the remover's role recorded, so a
-- removed parent can keep holding its visible replies as a placeholder and
-- moderation stays auditable.
CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  title_id   TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'visible'
             CHECK (status IN ('visible', 'removed_by_author', 'removed_by_creator', 'removed_by_admin')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_comments_title ON comments(title_id, created_at);
CREATE INDEX idx_comments_parent ON comments(parent_id);

CREATE TABLE comment_reports (
  id          TEXT PRIMARY KEY,
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'other')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (reporter_id, comment_id)
);

CREATE INDEX idx_comment_reports_status ON comment_reports(status, created_at);
