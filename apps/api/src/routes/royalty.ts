import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { listFundRuns, runBluFund } from '../lib/fund';
import { parseBody } from '../lib/http';
import { listRoyaltyRuns, previousMonthPeriod, runScoutRoyalty } from '../lib/royalty';
import { requireAdmin } from '../lib/session';
import { royaltyRunSchema } from '../lib/validate';

/**
 * Admin controls for the Blu Fund (ad-revenue creator payouts) and the scout
 * royalty pool. Mounted under /api/admin/blu. A monthly cron runs the previous
 * month automatically (see the Worker's scheduled handler); these let an admin
 * review runs and trigger one on demand.
 */
export const royaltyRoutes = new Hono<AppEnv>();

royaltyRoutes.use('*', requireAdmin);

function periodFor(body: { periodStart?: string; periodEnd?: string }) {
  return body.periodStart && body.periodEnd
    ? { periodStart: body.periodStart, periodEnd: body.periodEnd }
    : previousMonthPeriod();
}

royaltyRoutes.get('/fund', async (c) => {
  return c.json({ runs: await listFundRuns(c.env.DB) });
});

royaltyRoutes.post('/fund/run', async (c) => {
  const { periodStart, periodEnd } = periodFor(await parseBody(c, royaltyRunSchema));
  return c.json(await runBluFund(c.env.DB, c.env, periodStart, periodEnd));
});

royaltyRoutes.get('/royalty', async (c) => {
  return c.json({ runs: await listRoyaltyRuns(c.env.DB) });
});

royaltyRoutes.post('/royalty/run', async (c) => {
  const { periodStart, periodEnd } = periodFor(await parseBody(c, royaltyRunSchema));
  return c.json(await runScoutRoyalty(c.env.DB, c.env, periodStart, periodEnd));
});
