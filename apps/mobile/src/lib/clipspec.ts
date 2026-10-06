/**
 * Clip + taxonomy constants mirrored from `@sweam/shared`. The mobile app is an
 * isolated package (not a workspace), so it can't import the shared package;
 * these values are kept in sync by hand and match the server's zod enums
 * exactly, which is what the clip API validates against.
 */

export const RATINGS = ['G', 'PG', 'PG-13', 'R', 'NC-17'] as const;
export type Rating = (typeof RATINGS)[number];

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

export const AUDIENCES = ['Young Adult', 'Adult'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<Audience, string> = {
  'Young Adult': 'Young Adult (16+)',
  Adult: 'Adult (18+)',
};

/** Spec + limits for an instantly recorded clip (mirrors CLIP_SPEC on the API). */
export const CLIP_SPEC = {
  maxSeconds: 180,
  maxBytes: 200 * 1024 * 1024,
  maxLabel: '200 MB',
  captionMax: 200,
} as const;

/** Video container types the intake upload accepts (UPLOAD_CONTENT_TYPES on the API). */
export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

/**
 * Sweam Blu preset price tiers (mirrors BLU_TIERS on the server). Creators do
 * not set free-form prices; they pick one of these for subscriber-only content.
 * The creator keeps 80%; a subscription unlocks all of a creator's Blu content.
 */
export interface BluTier {
  id: string;
  label: string;
  priceCents: number;
}

export const BLU_TIERS: readonly BluTier[] = [
  { id: 'blu_299', label: '$2.99', priceCents: 299 },
  { id: 'blu_499', label: '$4.99', priceCents: 499 },
  { id: 'blu_699', label: '$6.99', priceCents: 699 },
  { id: 'blu_999', label: '$9.99', priceCents: 999 },
  { id: 'blu_1499', label: '$14.99', priceCents: 1499 },
  { id: 'blu_1999', label: '$19.99', priceCents: 1999 },
  { id: 'blu_2499', label: '$24.99', priceCents: 2499 },
  { id: 'blu_3999', label: '$39.99', priceCents: 3999 },
  { id: 'blu_4999', label: '$49.99', priceCents: 4999 },
] as const;

/** Sweam Blu Fund thresholds (mirrors BLU_FUND_THRESHOLDS on the server), for copy. */
export const BLU_FUND = {
  minFollowers: 500,
  minViews: 10000,
  violationWindowDays: 90,
} as const;
