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

export type ScoutStatus = 'pending' | 'approved' | 'rejected';

/**
 * The signed-in user attached to a session. `handle` is null until the user
 * creates a creator profile; `scout` is null until they apply for scout access.
 */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  handle: string | null;
  scout: { status: ScoutStatus; orgName: string } | null;
  isAdmin: boolean;
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

// ---------------------------------------------------------------------------
// Media pipeline
// ---------------------------------------------------------------------------

export type TranscodeStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

/**
 * A creator's episode as shown in the Studio: the public fields plus the
 * original upload, generated thumbnail, and the latest transcode job state
 * (null when the episode uses an external source with no pipeline run).
 */
export interface StudioEpisode extends EpisodeSummary {
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  transcode: { status: TranscodeStatus; error: string | null; updatedAt: string } | null;
}

/** A claimed transcode job, as handed to a transcoder worker. */
export interface TranscodeJobClaim {
  id: string;
  episodeId: string;
  sourceUrl: string;
  attempts: number;
}

export interface MultipartInit {
  key: string;
  uploadId: string;
  partSize: number;
}

export interface MultipartPart {
  partNumber: number;
  etag: string;
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
  /** Creator opt-in: whether this title is visible in the scout portal. */
  scoutable: boolean;
  episodes: StudioEpisode[];
}

// ---------------------------------------------------------------------------
// Scout portal
// ---------------------------------------------------------------------------

/** One day of counters for a title (day is a UTC YYYY-MM-DD string). */
export interface DailyPoint {
  day: string;
  impressions: number;
  plays: number;
  completes: number;
  likes: number;
}

/**
 * Audience retention for one episode: `curve[i]` is the fraction of tracked
 * viewers whose furthest position reached checkpoint i/10 of the runtime
 * (11 points, 0% through 100%). Empty when no viewer has been tracked.
 */
export interface EpisodeRetention {
  episodeId: string;
  season: number;
  episode: number;
  name: string;
  viewers: number;
  curve: number[];
}

export interface FinishLeader {
  title: TitleSummary;
  plays: number;
  finishRate: number;
}

export interface GrowthLeader {
  title: TitleSummary;
  recentPlays: number;
  priorPlays: number;
  /** Smoothed week-over-week ratio; above 1 is growth. */
  growth: number;
}

export interface GenreBreakout {
  genre: Genre;
  title: TitleSummary;
  recentPlays: number;
  growth: number;
}

export interface ScoutLeaderboards {
  finishLeaders: FinishLeader[];
  fastestGrowing: GrowthLeader[];
  genreBreakouts: GenreBreakout[];
}

/** The per-title brief a scout sees. Viewing one is logged and shown to the creator. */
export interface OneSheet {
  title: TitleSummary;
  creatorBio: string;
  creatorVerified: boolean;
  stats: TitleStats & { watchSeconds: number };
  daily: DailyPoint[];
  retention: EpisodeRetention[];
  myInterest: boolean;
}

export interface OneSheetView {
  orgName: string;
  viewedAt: string;
}

/** A scout's expressed interest, as shown to the creator (the scout volunteered the contact details). */
export interface ScoutInterestForCreator {
  orgName: string;
  orgUrl: string | null;
  contactEmail: string;
  note: string;
  createdAt: string;
}

/** Creator-side analytics for one title: the same data scouts see, plus who looked. */
export interface TitleAnalytics {
  scoutable: boolean;
  daily: DailyPoint[];
  retention: EpisodeRetention[];
  oneSheetViews: OneSheetView[];
  interests: ScoutInterestForCreator[];
}

// ---------------------------------------------------------------------------
// Trust, safety, and administration
// ---------------------------------------------------------------------------

export const REPORT_REASONS = ['spam', 'abuse', 'copyright', 'other'] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam or misleading',
  abuse: 'Abusive or harmful',
  copyright: 'Copyright infringement',
  other: 'Something else',
};

export type TakedownKind = 'dmca' | 'guidelines';

export type NotificationKind =
  | 'scout_view'
  | 'scout_interest'
  | 'scout_decision'
  | 'takedown'
  | 'takedown_released'
  | 'strike';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  body: string;
  /** App-relative path to open, when the notification has a destination. */
  link: string | null;
  read: boolean;
  createdAt: string;
}

/** A creator's account standing, shown in their Studio. */
export interface StudioStanding {
  activeStrikes: number;
  /** Three or more active strikes suspends publishing and uploads. */
  suspended: boolean;
  takedowns: { titleName: string; kind: TakedownKind; createdAt: string }[];
}

export interface AdminOverview {
  users: number;
  creators: number;
  approvedScouts: number;
  pendingScoutApplications: number;
  publishedTitles: number;
  draftTitles: number;
  openReports: number;
  activeTakedowns: number;
  transcode: { queued: number; running: number; failed: number };
  totalPlays: number;
  totalWatchHours: number;
}

export interface AdminScoutApplication {
  userId: string;
  displayName: string;
  email: string;
  orgName: string;
  orgUrl: string | null;
  contactEmail: string;
  createdAt: string;
}

export interface AdminReport {
  id: string;
  reason: ReportReason;
  note: string;
  createdAt: string;
  title: { id: string; name: string; slug: string; published: boolean };
  creator: { userId: string; handle: string; displayName: string; activeStrikes: number };
  reporter: { displayName: string };
}

export interface AdminTakedown {
  id: string;
  kind: TakedownKind;
  reason: string;
  createdAt: string;
  releasedAt: string | null;
  title: { id: string; name: string; slug: string };
  creatorHandle: string;
}

export interface AdminStrike {
  id: string;
  reason: string;
  createdAt: string;
  creator: { handle: string; displayName: string };
}

export interface AdminTranscodeJob {
  id: string;
  status: TranscodeStatus;
  attempts: number;
  error: string | null;
  updatedAt: string;
  episodeName: string;
  titleName: string;
}

/** Every API error responds with this envelope and a machine-readable code. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
