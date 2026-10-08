import type { Advisory, ContentKind, EpisodeSummary, Genre, TitleSummary } from '@sweam/shared';
import { isReleased } from '@sweam/shared';

/**
 * Shared SELECT fragments and row-to-DTO mappers, so every route returns the
 * same title shape from the same SQL instead of drifting copies.
 */

/** SQLite's current time in nowIso() shape, for release comparisons inside SQL. */
const SQL_NOW_ISO = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const TITLE_SELECT = `
  t.id, t.slug, t.name, t.kind, t.genre, t.audiences AS audiences, t.hero_url AS hero_url,
  t.synopsis, t.advisory, t.poster_url, t.published_at,
  t.is_blu AS is_blu, t.blu_price_cents AS blu_price_cents, t.promoted_by AS promoted_by,
  u.display_name AS creator_name, u.avatar_url AS creator_avatar, u.verified AS creator_verified,
  cp.handle AS creator_handle,
  (SELECT COUNT(*) FROM episodes e WHERE e.title_id = t.id) AS episode_count,
  (SELECT COUNT(*) FROM episodes e WHERE e.title_id = t.id
     AND (e.release_at IS NULL OR e.release_at <= ${SQL_NOW_ISO})) AS released_episode_count,
  (SELECT MIN(e.release_at) FROM episodes e WHERE e.title_id = t.id
     AND e.release_at > ${SQL_NOW_ISO}) AS next_release_at
`;

export const TITLE_FROM = `
  FROM titles t
  JOIN users u ON u.id = t.creator_id
  JOIN creator_profiles cp ON cp.user_id = t.creator_id
`;

export interface TitleRow {
  id: string;
  slug: string;
  name: string;
  kind: ContentKind;
  genre: Genre;
  audiences: string;
  hero_url: string | null;
  synopsis: string;
  advisory: Advisory;
  poster_url: string | null;
  published_at: string | null;
  is_blu: number;
  blu_price_cents: number | null;
  promoted_by: string | null;
  creator_name: string;
  creator_avatar: string | null;
  creator_verified: number | null;
  creator_handle: string;
  episode_count: number;
  released_episode_count: number;
  next_release_at: string | null;
}

export interface TitleStatsRow {
  impressions: number;
  plays: number;
  completes: number;
  likes: number;
}

export function mapTitle(row: TitleRow): TitleSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    genre: row.genre,
    audiences: parseJsonArray(row.audiences),
    heroUrl: row.hero_url,
    synopsis: row.synopsis,
    advisory: row.advisory,
    posterUrl: row.poster_url,
    publishedAt: row.published_at,
    episodeCount: row.episode_count,
    creator: {
      handle: row.creator_handle,
      displayName: row.creator_name,
      avatarUrl: row.creator_avatar,
      verified: row.creator_verified === 1,
    },
    isBlu: row.is_blu === 1,
    bluPriceCents: row.blu_price_cents,
    promotedBy: row.promoted_by,
    releasedEpisodeCount: row.released_episode_count ?? row.episode_count,
    nextReleaseAt: row.next_release_at ?? null,
  };
}

export interface EpisodeRow {
  id: string;
  season: number;
  episode: number;
  name: string;
  synopsis: string;
  video_url: string;
  captions_url: string | null;
  duration_s: number;
  /** Only selected by queries that show credits (the watch page). */
  ai_credits?: string | null;
  /** Scheduled release instant; queries that do not select it treat the episode as released. */
  release_at?: string | null;
  /** Episode cover, when the query selects it. */
  thumbnail_url?: string | null;
  media_type?: 'video' | 'image' | null;
}

/**
 * Map an episode row. Until a scheduled episode releases, viewers get its
 * details but not its playback URLs; `reveal` keeps them for the creator's own
 * Studio and for admins.
 */
export function mapEpisode(row: EpisodeRow, opts: { reveal?: boolean } = {}): EpisodeSummary {
  const releaseAt = row.release_at ?? null;
  const released = isReleased(releaseAt);
  const hide = !released && !opts.reveal;
  return {
    id: row.id,
    season: row.season,
    episode: row.episode,
    name: row.name,
    synopsis: row.synopsis,
    videoUrl: hide ? '' : row.video_url,
    captionsUrl: hide ? null : row.captions_url,
    durationS: row.duration_s,
    ...(row.ai_credits !== undefined ? { aiCredits: row.ai_credits } : {}),
    releaseAt,
    released,
    thumbnailUrl: row.thumbnail_url ?? null,
    mediaType: row.media_type === 'image' ? 'image' : 'video',
  };
}

/** Escape %, _ and \ so user input can be embedded in a LIKE pattern safely. */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Parse a JSON text column into a string array, tolerating null/garbage. */
export function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}
