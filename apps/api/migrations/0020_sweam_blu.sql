-- Sweam Blu: subscriber-only paid content.
-- A title is either Free or Blu; when Blu it carries a preset monthly price
-- (in cents) and the timestamp of its last Free<->Blu switch (for the cooldown).
ALTER TABLE titles ADD COLUMN is_blu INTEGER NOT NULL DEFAULT 0;
ALTER TABLE titles ADD COLUMN blu_price_cents INTEGER;
ALTER TABLE titles ADD COLUMN blu_changed_at TEXT;

-- A fan's subscription to one creator's Blu (at most one row per pair).
CREATE TABLE IF NOT EXISTS blu_subscriptions (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due')),
  price_cents INTEGER NOT NULL,
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  canceled_at TEXT,
  UNIQUE (subscriber_id, creator_id)
);
CREATE INDEX IF NOT EXISTS idx_blu_subs_creator ON blu_subscriptions(creator_id);
CREATE INDEX IF NOT EXISTS idx_blu_subs_subscriber ON blu_subscriptions(subscriber_id);

-- Scout all-access: one fee grants viewing of all Blu content.
CREATE TABLE IF NOT EXISTS scout_all_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due')),
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  canceled_at TEXT
);

-- Audit log of every Free<->Blu switch, backing the cooldown and abuse checks.
CREATE TABLE IF NOT EXISTS blu_switch_log (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  from_blu INTEGER NOT NULL,
  to_blu INTEGER NOT NULL,
  price_cents INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blu_switch_title ON blu_switch_log(title_id);
