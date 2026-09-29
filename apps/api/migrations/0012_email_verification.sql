-- Email verification on sign-up.
--
-- New accounts must confirm their email before they can sign in. Existing
-- accounts are grandfathered as verified so no one is locked out. The
-- verification token is stored only as a SHA-256 hash with a short expiry.

ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verify_token_hash TEXT;
ALTER TABLE users ADD COLUMN verify_expires_at TEXT;

-- Grandfather everyone who already has an account.
UPDATE users SET email_verified = 1;

CREATE INDEX idx_users_verify_token ON users (verify_token_hash);
