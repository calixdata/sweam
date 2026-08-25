import type { Advisory, ContentKind, EpisodeSummary, Genre, TitleSummary } from '@sweam/shared';

/**
 * Shared SELECT fragments and row-to-DTO mappers, so every route returns the
 * same title shape from the same SQL instead of drifting copies.
 */

export const TITLE_SELECT = `
  t.id, t.slug, t.name, t.kind, t.genre, t.synopsis, t.advisory, t.poster_url, t.published_at,
  u.display_name AS creator_name, cp.handle AS creator_handle,
  (SELECT COUNT(*) FROM episodes e WHERE e.title_id = t.id) AS episode_count
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
  synopsis: string;
  advisory: Advisory;
  poster_url: string | null;
  published_at: string | null;
  creator_name: string;
  creator_handle: string;
  episode_count: number;
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
    synopsis: row.synopsis,
    advisory: row.advisory,
    posterUrl: row.poster_url,
    publishedAt: row.published_at,
    episodeCount: row.episode_count,
    creator: { handle: row.creator_handle, displayName: row.creator_name },
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
}

export function mapEpisode(row: EpisodeRow): EpisodeSummary {
  return {
    id: row.id,
    season: row.season,
    episode: row.episode,
    name: row.name,
    synopsis: row.synopsis,
    videoUrl: row.video_url,
    captionsUrl: row.captions_url,
    durationS: row.duration_s,
  };
}

/** Escape %, _ and \ so user input can be embedded in a LIKE pattern safely. */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
