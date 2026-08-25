import type { MonetizationEligibility } from '@sweam/shared';
import { evaluateMonetizationEligibility } from '@sweam/shared';
import { activeStrikeCount, SUSPENSION_STRIKES } from './standing';

/**
 * Live monetization eligibility for a creator, evaluated against the
 * published thresholds in the shared package (docs/CREATOR-PROGRAM.md is the
 * human-readable contract). Called at every ad serve, so the share starts
 * accruing the moment a creator qualifies and pauses while suspended.
 */
export async function getCreatorEligibility(
  db: D1Database,
  creatorId: string,
): Promise<MonetizationEligibility> {
  const [followersRow, watchRow, publishedRow, strikes] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) AS n FROM follows WHERE creator_id = ?')
      .bind(creatorId)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(s.watch_seconds), 0) AS n
         FROM title_stats s JOIN titles t ON t.id = s.title_id
         WHERE t.creator_id = ? AND t.published = 1`,
      )
      .bind(creatorId)
      .first<{ n: number }>(),
    db
      .prepare('SELECT COUNT(*) AS n FROM titles WHERE creator_id = ? AND published = 1')
      .bind(creatorId)
      .first<{ n: number }>(),
    activeStrikeCount(db, creatorId),
  ]);

  return evaluateMonetizationEligibility({
    followers: followersRow?.n ?? 0,
    watchSeconds: watchRow?.n ?? 0,
    publishedTitles: publishedRow?.n ?? 0,
    suspended: strikes >= SUSPENSION_STRIKES,
  });
}
