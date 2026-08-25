import { Hono } from 'hono';
import type { DiscoverItem } from '@sweam/shared';
import type { AppEnv } from '../env';
import type { TitleRow, TitleStatsRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapTitle } from '../lib/mappers';
import { rankTitles, smoothedFinishRate } from '../lib/ranking';
import { recordImpressions } from './catalog';

export const discoverRoutes = new Hono<AppEnv>();

const FEED_SIZE = 30;

type DiscoverRow = TitleRow & TitleStatsRow;

/**
 * The Discover feed: the whole published catalog ranked by the glass-box
 * scorer. Each item carries the human-readable reason it placed where it did.
 * Serving the feed records one impression per returned title, which is the
 * signal the exploration term uses to retire its own bonus.
 */
discoverRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${TITLE_SELECT},
      COALESCE(s.impressions, 0) AS impressions,
      COALESCE(s.plays, 0) AS plays,
      COALESCE(s.completes, 0) AS completes,
      COALESCE(s.likes, 0) AS likes
    ${TITLE_FROM}
    LEFT JOIN title_stats s ON s.title_id = t.id
    WHERE t.published = 1`,
  ).all<DiscoverRow>();

  const nowMs = Date.now();
  const catalogImpressions = results.reduce((sum, row) => sum + row.impressions, 0);

  const ranked = rankTitles(
    results,
    (row) => ({
      publishedAtMs: row.published_at ? Date.parse(row.published_at) : nowMs,
      impressions: row.impressions,
      plays: row.plays,
      completes: row.completes,
      likes: row.likes,
    }),
    { nowMs, catalogImpressions },
  ).slice(0, FEED_SIZE);

  const items: DiscoverItem[] = ranked.map(({ item, ranked: score }) => ({
    title: mapTitle(item),
    reason: score.reason,
    stats: {
      plays: item.plays,
      finishRate: Number(smoothedFinishRate(item).toFixed(2)),
    },
  }));

  await recordImpressions(c.env.DB, items.map((entry) => entry.title.id));

  return c.json({ items });
});
