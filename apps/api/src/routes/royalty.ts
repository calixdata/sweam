import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { parseBody } from '../lib/http';
import { listRoyaltyRuns, previousMonthPeriod, runScoutRoyalty } from '../lib/royalty';
import { requireAdmin } from '../lib/session';
import { royaltyRunSchema } from '../lib/validate';

/**
 * Admin controls for the scout royalty pool. Mounted under /api/admin/blu.
 * A monthly cron runs the previous month automatically (see the Worker's
 * scheduled handler); these let an admin review runs and trigger one on demand.
 */
export const royaltyRoutes = new Hono<AppEnv>();

royaltyRoutes.use('*', requireAdmin);

royaltyRoutes.get('/royalty', async (c) => {
  return c.json({ runs: await listRoyaltyRuns(c.env.DB) });
});

royaltyRoutes.post('/royalty/run', async (c) => {
  const body = await parseBody(c, royaltyRunSchema);
  const period =
    body.periodStart && body.periodEnd
      ? { periodStart: body.periodStart, periodEnd: body.periodEnd }
      : previousMonthPeriod();
  const run = await runScoutRoyalty(c.env.DB, c.env, period.periodStart, period.periodEnd);
  return c.json(run);
});
