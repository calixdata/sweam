/**
 * The subset of the Sweam API's shapes the app uses. Kept local (the app is a
 * standalone Expo project) but intentionally matches packages/shared.
 */

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  username: string | null;
  handle: string | null;
  isAdmin: boolean;
}

export interface CreatorRef {
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  /** Identity-verified account (pink check). */
  verified?: boolean;
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
  isBlu: boolean;
  /** Company name when a scout promotion deal is active, else null. */
  promotedBy: string | null;
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
  /** Episodes already unlocked for streaming (older payloads omit it). */
  releasedEpisodeCount?: number;
  /** The next scheduled release still in the future (ISO), or null. */
  nextReleaseAt?: string | null;
  creator: CreatorRef;
  isBlu: boolean;
  bluPriceCents: number | null;
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
  /** Empty until a scheduled episode releases. */
  videoUrl: string;
  captionsUrl: string | null;
  durationS: number;
  /** Scheduled release instant (ISO), or null when released on publish. */
  releaseAt?: string | null;
  /** False while a scheduled episode is still locked. */
  released?: boolean;
  /** Signed-in only: a release-day reminder is set. */
  reminderSet?: boolean;
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
  bluAccess: boolean;
}

/** A creator's own title in the "Your content" screen (includes drafts). */
export interface StudioTitleSummary {
  id: string;
  slug: string;
  name: string;
  kind: string;
  published: boolean;
  episodeCount: number;
  /** Currently Sweam Blu (paid). */
  isBlu: boolean;
  /** Has ever been Blu (even if free now); gates whether it can be hard-deleted. */
  everBlu: boolean;
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

export interface CreatorPublicPage {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  verified: boolean;
  /** True when the account has a creator profile; every account has a profile page. */
  isCreator?: boolean;
  followerCount: number;
  followedByMe: boolean;
  titles: TitleSummary[];
}

/** An account found by search: any Sweam account, creator or not. */
export interface AccountSearchResult {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isCreator: boolean;
  verified: boolean;
  followerCount: number;
  publishedTitles: number;
}

/** Search results: matching accounts first, then matching titles. */
export interface SearchResults {
  query: string;
  accounts: AccountSearchResult[];
  results: TitleSummary[];
}

export interface NotificationItem {
  id: string;
  kind: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface BluFundEligibilitySummary {
  eligible: boolean;
  followers: { actual: number; required: number; met: boolean };
  views: { actual: number; required: number; met: boolean };
  noRecentViolations: { met: boolean; violations: number; windowDays: number };
  ageVerified: boolean;
}

/** GET /api/studio/blu-fund — the Blu-offer gate + the creator's upload default. */
export interface BluFundStatus {
  canOfferBlu: boolean;
  platformOpen: boolean;
  adminBypass: boolean;
  contentDefault: 'free' | 'blu';
  eligibility: BluFundEligibilitySummary;
}

export interface SeriesSummary {
  id: string;
  name: string;
}
