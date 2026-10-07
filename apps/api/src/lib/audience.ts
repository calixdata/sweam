/**
 * Audience filtering for For You and the feed. A viewer may limit the creators
 * they see to women or to men, optionally trusting only the sex marker recorded
 * on a reviewed government ID (verified_sex) rather than the self-declared value.
 *
 * The SQL fragment interpolates only enum-derived literals and a fixed column
 * alias, never user input, so it cannot carry an injection.
 */

export type FeedAudience = 'all' | 'women' | 'men';

export interface AudiencePref {
  audience: FeedAudience;
  verifiedOnly: boolean;
}

export async function loadAudiencePref(db: D1Database, userId: string): Promise<AudiencePref> {
  const row = await db
    .prepare('SELECT feed_audience, feed_audience_verified FROM users WHERE id = ?')
    .bind(userId)
    .first<{ feed_audience: FeedAudience; feed_audience_verified: number }>();
  return {
    audience: row?.feed_audience ?? 'all',
    verifiedOnly: (row?.feed_audience_verified ?? 0) === 1,
  };
}

/**
 * A WHERE fragment (leading " AND ...", or '' for no filter) that keeps only
 * creators whose sex matches the viewer's preference. `creatorAlias` is the
 * creator's users-row alias in the surrounding query (e.g. 'u').
 */
export function audienceSql(pref: AudiencePref, creatorAlias: string): string {
  if (pref.audience === 'all') return '';
  const want = pref.audience === 'women' ? 'female' : 'male';
  const expr = pref.verifiedOnly
    ? `${creatorAlias}.verified_sex = '${want}'`
    : `COALESCE(${creatorAlias}.verified_sex, ${creatorAlias}.sex) = '${want}'`;
  return ` AND ${expr}`;
}
