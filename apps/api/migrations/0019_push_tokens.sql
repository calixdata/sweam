-- Push notification device tokens: one row per device registration (FCM token
-- for the mobile app). A user can have several (multiple devices). Rows are
-- pruned when FCM reports a token is no longer valid.
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
