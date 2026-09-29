/**
 * The subset of the Sweam API's shapes the app uses. Kept local (the app is a
 * standalone Expo project) but intentionally matches packages/shared.
 */

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  username: string | null;
  handle: string | null;
  isAdmin: boolean;
}

export interface CreatorRef {
  handle: string;
  displayName: string;
}

export interface FeedItem {
  titleId: string;
  slug: string;
  name: string;
  kind: string;
  synopsis: string;
  creator: CreatorRef;
  episodeId: string;
  videoUrl: string;
  posterUrl: string | null;
  views: number;
  likes: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface TitleSummary {
  id: string;
  slug: string;
  name: string;
  kind: string;
  genre: string;
  audiences: string[];
  heroUrl: string | null;
  synopsis: string;
  advisory: string;
  posterUrl: string | null;
  publishedAt: string | null;
  episodeCount: number;
  creator: CreatorRef;
}

export interface Rail {
  key: string;
  heading: string;
  titles: TitleSummary[];
}

export interface HomePayload {
  continueWatching: unknown[];
  rails: Rail[];
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

export interface TitleDetail extends TitleSummary {
  episodes: EpisodeSummary[];
  views: number;
  likes: number;
  commentCount: number;
  likedByMe: boolean;
  inMyWatchlist: boolean;
  genres: string[];
  subgenres: string[];
}

export interface CommentItem {
  id: string;
  body: string;
  status: string;
  createdAt: string;
  author: { displayName: string; handle: string | null };
  authorIsCreator: boolean;
  mine: boolean;
  likes: number;
  likedByMe: boolean;
  replies: CommentItem[];
}

export interface WatchPayload {
  episode: EpisodeSummary;
  title: { id: string; slug: string; name: string; kind: string; creator: CreatorRef };
  nextEpisode: { id: string; season: number; episode: number; name: string } | null;
  positionS: number;
}
