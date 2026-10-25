-- Release emails to every member.
--
-- One announcer (lib/release.ts, on the 10-minute cron) covers every way an
-- episode becomes watchable, not only scheduled releases. Each announcement
-- fans out to a durable email outbox drained in leased Resend batches, so a
-- crash or a rate limit never loses recipients and nobody is emailed twice.

-- Instant clips and photo posts, flagged when they are created (publishClip),
-- so the announcer never has to infer it from a second write.
ALTER TABLE episodes ADD COLUMN is_clip INTEGER NOT NULL DEFAULT 0;
UPDATE episodes SET is_clip = 1
WHERE media_type = 'image' OR EXISTS (SELECT 1 FROM clip_reviews cr WHERE cr.episode_id = episodes.id);

CREATE TABLE release_announcements (
  id                TEXT PRIMARY KEY,
  title_id          TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  -- JSON array of the episode ids announced together (one title per announcement).
  episode_ids       TEXT NOT NULL,
  -- release = newly watchable episodes; reminders = a late "Notify me" for an episode announced earlier.
  mode              TEXT NOT NULL DEFAULT 'release' CHECK (mode IN ('release', 'reminders')),
  -- 1 when the episodes are instant clips or photo posts (in-app and push only, never email).
  is_clip           INTEGER NOT NULL DEFAULT 0,
  -- 1 when every eligible member was emailed (vetted title, within the caps).
  member_wide       INTEGER NOT NULL DEFAULT 0,
  notified_users    INTEGER NOT NULL DEFAULT 0,
  email_recipients  INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_release_announcements_title ON release_announcements (title_id, created_at);
CREATE INDEX idx_release_announcements_created ON release_announcements (created_at);

CREATE TABLE email_outbox (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id  TEXT NOT NULL REFERENCES release_announcements(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Why this member gets it: they tapped Notify me, they follow the creator, or release emails are on.
  reason           TEXT NOT NULL CHECK (reason IN ('reminder', 'follower', 'member')),
  -- sending = leased into a Resend batch identified by batch_key (retried with the same key).
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  batch_key        TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  resend_id        TEXT,
  created_at       TEXT NOT NULL,
  sent_at          TEXT,
  UNIQUE (announcement_id, user_id)
);

CREATE INDEX idx_email_outbox_queue ON email_outbox (status, id);
CREATE INDEX idx_email_outbox_batch ON email_outbox (batch_key) WHERE batch_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clip_reviews_episode ON clip_reviews (episode_id);

-- Everything already watchable, and everything on a title that was ever live
-- (published now, made private, taken down, or suppressed), counts as
-- announced, so the new announcer never emails members about the existing
-- catalog, including when an old title is republished or unsuppressed.
-- Drafts that were never published, and future scheduled episodes, stay
-- announceable.
UPDATE episodes
SET release_notified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE release_notified_at IS NULL
  AND (release_at IS NULL OR release_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  AND EXISTS (
    SELECT 1 FROM titles t
    WHERE t.id = episodes.title_id
      AND (t.published = 1 OR t.published_at IS NOT NULL OR t.suppressed = 1)
  );
