-- Sweam Blu Fund payout engine. The creator share of each month's ad revenue is
-- pooled and distributed to Fund-eligible creators by their share of watch-time
-- on free (ad-supported) content. This replaces the manual request-payout flow.

CREATE TABLE IF NOT EXISTS blu_fund_runs (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  gross_millicents INTEGER NOT NULL DEFAULT 0,
  pool_millicents INTEGER NOT NULL DEFAULT 0,
  eligible_creators INTEGER NOT NULL DEFAULT 0,
  total_watch_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'computed',
  created_at TEXT NOT NULL
);

-- One run per period.
CREATE UNIQUE INDEX IF NOT EXISTS idx_blu_fund_runs_period
  ON blu_fund_runs (period_start, period_end);

CREATE TABLE IF NOT EXISTS blu_fund_allocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  watch_seconds INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  amount_millicents INTEGER NOT NULL DEFAULT 0,
  stripe_transfer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blu_fund_allocations_run
  ON blu_fund_allocations (run_id);
CREATE INDEX IF NOT EXISTS idx_blu_fund_allocations_creator
  ON blu_fund_allocations (creator_id, created_at);
