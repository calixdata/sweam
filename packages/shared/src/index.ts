/**
 * Types and constants shared between the Sweam API (Cloudflare Worker) and the
 * web app. This package is consumed as TypeScript source by both bundlers, so
 * it must stay dependency-free.
 */

/** The kinds of catalog entries a creator can publish. */
export type ContentKind = 'film' | 'series' | 'short' | 'documentary';

export const CONTENT_KINDS: readonly ContentKind[] = ['film', 'series', 'short', 'documentary'];

export const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  film: 'Film',
  series: 'Series',
  short: 'Short film',
  documentary: 'Documentary',
};

export const GENRES = [
  'Animation',
  'Comedy',
  'Drama',
  'Documentary',
  'Sci-Fi',
  'Horror',
  'Action',
  'Music',
] as const;

export type Genre = (typeof GENRES)[number];

/** Content advisories follow the familiar TV parental guideline labels. */
export const ADVISORIES = ['TV-G', 'TV-PG', 'TV-14', 'TV-MA'] as const;

export type Advisory = (typeof ADVISORIES)[number];

/** The signed-in user attached to a session. `handle` is null until the user creates a creator profile. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  handle: string | null;
}

export interface CreatorRef {
  handle: string;
  displayName: string;
}

/** A catalog card: everything needed to render a title in a rail or grid. */
export interface TitleSummary {
  id: string;
  slug: string;
  name: string;
  kind: ContentKind;
  genre: Genre;
  synopsis: string;
  advisory: Advisory;
  posterUrl: string | null;
  publishedAt: string | null;
  episodeCount: number;
  creator: CreatorRef;
}

export interface EpisodeSummary {
  id: string;
  season: number;
  episode: number;
  name: string;
  synopsis: string;
  videoUrl: string;
  captionsUrl: string | null;
  durationS: number;
}

/** Full title page payload. Viewer-specific fields are false for signed-out requests. */
export interface TitleDetail extends TitleSummary {
  episodes: EpisodeSummary[];
  likes: number;
  likedByMe: boolean;
  inMyWatchlist: boolean;
}

/** One entry in the Discover feed, with the human-readable reason it ranked where it did. */
export interface DiscoverItem {
  title: TitleSummary;
  /** Which ranking component dominated, in plain language (glass-box discovery). */
  reason: string;
  stats: {
    plays: number;
    /** 0..1, Bayesian-smoothed completion rate. */
    finishRate: number;
  };
}

export interface Rail {
  key: string;
  heading: string;
  titles: TitleSummary[];
}

export interface ContinueWatchingItem {
  title: TitleSummary;
  episodeId: string;
  episodeName: string;
  positionS: number;
  durationS: number;
}

export interface HomePayload {
  continueWatching: ContinueWatchingItem[];
  rails: Rail[];
}

/** Payload for the watch page: the episode, its parent title, and where the viewer left off. */
export interface WatchPayload {
  episode: EpisodeSummary;
  title: {
    id: string;
    slug: string;
    name: string;
    kind: ContentKind;
    creator: CreatorRef;
  };
  nextEpisode: { id: string; season: number; episode: number; name: string } | null;
  positionS: number;
}

export interface TitleStats {
  impressions: number;
  plays: number;
  completes: number;
  likes: number;
}

/** A creator's own title as shown in the Studio dashboard (includes drafts). */
export interface StudioTitleSummary {
  id: string;
  slug: string;
  name: string;
  kind: ContentKind;
  genre: Genre;
  published: boolean;
  episodeCount: number;
  stats: TitleStats;
}

export interface StudioTitleDetail extends StudioTitleSummary {
  synopsis: string;
  advisory: Advisory;
  posterUrl: string | null;
  episodes: EpisodeSummary[];
}

/** Every API error responds with this envelope and a machine-readable code. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
