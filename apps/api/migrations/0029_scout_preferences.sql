-- Scout content-alert preferences and the once-per-title notify guard.
-- notify_enabled: master switch for new-content alerts (default on).
-- notify_genres / notify_kinds: JSON arrays the scout narrows alerts to; NULL or
-- empty means "all". titles.scouts_notified_at marks that a title has already
-- fanned its alert out, so re-publishing or re-toggling scoutable never re-pings.
ALTER TABLE scout_profiles ADD COLUMN notify_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scout_profiles ADD COLUMN notify_genres TEXT;
ALTER TABLE scout_profiles ADD COLUMN notify_kinds TEXT;
ALTER TABLE titles ADD COLUMN scouts_notified_at TEXT;
