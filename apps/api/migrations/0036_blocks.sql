-- User blocking (required by Apple guideline 1.2 and Google Play's UGC policy
-- alongside reporting). A block is one-directional and private: the blocker
-- stops seeing the blocked account's titles in the feed, Discover, search and
-- their comments on any title, and neither account can follow the other.
-- Blocking removes any existing follow in both directions.
CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);
