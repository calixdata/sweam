import { CREATOR_REVENUE_SHARE } from '@sweam/shared';
import type { BluFundAllocation, BluFundRun, CreatorFundPayout } from '@sweam/shared';
import type { Env } from '../env';
import { getBluFundEligibility } from './blufund';
import { nowIso } from './http';
import { createTransfer, stripeConfigured } from './stripe';

/**
 * The Sweam Blu Fund payout engine (replaces the manual request-payout flow).
 * Each month the creator share of ad revenue (CREATOR_REVENUE_SHARE of the gross
 * recorded in ad_impressions) forms a pool, split across Fund-eligible creators
 * by their share of watch-time on free (ad-supported) content. Amounts are paid
 * via Connect transfers when Stripe is configured, else recorded as a pending
 * ledger. All amounts are integer millicents; transfers round to the cent.
 */

interface WatchRow {
  creatorId: string;
  watchSeconds: number;
  views: number;
}

/** Largest-remainder apportionment (in millicents) by watch-time. */
function apportion(items: WatchRow[], total: number, totalWeight: number): (WatchRow & { amountMillicents: number })[] {
  if (total <= 0 || totalWeight <= 0) {
    return items.map((i) => ({ ...i, amountMillicents: 0 }));
  }
  const withExact = items.map((i) => {
    const exact = (total * i.watchSeconds) / totalWeight;
    return { ...i, amountMillicents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = total - withExact.reduce((sum, i) => sum + i.amountMillicents, 0);
  const order = [...withExact].sort((a, b) => b.remainder - a.remainder);
  for (const it of order) {
    if (left <= 0) break;
    it.amountMillicents += 1;
    left -= 1;
  }
  return withExact.map((i) => ({
    creatorId: i.creatorId,
    watchSeconds: i.watchSeconds,
    views: i.views,
    amountMillicents: i.amountMillicents,
  }));
}

interface FundRunRow {
  id: string;
  period_start: string;
  period_end: string;
  gross_millicents: number;
  pool_millicents: number;
  eligible_creators: number;
  total_watch_seconds: number;
  status: string;
  created_at: string;
}

async function allocationsForRun(db: D1Database, runId: string): Promise<BluFundAllocation[]> {
  const { results } = await db
    .prepare(
      `SELECT a.creator_id, cp.handle, a.watch_seconds, a.views, a.amount_millicents, a.status
       FROM blu_fund_allocations a
       LEFT JOIN creator_profiles cp ON cp.user_id = a.creator_id
       WHERE a.run_id = ?
       ORDER BY a.amount_millicents DESC`,
    )
    .bind(runId)
    .all<{
      creator_id: string;
      handle: string | null;
      watch_seconds: number;
      views: number;
      amount_millicents: number;
      status: string;
    }>();
  return results.map((r) => ({
    creatorId: r.creator_id,
    handle: r.handle ?? r.creator_id,
    watchSeconds: r.watch_seconds,
    views: r.views,
    amountMillicents: r.amount_millicents,
    status: r.status as BluFundAllocation['status'],
  }));
}

function mapRun(row: FundRunRow, allocations: BluFundAllocation[]): BluFundRun {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grossMillicents: row.gross_millicents,
    poolMillicents: row.pool_millicents,
    eligibleCreators: row.eligible_creators,
    totalWatchSeconds: row.total_watch_seconds,
    status: row.status,
    createdAt: row.created_at,
    allocations,
  };
}

export async function listFundRuns(db: D1Database): Promise<BluFundRun[]> {
  const { results } = await db
    .prepare(
      `SELECT id, period_start, period_end, gross_millicents, pool_millicents, eligible_creators,
              total_watch_seconds, status, created_at
       FROM blu_fund_runs ORDER BY period_start DESC, created_at DESC LIMIT 24`,
    )
    .all<FundRunRow>();
  const runs: BluFundRun[] = [];
  for (const row of results) {
    runs.push(mapRun(row, await allocationsForRun(db, row.id)));
  }
  return runs;
}

/** A creator's recent monthly Blu Fund payouts (for the Studio). */
export async function creatorFundPayouts(db: D1Database, creatorId: string): Promise<CreatorFundPayout[]> {
  const { results } = await db
    .prepare(
      `SELECT r.period_start, r.period_end, a.watch_seconds, a.views, a.amount_millicents, a.status
       FROM blu_fund_allocations a JOIN blu_fund_runs r ON r.id = a.run_id
       WHERE a.creator_id = ? ORDER BY r.period_start DESC LIMIT 12`,
    )
    .bind(creatorId)
    .all<{
      period_start: string;
      period_end: string;
      watch_seconds: number;
      views: number;
      amount_millicents: number;
      status: string;
    }>();
  return results.map((r) => ({
    periodStart: r.period_start,
    periodEnd: r.period_end,
    watchSeconds: r.watch_seconds,
    views: r.views,
    amountMillicents: r.amount_millicents,
    status: r.status,
  }));
}

/**
 * Compute and record one Blu Fund distribution over [periodStart, periodEnd)
 * (ISO dates, end exclusive). Idempotent per period.
 */
export async function runBluFund(
  db: D1Database,
  env: Env,
  periodStart: string,
  periodEnd: string,
): Promise<BluFundRun> {
  const existing = await db
    .prepare('SELECT * FROM blu_fund_runs WHERE period_start = ? AND period_end = ?')
    .bind(periodStart, periodEnd)
    .first<FundRunRow>();
  if (existing) return mapRun(existing, await allocationsForRun(db, existing.id));

  // Gross ad revenue recorded in the period (millicents), and the creator pool.
  const grossRow = await db
    .prepare(
      "SELECT COALESCE(SUM(revenue_millicents), 0) AS g FROM ad_impressions WHERE date(created_at) >= ? AND date(created_at) < ?",
    )
    .bind(periodStart, periodEnd)
    .first<{ g: number }>();
  const grossMillicents = grossRow?.g ?? 0;
  const poolMillicents = Math.round(grossMillicents * CREATOR_REVENUE_SHARE);

  // Watch-time + views per creator on free (ad-supported) content in the period.
  const { results: watch } = await db
    .prepare(
      `SELECT t.creator_id AS creator_id,
              COALESCE(SUM(d.watch_seconds), 0) AS secs,
              COALESCE(SUM(d.plays), 0) AS views
       FROM title_stats_daily d JOIN titles t ON t.id = d.title_id
       WHERE t.is_blu = 0 AND d.day >= ? AND d.day < ?
       GROUP BY t.creator_id HAVING secs > 0`,
    )
    .bind(periodStart, periodEnd)
    .all<{ creator_id: string; secs: number; views: number }>();

  // Only Fund-eligible creators share the pool.
  const eligible: WatchRow[] = [];
  for (const row of watch) {
    const elig = await getBluFundEligibility(db, row.creator_id);
    if (elig.eligible) {
      eligible.push({ creatorId: row.creator_id, watchSeconds: row.secs, views: row.views });
    }
  }
  const totalWatch = eligible.reduce((sum, r) => sum + r.watchSeconds, 0);

  const runId = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO blu_fund_runs
         (id, period_start, period_end, gross_millicents, pool_millicents, eligible_creators, total_watch_seconds, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(runId, periodStart, periodEnd, grossMillicents, poolMillicents, eligible.length, totalWatch, 'computed', now)
    .run();

  const amounts = apportion(eligible, poolMillicents, totalWatch);
  const canPay = stripeConfigured(env);
  const out: BluFundAllocation[] = [];
  for (const a of amounts) {
    const cp = await db
      .prepare('SELECT handle, stripe_account_id FROM creator_profiles WHERE user_id = ?')
      .bind(a.creatorId)
      .first<{ handle: string | null; stripe_account_id: string | null }>();

    let status: BluFundAllocation['status'] = 'pending';
    let transferId: string | null = null;
    const cents = Math.round(a.amountMillicents / 1000);
    if (canPay && cp?.stripe_account_id && cents >= 1) {
      try {
        const transfer = await createTransfer(env, {
          amountCents: cents,
          destination: cp.stripe_account_id,
          metadata: { kind: 'blu_fund', runId, creatorId: a.creatorId },
        });
        transferId = transfer.id;
        status = 'paid';
      } catch {
        status = 'failed';
      }
    }

    await db
      .prepare(
        `INSERT INTO blu_fund_allocations
           (id, run_id, creator_id, watch_seconds, views, amount_millicents, stripe_transfer_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), runId, a.creatorId, a.watchSeconds, a.views, a.amountMillicents, transferId, status, now)
      .run();

    out.push({
      creatorId: a.creatorId,
      handle: cp?.handle ?? a.creatorId,
      watchSeconds: a.watchSeconds,
      views: a.views,
      amountMillicents: a.amountMillicents,
      status,
    });
  }

  const settled = out.length > 0 && out.every((a) => a.status === 'paid');
  if (settled) {
    await db.prepare('UPDATE blu_fund_runs SET status = ? WHERE id = ?').bind('paid', runId).run();
  }

  return {
    id: runId,
    periodStart,
    periodEnd,
    grossMillicents,
    poolMillicents,
    eligibleCreators: eligible.length,
    totalWatchSeconds: totalWatch,
    status: settled ? 'paid' : 'computed',
    createdAt: now,
    allocations: out,
  };
}
