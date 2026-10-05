-- Profile pictures and in-app account settings (change email).
-- avatar_url: the account's profile picture (a /media/... key from our uploader).
-- pending_email + token: a requested new email that is not active until the
-- owner confirms it from the emailed link (new email must be verified first).
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN pending_email TEXT;
ALTER TABLE users ADD COLUMN pending_email_token_hash TEXT;
ALTER TABLE users ADD COLUMN pending_email_expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_users_pending_email_token ON users (pending_email_token_hash);
