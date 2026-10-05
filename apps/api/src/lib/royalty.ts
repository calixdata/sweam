import { BLU_CREATOR_SHARE, SCOUT_ALL_ACCESS_CENTS } from '@sweam/shared';
import type { ScoutRoyaltyAllocation, ScoutRoyaltyRun } from '@sweam/shared';
import type { Env } from '../env';
import { nowIso } from './http';
import { createTransfer, stripeConfigured } from './stripe';

/**
 * Scout royalty pool. Scouts pay a flat monthly all-access fee (SCOUT_ALL_ACCESS_CENTS)
 * instead of subscribing to each creator's Blu. The creator share of that pool
 * (BLU_CREATOR_SHARE; Sweam keeps the rest, as with Blu) is split across Blu
 * creators by their share of scout-attributed watch-time in the period.
 */

/** Credit a Blu creator with scout-attributed watch-time (today). No-op for <= 0. */
export async function recordScoutWatch(
  db: D1Database,
  creatorId: string,
  watchSeconds: number,
): Promise<void> {
  const seconds = Math.round(watchSeconds);
  if (seconds <= 0) return;
  await db
    .prepare(
      `INSERT INTO scout_watch_daily (creator_id, day, watch_seconds)
       VALUES (?, date('now'), ?)
       ON CONFLICT (creator_id, day) DO UPDATE SET watch_seconds = watch_seconds + excluded.watch_seconds`,
    )
    .bind(creatorId, seconds)
    .run();
}

/** First day of the month before `now` and first day of `now`'s month (UTC, end exclusive). */
export function previousMonthPeriod(now: Date = new Date()): { periodStart: string; periodEnd: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    periodStart: iso(new Date(Date.UTC(year, month - 1, 1))),
    periodEnd: iso(new Date(Date.UTC(year, month, 1))),
  };
}

interface RunRow {
  id: string;
  period_start: string;
  period_end: string;
  pool_cents: number;
  scout_count: number;
  total_watch_seconds: number;
  status: string;
  created_at: string;
}

interface AllocRow {
  creator_id: string;
  handle: string | null;
  watch_seconds: number;
  amount_cents: number;
  status: string;
}

async function allocationsForRun(db: D1Database, runId: string): Promise<ScoutRoyaltyAllocation[]> {
  const { results } = await db
    .prepare(
      `SELECT a.creator_id, cp.handle, a.watch_seconds, a.amount_cents, a.status
       FROM blu_royalty_allocations a
       LEFT JOIN creator_profiles cp ON cp.user_id = a.creator_id
       WHERE a.run_id = ?
       ORDER BY a.amount_cents DESC`,
    )
    .bind(runId)
    .all<AllocRow>();
  return results.map((r) => ({
    creatorId: r.creator_id,
    handle: r.handle ?? r.creator_id,
    watchSeconds: r.watch_seconds,
    amountCents: r.amount_cents,
    status: r.status as ScoutRoyaltyAllocation['status'],
  }));
}

function mapRun(row: RunRow, allocations: ScoutRoyaltyAllocation[]): ScoutRoyaltyRun {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    poolCents: row.pool_cents,
    scoutCount: row.scout_count,
    totalWatchSeconds: row.total_watch_seconds,
    status: row.status,
    createdAt: row.created_at,
    allocations,
  };
}

/** The most recent royalty runs with their allocations (admin view). */
export async function listRoyaltyRuns(db: D1Database): Promise<ScoutRoyaltyRun[]> {
  const { results } = await db
    .prepare(
      `SELECT id, period_start, period_end, pool_cents, scout_count, total_watch_seconds, status, created_at
       FROM blu_royalty_runs ORDER BY period_start DESC, created_at DESC LIMIT 24`,
    )
    .all<RunRow>();
  const runs: ScoutRoyaltyRun[] = [];
  for (const row of results) {
    runs.push(mapRun(row, await allocationsForRun(db, row.id)));
  }
  return runs;
}

/** Largest-remainder apportionment so the parts sum to `total` exactly. */
function apportion(
  weights: { creatorId: string; watchSeconds: number }[],
  total: number,
  totalWeight: number,
): { creatorId: string; watchSeconds: number; amountCents: number }[] {
  if (total <= 0 || totalWeight <= 0) {
    return weights.map((w) => ({ ...w, amountCents: 0 }));
  }
  const withExact = weights.map((w) => {
    const exact = (total * w.watchSeconds) / totalWeight;
    return { ...w, amountCents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = total - withExact.reduce((sum, w) => sum + w.amountCents, 0);
  // Give the leftover cents to the largest fractional remainders first.
  const order = [...withExact].sort((a, b) => b.remainder - a.remainder);
  for (const item of order) {
    if (left <= 0) break;
    item.amountCents += 1;
    left -= 1;
  }
  return withExact.map((w) => ({ creatorId: w.creatorId, watchSeconds: w.watchSeconds, amountCents: w.amountCents }));
}

/**
 * Compute and record one scout royalty distribution over [periodStart, periodEnd)
 * (ISO dates, end exclusive). Idempotent per period. Transfers are sent only
 * when Stripe is configured and the creator has a connected payout account;
 * otherwise allocations are recorded 'pending' as an internal ledger.
 */
export async function runScoutRoyalty(
  db: D1Database,
  env: Env,
  periodStart: string,
  periodEnd: string,
): Promise<ScoutRoyaltyRun> {
  const existing = await db
    .prepare('SELECT * FROM blu_royalty_runs WHERE period_start = ? AND period_end = ?')
    .bind(periodStart, periodEnd)
    .first<RunRow>();
  if (existing) {
    return mapRun(existing, await allocationsForRun(db, existing.id));
  }

  // The pool is funded by fees actually collected: paid memberships only. A
  // scout still inside the first-50 free period (or holding a card-free free
  // membership) has not paid for the month, so they add nothing to the pool,
  // though their Blu watch-time still shapes how it is split.
  const scoutRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM scout_all_access saa
       JOIN scout_profiles sp ON sp.user_id = saa.user_id
       WHERE sp.status = 'approved' AND saa.status = 'active'
         AND saa.stripe_subscription_id IS NOT NULL
         AND (saa.trial_end IS NULL OR saa.trial_end < ?)`,
    )
    .bind(periodEnd)
    .first<{ n: number }>();
  const scoutCount = scoutRow?.n ?? 0;
  const poolCents = Math.round(scoutCount * SCOUT_ALL_ACCESS_CENTS * BLU_CREATOR_SHARE);

  const { results: watch } = await db
    .prepare(
      `SELECT creator_id, SUM(watch_seconds) AS secs
       FROM scout_watch_daily WHERE day >= ? AND day < ?
       GROUP BY creator_id HAVING secs > 0`,
    )
    .bind(periodStart, periodEnd)
    .all<{ creator_id: string; secs: number }>();
  const totalWatch = watch.reduce((sum, r) => sum + r.secs, 0);

  const runId = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO blu_royalty_runs
         (id, period_start, period_end, pool_cents, scout_count, total_watch_seconds, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(runId, periodStart, periodEnd, poolCents, scoutCount, totalWatch, 'computed', now)
    .run();

  const allocations = apportion(
    watch.map((r) => ({ creatorId: r.creator_id, watchSeconds: r.secs })),
    poolCents,
    totalWatch,
  );

  const canPay = stripeConfigured(env);
  const out: ScoutRoyaltyAllocation[] = [];
  for (const a of allocations) {
    const cp = await db
      .prepare('SELECT handle, stripe_account_id FROM creator_profiles WHERE user_id = ?')
      .bind(a.creatorId)
      .first<{ handle: string | null; stripe_account_id: string | null }>();

    let status: ScoutRoyaltyAllocation['status'] = 'pending';
    let transferId: string | null = null;
    if (canPay && cp?.stripe_account_id && a.amountCents > 0) {
      try {
        const transfer = await createTransfer(env, {
          amountCents: a.amountCents,
          destination: cp.stripe_account_id,
          metadata: { kind: 'scout_royalty', runId, creatorId: a.creatorId },
        });
        transferId = transfer.id;
        status = 'paid';
      } catch {
        status = 'failed';
      }
    }

    await db
      .prepare(
        `INSERT INTO blu_royalty_allocations
           (id, run_id, creator_id, watch_seconds, amount_cents, stripe_transfer_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), runId, a.creatorId, a.watchSeconds, a.amountCents, transferId, status, now)
      .run();

    out.push({
      creatorId: a.creatorId,
      handle: cp?.handle ?? a.creatorId,
      watchSeconds: a.watchSeconds,
      amountCents: a.amountCents,
      status,
    });
  }

  // When every transfer went out, the run is settled; otherwise it carries
  // pending/failed allocations for a later retry.
  const settled = out.length > 0 && out.every((a) => a.status === 'paid');
  if (settled) {
    await db.prepare('UPDATE blu_royalty_runs SET status = ? WHERE id = ?').bind('paid', runId).run();
  }

  return {
    id: runId,
    periodStart,
    periodEnd,
    poolCents,
    scoutCount,
    totalWatchSeconds: totalWatch,
    status: settled ? 'paid' : 'computed',
    createdAt: now,
    allocations: out,
  };
}
