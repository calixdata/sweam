-- Monetization (v0.5): AVOD pre-roll inventory, the impression revenue
-- ledger, and creator payout requests. All amounts are integer millicents
-- (1/1000 cent): a CPM priced in cents earns exactly cpm_cents millicents
-- per impression, so the ledger never needs floating point.

CREATE TABLE ads (
  id         TEXT PRIMARY KEY,
  sponsor    TEXT NOT NULL,
  headline   TEXT NOT NULL,
  media_url  TEXT NOT NULL,
  click_url  TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  cpm_cents  INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- One row per served pre-roll. revenue/creator amounts are frozen at serve
-- time so later CPM or share changes never rewrite history.
CREATE TABLE ad_impressions (
  id                 TEXT PRIMARY KEY,
  ad_id              TEXT NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  title_id           TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  creator_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer             TEXT NOT NULL CHECK (viewer IN ('user', 'anon')),
  revenue_millicents INTEGER NOT NULL,
  creator_millicents INTEGER NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_ad_impressions_creator ON ad_impressions(creator_id, created_at);
CREATE INDEX idx_ad_impressions_title ON ad_impressions(title_id, created_at);
CREATE INDEX idx_ad_impressions_ad ON ad_impressions(ad_id);

-- Payout requests move balance out of "available"; paid/rejected are decided
-- by an admin (a rejected request returns its amount to available). Actual
-- money movement waits on a payment provider decision, documented in the
-- roadmap, so status is a ledger fact rather than a bank transfer.
CREATE TABLE payout_requests (
  id                TEXT PRIMARY KEY,
  creator_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_millicents INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
  requested_at      TEXT NOT NULL,
  decided_at        TEXT,
  decided_by        TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_payout_requests_creator ON payout_requests(creator_id, status);
CREATE INDEX idx_payout_requests_status ON payout_requests(status, requested_at);
