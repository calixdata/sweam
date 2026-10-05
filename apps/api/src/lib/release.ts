import { nowIso } from './http';
import { notify } from './notify';

/**
 * Scheduled releases. An episode with `release_at` in the future is listed
 * (cover art, synopsis, date) but not streamable; it unlocks by itself the
 * moment the instant passes, because every read compares `release_at` to now.
 * The only thing that needs a push is the announcement: this runs from the
 * cron every few minutes and notifies, once per episode, everyone who asked for
 * a release-day reminder plus the creator's followers.
 */

interface DueRow {
  id: string;
  title_id: string;
  season: number;
  episode: number;
  name: string;
  title_name: string;
  creator_id: string;
}

const BATCH = 25;

export async function announceReleasedEpisodes(db: D1Database): Promise<number> {
  const now = nowIso();
  const { results } = await db
    .prepare(
      `SELECT e.id, e.title_id, e.season, e.episode, e.name, t.name AS title_name, t.creator_id
       FROM episodes e JOIN titles t ON t.id = e.title_id
       WHERE e.release_at IS NOT NULL AND e.release_at <= ? AND e.release_notified_at IS NULL
         AND t.published = 1 AND t.suppressed = 0
       ORDER BY e.release_at
       LIMIT ${BATCH}`,
    )
    .bind(now)
    .all<DueRow>();

  for (const ep of results) {
    // Claim first so a concurrent run never announces the same episode twice.
    const claimed = await db
      .prepare('UPDATE episodes SET release_notified_at = ? WHERE id = ? AND release_notified_at IS NULL')
      .bind(now, ep.id)
      .run();
    if (claimed.meta.changes === 0) continue;

    const body = `Out now: ${ep.title_name}, S${ep.season} E${ep.episode}, ${ep.name}.`;
    const link = `/watch/${ep.id}`;
    // Reminder subscribers and followers, each person once.
    const { results: people } = await db
      .prepare(
        `SELECT user_id FROM release_reminders WHERE episode_id = ?1
         UNION
         SELECT follower_id AS user_id FROM follows WHERE creator_id = ?2`,
      )
      .bind(ep.id, ep.creator_id)
      .all<{ user_id: string }>();
    for (const person of people) {
      if (person.user_id === ep.creator_id) continue;
      await notify(db, person.user_id, 'release', body, link);
    }
    await db.prepare('DELETE FROM release_reminders WHERE episode_id = ?').bind(ep.id).run();
  }
  return results.length;
}
