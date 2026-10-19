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
  /** 'image' for a still photo post; shown as a picture instead of a player. */
  mediaType?: 'video' | 'image';
  /** Set when the feed plays a series' episode released in the last week. */
  newEpisode?: { season: number; episode: number; name: string } | null;
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
  /** 'image' for a still photo post. */
  mediaType?: 'video' | 'image';
  /** Where the sound came from: the recording, a library track, silence, or an upload. */
  audioSource?: 'original' | 'library' | 'none' | 'upload';
  /** True when Sweam muted the sound (unlicensed music in an upload). */
  audioMuted?: boolean;
  /** The Sweam library track under the picture, when audioSource is 'library'. */
  musicTrack?: { id: string; title: string; composer: string } | null;
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
  author: { displayName: string; handle: string | null; avatarUrl?: string | null };
  authorIsCreator: boolean;
  mine: boolean;
  likes: number;
  likedByMe: boolean;
  replies: CommentItem[];
}

export interface WatchPayload {
  episode: EpisodeSummary;
  title: { id: string; slug: string; name: string; kind: string; creator: CreatorRef; views: number; likes: number };
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
  /** True when the signed-in viewer has blocked this account. */
  blockedByMe?: boolean;
  titles: TitleSummary[];
}

/** A viewer's For You / feed audience filter. */
export interface AudienceSettings {
  sex: 'female' | 'male' | 'nonbinary' | 'undisclosed';
  verifiedSex: 'female' | 'male' | null;
  feedAudience: 'all' | 'women' | 'men';
  verifiedOnly: boolean;
}

/** An account the signed-in user has blocked. */
export interface BlockedAccount {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  blockedAt: string;
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

// ---------------------------------------------------------------------------
// UCast: the recasting room, built as polls. Mirrors the Ucast* shapes and
// UCAST_* constants in packages/shared/src/index.ts.
// ---------------------------------------------------------------------------

export const UCAST_NAME = 'UCast';
export const UCAST_HANDLE = 'ucast';

export const UCAST_WORK_KINDS = ['film', 'tv', 'song', 'musical', 'music_video'] as const;
export type UcastWorkKind = (typeof UCAST_WORK_KINDS)[number];
export const UCAST_WORK_KIND_LABELS: Record<UcastWorkKind, string> = {
  film: 'Film',
  tv: 'TV series',
  song: 'Song',
  musical: 'Musical',
  music_video: 'Music video',
};

/** Roles per poll: enough for an ensemble, a brake on list spam. */
export const UCAST_MAX_ROLES = 12;
/** A work must be older than this many years to be polled (it is a room for classics). */
export const UCAST_MIN_WORK_AGE_YEARS = 5;
/** Results are posted no later than this many hours after a poll closes. */
export const UCAST_RESULTS_WITHIN_HOURS = 48;

export type UcastPhase = 'pending' | 'rejected' | 'scheduled' | 'open' | 'closed' | 'results';
export const UCAST_PHASE_LABELS: Record<UcastPhase, string> = {
  pending: 'Awaiting review',
  rejected: 'Not opened',
  scheduled: 'Opens soon',
  open: 'Open for casting',
  closed: 'Closed, results coming',
  results: 'Results posted',
};

export interface UcastRole {
  id: string;
  name: string;
  originalPerformer: string;
}

export interface UcastAuthor {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  official: boolean;
}

export interface UcastPollSummary {
  id: string;
  slug: string;
  kind: UcastWorkKind;
  title: string;
  year: number;
  hook: string;
  coverUrl: string | null;
  phase: UcastPhase;
  official: boolean;
  opensAt: string | null;
  closesAt: string | null;
  resultsDueAt: string | null;
  roleCount: number;
  ballotCount: number;
  createdAt: string;
}

export interface UcastPick {
  id: string;
  roleId: string;
  pick: string;
  note: string;
  votes: number;
  votedByMe: boolean;
}

export interface UcastBallot {
  id: string;
  note: string;
  author: UcastAuthor;
  picks: UcastPick[];
  votes: number;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UcastStanding {
  pick: string;
  ballots: number;
  votes: number;
  /** 0..1 */
  share: number;
}

export interface UcastRoleResult {
  role: UcastRole;
  ballots: number;
  standings: UcastStanding[];
}

export interface UcastPollPage {
  poll: UcastPollSummary;
  roles: UcastRole[];
  results: UcastRoleResult[];
  resultsNote: string;
  ballots: UcastBallot[];
  myBallot: UcastBallot | null;
  adminNote: string;
}

export interface UcastBoard {
  open: UcastPollSummary[];
  closingSoon: UcastPollSummary[];
  awaitingResults: UcastPollSummary[];
  results: UcastPollSummary[];
  scheduled: UcastPollSummary[];
}

export interface UcastDuplicateCandidate {
  slug: string;
  title: string;
  year: number;
  kind: UcastWorkKind;
  phase: UcastPhase;
  reason: string;
  confidence: number;
}

/** Body of PUT /api/ucast/polls/:slug/ballot. */
export interface UcastBallotInput {
  note: string;
  picks: { roleId: string; pick: string; note: string }[];
}

/** Body of POST /api/ucast/requests. */
export interface UcastRequestInput {
  kind: UcastWorkKind;
  title: string;
  year: number;
  hook: string;
  note: string;
  roles: { name: string; originalPerformer: string }[];
  confirmDifferent: boolean;
}

/** One track in the licensed music library (public-domain recording, at most 60 seconds). */
export interface MusicTrack {
  id: string;
  title: string;
  composer: string;
  performer: string;
  url: string;
  durationS: number;
  mood: string;
  license: 'public-domain';
  licenseNote: string;
  sourceUrl: string;
}
