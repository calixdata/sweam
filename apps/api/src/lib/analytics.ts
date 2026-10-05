import type { DailyPoint, EpisodeRetention, EpisodeViews } from '@sweam/shared';
import { buildRetentionCurve } from './momentum';

/**
 * Loaders shared by the scout one-sheet and the creator's own analytics view.
 * Both audiences see the same numbers on purpose: a scout should never know
 * more about a title than its creator does.
 */

export async function loadDailySeries(
  db: D1Database,
  titleId: string,
  days: number,
): Promise<DailyPoint[]> {
  const { results } = await db
    .prepare(
      `SELECT day, impressions, plays, completes, likes
       FROM title_stats_daily
       WHERE title_id = ? AND day >= date('now', ?)
       ORDER BY day`,
    )
    .bind(titleId, `-${days - 1} days`)
    .all<DailyPoint>();
  return results;
}

interface EpisodeRow {
  id: string;
  season: number;
  episode: number;
  name: string;
}

interface ProgressRow {
  episode_id: string;
  max_position_s: number;
  duration_s: number;
}

/**
 * Retention per episode, computed from tracked viewing sessions' furthest
 * positions: signed-in progress rows and anonymous view sessions alike.
 * Aggregating raw rows on demand is fine at current scale; the at-scale path
 * (rollups per episode) is noted in ARCHITECTURE.md.
 */
export async function loadRetention(db: D1Database, titleId: string): Promise<EpisodeRetention[]> {
  const { results: episodes } = await db
    .prepare('SELECT id, season, episode, name FROM episodes WHERE title_id = ? ORDER BY season, episode')
    .bind(titleId)
    .all<EpisodeRow>();
  if (episodes.length === 0) return [];

  const placeholders = episodes.map(() => '?').join(', ');
  const { results: rows } = await db
    .prepare(
      `SELECT episode_id, max_position_s, duration_s
       FROM progress WHERE episode_id IN (${placeholders})
       UNION ALL
       SELECT episode_id, max_position_s, duration_s
       FROM anonymous_views WHERE episode_id IN (${placeholders})`,
    )
    .bind(...episodes.map((e) => e.id), ...episodes.map((e) => e.id))
    .all<ProgressRow>();

  const byEpisode = new Map<string, { maxPositionS: number; durationS: number }[]>();
  for (const row of rows) {
    if (row.duration_s <= 0) continue;
    const list = byEpisode.get(row.episode_id) ?? [];
    list.push({ maxPositionS: row.max_position_s, durationS: row.duration_s });
    byEpisode.set(row.episode_id, list);
  }

  return episodes.map((episode) => {
    const viewers = byEpisode.get(episode.id) ?? [];
    return {
      episodeId: episode.id,
      season: episode.season,
      episode: episode.episode,
      name: episode.name,
      viewers: viewers.length,
      curve: buildRetentionCurve(viewers),
    };
  });
}

interface EpisodeViewsRow {
  id: string;
  title_id: string;
  season: number;
  episode: number;
  name: string;
  views: number;
  finishes: number;
}

/**
 * Views per episode for the given titles, keyed by title id. A view is a
 * tracked viewing session that started the episode (signed-in progress rows
 * and anonymous view sessions alike, the same events that count as plays); a
 * finish is one that reached the completion threshold.
 */
export async function loadEpisodeViews(
  db: D1Database,
  titleIds: string[],
): Promise<Map<string, EpisodeViews[]>> {
  const byTitle = new Map<string, EpisodeViews[]>();
  if (titleIds.length === 0) return byTitle;
  const placeholders = titleIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT e.id, e.title_id, e.season, e.episode, e.name,
         (SELECT COUNT(*) FROM progress p WHERE p.episode_id = e.id)
           + (SELECT COUNT(*) FROM anonymous_views a WHERE a.episode_id = e.id) AS views,
         (SELECT COALESCE(SUM(p.completed), 0) FROM progress p WHERE p.episode_id = e.id)
           + (SELECT COALESCE(SUM(a.completed), 0) FROM anonymous_views a WHERE a.episode_id = e.id) AS finishes
       FROM episodes e
       WHERE e.title_id IN (${placeholders})
       ORDER BY e.title_id, e.season, e.episode`,
    )
    .bind(...titleIds)
    .all<EpisodeViewsRow>();
  for (const row of results) {
    const list = byTitle.get(row.title_id) ?? [];
    list.push({
      episodeId: row.id,
      season: row.season,
      episode: row.episode,
      name: row.name,
      views: row.views,
      finishes: row.finishes,
    });
    byTitle.set(row.title_id, list);
  }
  return byTitle;
}
