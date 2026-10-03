-- Scout royalty pool (phase 2). Scouts pay a flat monthly all-access fee instead
-- of per-creator Blu subscriptions; the creator share of that pool is split
-- across Blu creators by their share of scout-attributed watch-time.

-- Scout-attributed watch-time per Blu creator per day. A row accrues only when a
-- viewer holding active scout all-access (and who is not the creator) watches a
-- creator's Blu content. This is the apportionment base for each payout period.
CREATE TABLE IF NOT EXISTS scout_watch_daily (
  creator_id TEXT NOT NULL,
  day TEXT NOT NULL,
  watch_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (creator_id, day)
);

-- One computed distribution over [period_start, period_end) (ISO dates, end
-- exclusive). pool_cents is the active-scout count x the all-access fee x the
-- creator share; it is distributed across the allocations below.
CREATE TABLE IF NOT EXISTS blu_royalty_runs (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  pool_cents INTEGER NOT NULL DEFAULT 0,
  scout_count INTEGER NOT NULL DEFAULT 0,
  total_watch_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'computed',
  created_at TEXT NOT NULL
);

-- One period is distributed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_blu_royalty_runs_period
  ON blu_royalty_runs (period_start, period_end);

-- Per-creator cut within a run. stripe_transfer_id is set only when Stripe is
-- configured and the creator has a connected payout account; otherwise the row
-- stays 'pending' as an internal ledger entry until payouts go live.
CREATE TABLE IF NOT EXISTS blu_royalty_allocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  watch_seconds INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_transfer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blu_royalty_allocations_run
  ON blu_royalty_allocations (run_id);
