-- Password reset. A reset link emails a single-use token (stored hashed, like
-- the email-verification token); submitting it with a new password sets the hash
-- and signs the account out everywhere.

ALTER TABLE users ADD COLUMN reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN reset_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token_hash);
