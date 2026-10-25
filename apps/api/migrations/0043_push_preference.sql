-- Phone notifications on or off, per account. When off, Sweam sends no push to
-- any of this account's phones (a test from Settings still goes through, so a
-- member can check the connection). In-app notifications are unaffected.
ALTER TABLE users ADD COLUMN push_enabled INTEGER NOT NULL DEFAULT 1;
