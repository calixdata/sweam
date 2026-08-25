import { Hono } from 'hono';
import type { PrerollAd } from '@sweam/shared';
import { creatorShareMillicents, impressionRevenueMillicents } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import { getCreatorEligibility } from '../lib/monetize';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '../lib/ratelimit';
import { adImpressionSchema } from '../lib/validate';

/**
 * AVOD serving. The decision endpoint hands the player an ad for a pre-roll
 * slot; the impression endpoint records the serve and freezes its revenue
 * split into the ledger at that moment's CPM and share, so later pricing
 * changes never rewrite history. Frequency capping (one pre-roll per title
 * per session) lives client-side and is documented in ARCHITECTURE.md.
 */
export const adRoutes = new Hono<AppEnv>();

interface AdRow {
  id: string;
  sponsor: string;
  headline: string;
  media_url: string;
  click_url: string;
  duration_s: number;
  cpm_cents: number;
}

adRoutes.get('/preroll', async (c) => {
  const titleId = c.req.query('titleId') ?? '';
  if (!titleId) return c.json({ ad: null });
  const title = await c.env.DB.prepare('SELECT 1 AS x FROM titles WHERE id = ? AND published = 1')
    .bind(titleId)
    .first();
  if (!title) return c.json({ ad: null });

  const row = await c.env.DB.prepare(
    'SELECT id, sponsor, headline, media_url, click_url, duration_s, cpm_cents FROM ads WHERE active = 1 ORDER BY RANDOM() LIMIT 1',
  ).first<AdRow>();
  if (!row) return c.json({ ad: null });

  const ad: PrerollAd = {
    id: row.id,
    sponsor: row.sponsor,
    headline: row.headline,
    mediaUrl: row.media_url,
    clickUrl: row.click_url,
    durationS: row.duration_s,
  };
  return c.json({ ad });
});

adRoutes.post('/:adId/impression', async (c) => {
  const user = c.get('user');
  await enforceRateLimit(c.env.DB, RATE_LIMITS.adImpression, user?.id ?? clientIp(c.req.raw));
  const body = await parseBody(c, adImpressionSchema);

  const ad = await c.env.DB.prepare('SELECT id, cpm_cents FROM ads WHERE id = ? AND active = 1')
    .bind(c.req.param('adId'))
    .first<{ id: string; cpm_cents: number }>();
  if (!ad) fail(404, 'ad_not_found', 'No such active ad.');

  const title = await c.env.DB.prepare(
    'SELECT id, creator_id FROM titles WHERE id = ? AND published = 1',
  )
    .bind(body.titleId)
    .first<{ id: string; creator_id: string }>();
  if (!title) fail(404, 'title_not_found', 'No such published title.');

  // The creator share accrues only while the creator meets the published
  // monetization thresholds and is in good standing; the platform records the
  // gross either way (ads run on non-monetized content, as on YouTube).
  const eligibility = await getCreatorEligibility(c.env.DB, title.creator_id);

  await c.env.DB.prepare(
    `INSERT INTO ad_impressions (id, ad_id, title_id, creator_id, viewer, revenue_millicents, creator_millicents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      ad.id,
      title.id,
      title.creator_id,
      user ? 'user' : 'anon',
      impressionRevenueMillicents(ad.cpm_cents),
      eligibility.eligible ? creatorShareMillicents(ad.cpm_cents) : 0,
      nowIso(),
    )
    .run();
  return c.json({ ok: true }, 201);
});
