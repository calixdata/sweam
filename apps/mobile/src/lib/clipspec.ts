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
export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;
