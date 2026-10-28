-- Account standing set by Sweam staff (lib/accounts.ts): active, suspended
-- (until a date, or until restored), or banned. Suspended and banned accounts
-- cannot sign in, and their titles and comments are hidden; a restore puts back
-- exactly what the suspension or ban hid (account_actions below).
ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN status_reason TEXT;
ALTER TABLE users ADD COLUMN status_until TEXT;
ALTER TABLE users ADD COLUMN status_changed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users (account_status) WHERE account_status <> 'active';

-- Every staff action on an account, with what a suspension or ban hid. user_id
-- is deliberately not a foreign key: the record outlives a deleted account.
CREATE TABLE IF NOT EXISTS account_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_label TEXT NOT NULL,
  action TEXT NOT NULL,          -- suspend | ban | restore | delete | set_password
  reason TEXT,
  until TEXT,
  hidden_titles TEXT,            -- JSON array of title ids this action unpublished
  hidden_comments TEXT,          -- JSON array of comment ids this action hid
  restored_at TEXT,
  actor_id TEXT NOT NULL,        -- admin user id, or 'system' (a suspension that ran out)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_actions_user ON account_actions (user_id, created_at);
