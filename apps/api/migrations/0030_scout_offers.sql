-- Scout offers and deals, and the title promotion that an accepted promo sets.
-- kind: 'external_sign' (sign to the scout's own network, handled off Sweam) or
-- 'sweam_promo' (promote on Sweam for a share of the title's earnings).
-- promo_percent: for sweam_promo, the % of the creator's own earnings agreed.
-- On accepting a sweam_promo offer, the title's promoted_* columns are set and it
-- shows "Promoted by [company]" and is boosted in discovery.
CREATE TABLE scout_offers (
  id TEXT PRIMARY KEY,
  scout_user_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  title_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  promo_percent INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX idx_scout_offers_creator ON scout_offers (creator_id, status);
CREATE INDEX idx_scout_offers_scout ON scout_offers (scout_user_id, created_at);

ALTER TABLE titles ADD COLUMN promoted_by TEXT;
ALTER TABLE titles ADD COLUMN promoted_scout_id TEXT;
ALTER TABLE titles ADD COLUMN promoted_percent INTEGER;
ALTER TABLE titles ADD COLUMN promoted_at TEXT;
