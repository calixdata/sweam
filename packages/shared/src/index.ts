/**
 * Types and constants shared between the Sweam API (Cloudflare Worker) and the
 * web app. This package is consumed as TypeScript source by both bundlers, so
 * it must stay dependency-free.
 */

export * from './money';

import type { MonetizationEligibility } from './money';

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
  'Action',
  'Adventure',
  'Animation',
  'Anime',
  'Biography',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Experimental',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Music',
  'Musical',
  'Mystery',
  'Reality',
  'Romance',
  'Sci-Fi',
  'Sport',
  'Superhero',
  'Thriller',
  'War',
  'Western',
] as const;

export type Genre = (typeof GENRES)[number];

/** Content advisories follow the familiar TV parental guideline labels. */
export const ADVISORIES = ['TV-G', 'TV-PG', 'TV-14', 'TV-MA'] as const;

export type Advisory = (typeof ADVISORIES)[number];

/**
 * Viewer ratings collected on every submission. Explicit or pornographic
 * material is forbidden regardless of rating (see the Community Guidelines);
 * this rating only communicates maturity within what is allowed.
 */
export const RATINGS = ['G', 'PG', 'PG-13', 'R', 'NC-17'] as const;

export type Rating = (typeof RATINGS)[number];

/** Maps a submission rating to the catalog advisory used on live titles. */
export const RATING_TO_ADVISORY: Record<Rating, Advisory> = {
  G: 'TV-G',
  PG: 'TV-PG',
  'PG-13': 'TV-14',
  R: 'TV-MA',
  'NC-17': 'TV-MA',
};

// ---------------------------------------------------------------------------
// Sweam Blu: the subscriber-only paid-content tier.
// ---------------------------------------------------------------------------

/**
 * Creators do not set free-form prices. They choose one monthly price from a
 * fixed preset ladder (structured like Amazon KDP's royalty/price options).
 * Sweam takes a flat 20% of Blu revenue; the creator keeps 80%. All Blu sales
 * are final and non-refundable.
 */
export const BLU_CREATOR_SHARE = 0.8;
export const BLU_PLATFORM_SHARE = 0.2;

export interface BluTier {
  id: string;
  label: string;
  priceCents: number;
}

/** The only monthly prices a creator may pick for Blu (choose exactly one). */
export const BLU_TIERS: readonly BluTier[] = [
  { id: 'blu_299', label: '$2.99 / month', priceCents: 299 },
  { id: 'blu_499', label: '$4.99 / month', priceCents: 499 },
  { id: 'blu_699', label: '$6.99 / month', priceCents: 699 },
  { id: 'blu_999', label: '$9.99 / month', priceCents: 999 },
  { id: 'blu_1499', label: '$14.99 / month', priceCents: 1499 },
  { id: 'blu_1999', label: '$19.99 / month', priceCents: 1999 },
  { id: 'blu_2499', label: '$24.99 / month', priceCents: 2499 },
  { id: 'blu_3999', label: '$39.99 / month', priceCents: 3999 },
  { id: 'blu_4999', label: '$49.99 / month', priceCents: 4999 },
] as const;

export function bluTierById(id: string): BluTier | undefined {
  return BLU_TIERS.find((t) => t.id === id);
}

export function bluTierByCents(cents: number | null): BluTier | undefined {
  return cents == null ? undefined : BLU_TIERS.find((t) => t.priceCents === cents);
}

/** A creator may flip a title between Free and Blu at most once per this window. */
export const BLU_SWITCH_COOLDOWN_DAYS = 30;

/** Scout All-Access: one monthly fee for all Blu content, no per-creator subscriptions. */
export const SCOUT_ALL_ACCESS_CENTS = 9900;

/** Accessible label for the Blu badge image. */
export const BLU_BADGE_LABEL = 'Sweam Blu paid content';

/** Format a cents amount as a USD price string. */
export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Minimum age to hold a Sweam account. Referenced in copy and enforced at sign-up. */
export const MIN_AGE = 16;

/**
 * Audience tier is orthogonal to genre: who the work is for, not what it is.
 * Sweam does not accept content made for children under 13, so there is no
 * "Kids" tier. A title may carry more than one (e.g. Young Adult + Adult).
 */
export const AUDIENCES = ['Young Adult', 'Adult'] as const;

export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<Audience, string> = {
  'Young Adult': 'Young Adult (16+)',
  Adult: 'Adult (18+)',
};

/**
 * Sub-genres refine a genre and can be combined. This list is meant to grow:
 * add entries here and they appear in the pickers with no other change. A title
 * can carry several, across genres (e.g. "Romantic Suspense" + "Coming of Age").
 */
export const SUBGENRES = [
  'Romantic Suspense',
  'Romantic Comedy',
  'Dark Comedy',
  'Coming of Age',
  'Psychological Thriller',
  'Supernatural',
  'Dystopian',
  'Space Opera',
  'Cyberpunk',
  'Slasher',
  'Mockumentary',
  'Anthology',
  'Period Piece',
  'Legal Drama',
  'Crime Procedural',
  'Sports Drama',
  'Musical Drama',
  'Satire',
  'Noir',
  'Whodunit',
] as const;

export type SubGenre = (typeof SUBGENRES)[number];

/** Public @username rules, shared so the client and server never disagree. */
export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
export const USERNAME_HINT = '3–24 characters: lowercase letters, numbers, and underscores.';

/**
 * File requirements, stated plainly on the upload forms and enforced on upload.
 * One source of truth so the copy and the checks never disagree.
 */
export const UPLOAD_SPECS = {
  video: {
    formats: 'MP4 or WebM',
    accept: 'video/mp4,video/webm',
    maxBytes: 512 * 1024 * 1024,
    maxLabel: '512 MB',
  },
  poster: {
    formats: 'JPEG, PNG, or WebP',
    accept: 'image/jpeg,image/png,image/webp',
    maxBytes: 10 * 1024 * 1024,
    maxLabel: '10 MB',
    minWidth: 1000,
    minHeight: 1500,
    aspect: '2:3 portrait (e.g. 1000 x 1500)',
  },
  captions: {
    formats: 'WebVTT (.vtt)',
    accept: 'text/vtt,.vtt',
    maxBytes: 2 * 1024 * 1024,
    maxLabel: '2 MB',
  },
} as const;

export type ScoutStatus = 'pending' | 'approved' | 'rejected';

/**
 * The signed-in user attached to a session. `handle` is null until the user
 * creates a creator profile; `scout` is null until they apply for scout access.
 */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  /** The account's unique public @username (chosen at sign-up). */
  username: string | null;
  /** The creator handle, present only for creators; equals the username. */
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
  /** Audience tiers this title targets (for the hero/meta line). */
  audiences: string[];
  /** Optional landscape hero image (the poster is 2:3 portrait). */
  heroUrl: string | null;
  synopsis: string;
  advisory: Advisory;
  posterUrl: string | null;
  publishedAt: string | null;
  episodeCount: number;
  creator: CreatorRef;
  /** Sweam Blu: true when this title is subscriber-only paid content. */
  isBlu: boolean;
  /** Monthly Blu price in cents (one of the preset tiers), or null when free. */
  bluPriceCents: number | null;
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
  /** Signed credits from Verbatiim (who wrote the words, which engines made it), when it made the episode. */
  aiCredits?: string | null;
}

/** Full title page payload. Viewer-specific fields are false for signed-out requests. */
export interface TitleDetail extends TitleSummary {
  episodes: EpisodeSummary[];
  /** Total plays across episodes (shown to viewers, TikTok-style). */
  views: number;
  likes: number;
  /** Count of visible comments. */
  commentCount: number;
  likedByMe: boolean;
  inMyWatchlist: boolean;
  /** Audience tiers this title targets (may be several). */
  audiences: string[];
  /** Every genre chosen (the card's `genre` is the primary one). */
  genres: Genre[];
  /** Sub-genre refinements chosen. */
  subgenres: string[];
  /**
   * Whether the viewer may watch this title. Always true for Free titles; for
   * Blu it requires an active subscription, scout all-access, or being the creator.
   */
  bluAccess: boolean;
}

/** One active Blu subscription, for the viewer's manage-subscriptions screen. */
export interface BluSubscriptionSummary {
  creatorId: string;
  handle: string;
  displayName: string;
  priceCents: number;
  currentPeriodEnd: string | null;
}

/**
 * One playable entry in the mobile vertical feed: a title's first episode with
 * everything needed to autoplay it and show engagement, in one payload.
 */
export interface FeedItem {
  titleId: string;
  slug: string;
  name: string;
  kind: ContentKind;
  synopsis: string;
  creator: CreatorRef;
  episodeId: string;
  videoUrl: string;
  posterUrl: string | null;
  views: number;
  likes: number;
  commentCount: number;
  likedByMe: boolean;
  /** Sweam Blu: true when subscriber-only paid content. */
  isBlu: boolean;
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
  /** Sweam-published on approval: the creator can request removal, not unpublish. */
  adminLocked: boolean;
  /** True while a removal request for this title is open. */
  removalRequested: boolean;
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

export const REPORT_REASONS = ['prohibited', 'abuse', 'spam', 'copyright', 'other'] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  prohibited: 'Prohibited content (nudity, explicit, illegal)',
  abuse: 'Abusive or harmful',
  spam: 'Spam or misleading',
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
  | 'strike'
  | 'payout'
  | 'new_episode'
  | 'comment'
  | 'follow'
  | 'submission'
  | 'verbatiim'
  | 'blu';

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
  pendingPayouts: number;
  revenueMillicents: number;
  pendingSubmissions: number;
  pendingClips: number;
}

/** A creator's request for Sweam to remove one of their admin-locked titles. */
export interface AdminRemovalRequest {
  id: string;
  reason: string;
  createdAt: string;
  title: { id: string; name: string; slug: string };
  creator: { displayName: string; handle: string | null };
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

// ---------------------------------------------------------------------------
// Monetization (AVOD)
// ---------------------------------------------------------------------------

/** The ad handed to the player for a pre-roll slot. */
export interface PrerollAd {
  id: string;
  sponsor: string;
  headline: string;
  mediaUrl: string;
  clickUrl: string;
  durationS: number;
}

export type PayoutStatus = 'pending' | 'paid' | 'rejected';

export interface PayoutEntry {
  id: string;
  amountMillicents: number;
  status: PayoutStatus;
  requestedAt: string;
  decidedAt: string | null;
}

/** A creator's earnings view: the ledger, the split, payout state, and eligibility. */
export interface EarningsSummary {
  lifetimeMillicents: number;
  availableMillicents: number;
  pendingMillicents: number;
  paidMillicents: number;
  perTitle: { titleName: string; impressions: number; creatorMillicents: number }[];
  daily: { day: string; impressions: number; creatorMillicents: number }[];
  payouts: PayoutEntry[];
  minPayoutMillicents: number;
  creatorSharePercent: number;
  eligibility: MonetizationEligibility;
}

export interface AdminAd {
  id: string;
  sponsor: string;
  headline: string;
  mediaUrl: string;
  clickUrl: string;
  durationS: number;
  cpmCents: number;
  active: boolean;
  impressions: number;
  revenueMillicents: number;
}

export interface AdminPayout {
  id: string;
  amountMillicents: number;
  requestedAt: string;
  creator: { handle: string; displayName: string };
}

export interface AdminMonetization {
  totals: {
    impressions: number;
    revenueMillicents: number;
    creatorMillicents: number;
    platformMillicents: number;
  };
  ads: AdminAd[];
  pendingPayouts: AdminPayout[];
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export type SubmissionStatus = 'pending' | 'under_review' | 'accepted' | 'declined' | 'withdrawn';

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending: 'Received',
  under_review: 'Under review',
  accepted: 'Accepted',
  declined: 'Not selected',
  withdrawn: 'Withdrawn',
};

/**
 * The forward pipeline a submission moves through, for the status bar. Declined
 * and withdrawn are terminal states that sit off this track.
 */
export const SUBMISSION_STATUS_STEPS: SubmissionStatus[] = ['pending', 'under_review', 'accepted'];

export type AiRecommendation = 'accept' | 'decline' | 'needs_review';

export const AI_RECOMMENDATION_LABELS: Record<AiRecommendation, string> = {
  accept: 'Recommends accept',
  decline: 'Recommends decline',
  needs_review: 'Needs human review',
};

/** The stored result of an AI-assisted review, shown to admins in the CRM. */
export interface AiSubmissionReview {
  recommendation: AiRecommendation;
  /** 0..1 self-reported confidence. */
  confidence: number;
  summary: string;
  riskFlags: string[];
  suggestedNote: string;
  model: string;
  reviewedAt: string;
}

/** A curated-intake submission: finished work pitched for inclusion on Sweam. */
export interface SubmissionItem {
  id: string;
  titleName: string;
  kind: ContentKind;
  /** Primary genre (kept for cards); the full set is in `genres`. */
  genre: Genre;
  /** Audience tiers this work targets. */
  audiences: string[];
  /** All genres chosen (multi-select). */
  genres: Genre[];
  /** Sub-genre refinements chosen (multi-select). */
  subgenres: string[];
  synopsis: string;
  /** External screener link (optional fallback); '' when the work was uploaded. */
  workUrl: string;
  /** Sweam-hosted upload (/media/...), when the work was uploaded here directly. */
  sourceUrl: string | null;
  captionsUrl: string | null;
  /** The Verbatiim project this was imported from, if any. */
  verbatiimProjectId: string | null;
  /** Required viewer rating (MPAA-style). */
  rating: Rating | null;
  /** Required cover art (a /media/... image the creator uploaded). */
  posterUrl: string | null;
  /** The series this part belongs to, when the kind is a series. */
  seriesId: string | null;
  seriesName: string | null;
  /** Whether this is an adaptation of a third-party published work. */
  isAdaptation: boolean;
  /** The source work being adapted, when isAdaptation. */
  adaptationSource: string;
  /** Uploaded proof of rights/licence (a /media/... file), when isAdaptation. */
  rightsProofUrl: string | null;
  /** Uploaded identification (a /media/... file), when isAdaptation. */
  idProofUrl: string | null;
  /** The submitter attested ownership and agreed to hold Sweam harmless. */
  adaptationAttested: boolean;
  status: SubmissionStatus;
  /** Reviewer note, shared with the submitter on decision. */
  note: string;
  createdAt: string;
  updatedAt: string | null;
  decidedAt: string | null;
}

/** A creator's named series, reused across submissions to add new parts. */
export interface SeriesSummary {
  id: string;
  name: string;
}

export interface AdminSubmission extends SubmissionItem {
  submitter: { displayName: string; email: string; handle: string | null };
  /** The most recent AI review, or null if none has been run. */
  aiReview: AiSubmissionReview | null;
}

// ---------------------------------------------------------------------------
// Instant clips (record-in-Sweam, publish now, review after)
// ---------------------------------------------------------------------------

/**
 * A title's post-publish moderation state. Regular catalog titles are
 * `cleared`. A clip recorded and posted instantly starts `pending`: it is live
 * right away but sits in the admin review queue. The AI (or a viewer report)
 * can push it to `flagged` (hidden pending a human), and an admin can `remove`
 * it. Only Sweam moves a title out of `pending`/`flagged`.
 */
export const REVIEW_STATES = ['cleared', 'pending', 'flagged', 'removed'] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  cleared: 'Cleared',
  pending: 'Live, awaiting review',
  flagged: 'Flagged, hidden',
  removed: 'Removed',
};

/** Spec + limits for an instantly recorded clip. */
export const CLIP_SPEC = {
  maxSeconds: 180,
  maxBytes: 200 * 1024 * 1024,
  maxLabel: '200 MB',
  captionMax: 200,
} as const;

/** One entry in the admin clip review queue. */
export interface ClipReviewItem {
  id: string;
  state: ReviewState;
  caption: string;
  createdAt: string;
  title: { id: string; name: string; slug: string; published: boolean };
  episodeId: string;
  creator: { displayName: string; handle: string | null };
  /** The AI's advisory read of the caption/metadata, or null if not done yet. */
  ai: AiSubmissionReview | null;
  /** Set when the AI review could not be run. */
  aiError: string | null;
  decidedAt: string | null;
}

// ---------------------------------------------------------------------------
// Community
// ---------------------------------------------------------------------------

export type CommentStatus =
  | 'visible'
  | 'removed_by_author'
  | 'removed_by_creator'
  | 'removed_by_admin';

/**
 * One comment in a title's thread. Removed comments appear only as
 * placeholders (empty body, status says why) and only when they still have
 * visible replies; otherwise they are dropped from the payload entirely.
 */
export interface CommentItem {
  id: string;
  body: string;
  status: CommentStatus;
  createdAt: string;
  author: { displayName: string; handle: string | null };
  /** True when the title's own creator wrote it (shown as a badge). */
  authorIsCreator: boolean;
  /** True when the signed-in viewer wrote it. */
  mine: boolean;
  /** Like count and whether the signed-in viewer has liked it (double-tap to like). */
  likes: number;
  likedByMe: boolean;
  replies: CommentItem[];
}

export const COMMENT_REPORT_REASONS = ['spam', 'abuse', 'other'] as const;

export type CommentReportReason = (typeof COMMENT_REPORT_REASONS)[number];

/** A creator's public page. */
export interface CreatorPublicPage {
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followedByMe: boolean;
  titles: TitleSummary[];
}

export interface AdminCommentReport {
  id: string;
  reason: CommentReportReason;
  createdAt: string;
  comment: { id: string; body: string; authorName: string; titleName: string; titleSlug: string };
  reporter: { displayName: string };
}

/** Every API error responds with this envelope and a machine-readable code. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Verbatiim: make an episode from prose, a screenplay, or one prompt
// ---------------------------------------------------------------------------

/** The film-and-clips engine's public name; change it here and every screen follows. */
export const VERBATIIM_NAME = 'Verbatiim';

export type VerbatiimMode = 'adapt' | 'fountain' | 'prompt';

/**
 * A job's source: one of the text modes above, or a finished cut (video plus
 * captions) imported through Verbatiim for captions, clips, and signed credits.
 */
export type VerbatiimJobMode = VerbatiimMode | 'import';

export const VERBATIIM_MODE_LABELS: Record<VerbatiimMode, string> = {
  adapt: 'Adapt prose: your exact words become narration and dialogue',
  fountain: 'Screenplay in Fountain format',
  prompt: 'One prompt: the story is written for you',
};

/** Longest text accepted, matching Verbatiim's own limit. */
export const VERBATIIM_MAX_TEXT = 400_000;
/** Jobs a creator may start per day. */
export const VERBATIIM_DAILY_LIMIT = 10;

export type VerbatiimJobStatus = 'queued' | 'running' | 'importing' | 'done' | 'failed';

export interface VerbatiimClip {
  id: string;
  score: number;
  durationS: number;
  title: string;
  /** One plain-language reason per scoring factor. */
  reasons: string[];
  /** Sweam-hosted /media/ URLs once imported. */
  videoUrl: string;
  captionsUrl: string | null;
}

export interface VerbatiimJob {
  id: string;
  titleId: string;
  episodeId: string | null;
  mode: VerbatiimJobMode;
  season: number;
  episode: number;
  name: string;
  status: VerbatiimJobStatus;
  /** Verbatiim's own stage-by-stage progress line, in plain words. */
  progress: string | null;
  error: string | null;
  clips: VerbatiimClip[];
  credits: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerbatiimStatus {
  connected: boolean;
  name: string;
}
