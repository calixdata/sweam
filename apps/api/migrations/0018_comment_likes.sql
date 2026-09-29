-- Likes on comments (double-tap to like, TikTok/Instagram style). One row per
-- (comment, user); the count is derived, so unliking just deletes the row.

CREATE TABLE comment_likes (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX idx_comment_likes_comment ON comment_likes (comment_id);
