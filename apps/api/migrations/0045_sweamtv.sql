-- SweamTV (migration 0045): the lean-back channel for AI-generated binge
-- series and films on TVs (tv.sweam.co, Roku, Samsung, LG).
--
-- titles.ai_original marks what belongs on the channel. It is admin-curated
-- (Scion Saga first): creators do not self-declare in v1, so the lineup stays
-- a programmed channel rather than an open shelf.
--
-- tv_devices drives pairing. The TV shows a short code; the viewer claims it
-- at sweam.co/activate while signed in; the TV's next poll mints a NORMAL
-- session (sessions table stays the single authority), so watch history and
-- resume are shared with the web and the mobile app, and Settings can list
-- and revoke TVs by deleting that session.

ALTER TABLE titles ADD COLUMN ai_original INTEGER NOT NULL DEFAULT 0;

CREATE TABLE tv_devices (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'tv-web',
  -- A model or room name the TV shell may report ("Living room Roku").
  name TEXT,
  -- The pairing code shown on the TV; cleared the moment the session is
  -- handed over, so a code can never be claimed or replayed afterwards.
  code TEXT,
  code_expires_at TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  -- sha256 of the device's session token. The sessions row is the authority;
  -- this copy maps the device to it for listing and revocation.
  session_token_hash TEXT,
  created_at TEXT NOT NULL,
  paired_at TEXT,
  last_seen_at TEXT
);

CREATE UNIQUE INDEX idx_tv_devices_code ON tv_devices (code) WHERE code IS NOT NULL;
CREATE INDEX idx_tv_devices_user ON tv_devices (user_id);
