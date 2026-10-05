-- Official accounts, account-level identity verification, scheduled releases.
--
-- 1. users.official: Sweam's own account and flagship creators. The gates that
--    exist for ordinary users (rate limits, the Blu offer bar and Fund
--    eligibility, the Blu switch cooldown, review auto-hide, strike
--    suspension, Blu delete locks, the 512 MB upload cap) do not apply to them.
-- 2. users.verified: identity-verified accounts carry the pink check. Set by an
--    admin after reviewing an ID plus a proof of address (identity_verifications),
--    or directly for official accounts. The legacy creator_profiles.verified flag
--    is carried up so nothing already verified loses its mark.
-- 3. episodes.release_at: a scheduled release unlocks for streaming at that
--    instant (midnight Eastern on the chosen date). Viewers can set a reminder;
--    a cron notifies reminders and followers once it releases.
ALTER TABLE users ADD COLUMN official INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verified_at TEXT;
UPDATE users SET verified = 1, verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT user_id FROM creator_profiles WHERE verified = 1);

CREATE TABLE identity_verifications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_name      TEXT NOT NULL,
  id_doc_key      TEXT NOT NULL,
  address_doc_key TEXT NOT NULL,
  method          TEXT NOT NULL DEFAULT 'documents',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note            TEXT,
  reviewer_id     TEXT,
  created_at      TEXT NOT NULL,
  decided_at      TEXT
);
CREATE INDEX idx_identity_verifications_user ON identity_verifications(user_id, created_at);
CREATE INDEX idx_identity_verifications_status ON identity_verifications(status, created_at);

ALTER TABLE episodes ADD COLUMN release_at TEXT;
ALTER TABLE episodes ADD COLUMN release_notified_at TEXT;
CREATE INDEX idx_episodes_release ON episodes(release_at);
ALTER TABLE submissions ADD COLUMN release_date TEXT;

CREATE TABLE release_reminders (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, episode_id)
);
CREATE INDEX idx_release_reminders_episode ON release_reminders(episode_id);

-- Flagship creator: Scion Saga is Sweam's own content.
UPDATE users SET official = 1, verified = 1,
  verified_at = COALESCE(verified_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE email = 'thescionsaga@gmail.com';

-- Sweam's own account, the one users follow. No password is set: it is claimed
-- through the password-reset email to its address.
INSERT OR IGNORE INTO users
  (id, email, display_name, password_hash, created_at, email_verified, username, age_confirmed,
   official, verified, verified_at, is_demo)
VALUES
  ('usr_sweam', 'support@sweam.co', 'Sweam', 'locked-claim-via-password-reset',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 'sweam', 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0);
