-- Notification delivery: release emails (with one-click unsubscribe) and a log
-- of every push and email attempt, so a failed delivery is visible instead of
-- silently swallowed.

-- Email me when an episode I asked to be reminded about, or a creator I follow,
-- releases. On by default; the unsubscribe link and Settings switch turn it off.
ALTER TABLE users ADD COLUMN release_emails INTEGER NOT NULL DEFAULT 1;
-- Random per-user token for the unsubscribe link (no sign-in needed to unsubscribe).
ALTER TABLE users ADD COLUMN email_unsub_token TEXT;

CREATE TABLE delivery_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel     TEXT NOT NULL CHECK (channel IN ('push', 'email')),
  source      TEXT NOT NULL,              -- release, test, notify, ...
  user_id     TEXT,
  -- Last 8 characters of the device token (push) or the address domain (email).
  target      TEXT,
  ok          INTEGER NOT NULL,
  status      INTEGER,                    -- HTTP status from FCM or Resend; 0 = never reached
  error       TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_delivery_log_created ON delivery_log (created_at);
CREATE INDEX idx_delivery_log_user ON delivery_log (user_id, created_at);
