import { z } from 'zod';
import {
  ADVISORIES,
  COMMENT_REPORT_REASONS,
  CONTENT_KINDS,
  GENRES,
  REPORT_REASONS,
} from '@sweam/shared';

/**
 * Every request body and query parameter in the API is validated by one of
 * these schemas before it touches a database statement.
 */

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.');
const displayName = z.string().trim().min(1, 'Display name is required.').max(60);

export const signUpSchema = z.object({ email, displayName, password });

export const signInSchema = z.object({ email, password: z.string().min(1).max(128) });

export const creatorProfileSchema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/, 'Handle must be 3-24 characters: letters, numbers, underscores.'),
  bio: z.string().trim().max(500).default(''),
});

const kind = z.enum(CONTENT_KINDS as [string, ...string[]] as ['film', 'series', 'short', 'documentary']);
const genre = z.enum(GENRES);
const advisory = z.enum(ADVISORIES);

/** Absolute http(s) URL, or an app-relative /media/... key from our own uploader. */
const mediaUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => /^https?:\/\/\S+$/.test(value) || /^\/media\/\S+$/.test(value),
    'Must be an http(s) URL or a /media/... path from the Sweam uploader.',
  );

export const titleCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  kind,
  genre,
  synopsis: z.string().trim().max(2000).default(''),
  advisory: advisory.default('TV-PG'),
  posterUrl: mediaUrl.nullable().default(null),
});

export const titleUpdateSchema = titleCreateSchema
  .extend({
    /** Creator opt-in to the scout portal; only meaningful on update. */
    scoutable: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export const publishSchema = z.object({ published: z.boolean() });

export const episodeCreateSchema = z.object({
  season: z.number().int().min(1).max(100).default(1),
  episode: z.number().int().min(1).max(500).default(1),
  name: z.string().trim().min(1, 'Episode name is required.').max(120),
  synopsis: z.string().trim().max(2000).default(''),
  videoUrl: mediaUrl,
  captionsUrl: mediaUrl.nullable().default(null),
  durationS: z.number().int().min(0).max(86_400).default(0),
});

export const episodeUpdateSchema = episodeCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export const progressSchema = z.object({
  positionS: z.number().min(0).max(172_800),
  durationS: z.number().positive().max(172_800),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Enter a search term.').max(80),
});

export const scoutApplySchema = z.object({
  orgName: z.string().trim().min(2, 'Organization name is required.').max(120),
  orgUrl: z
    .string()
    .trim()
    .url('Enter a full https URL, or leave it blank.')
    .max(2048)
    .nullable()
    .default(null),
  contactEmail: email,
});

export const scoutInterestSchema = z.object({
  note: z.string().trim().max(500).default(''),
});

// ---------------------------------------------------------------------------
// Media pipeline
// ---------------------------------------------------------------------------

export const multipartInitSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(100),
});

const multipartRef = {
  key: z.string().min(1).max(1024),
  uploadId: z.string().min(1).max(4096),
};

export const multipartCompleteSchema = z.object({
  ...multipartRef,
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10_000),
        etag: z.string().min(1).max(256),
      }),
    )
    .min(1)
    .max(10_000),
});

export const multipartAbortSchema = z.object(multipartRef);

/** Anonymous beacon: a client-generated random session id, no identity. */
export const viewBeaconSchema = progressSchema.extend({
  viewId: z.string().uuid('viewId must be a UUID.'),
});

export const transcodeClaimSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
});

/** Output filenames are flat (no path separators); the API owns the prefix. */
const outputFilename = /^[A-Za-z0-9_.-]+$/;

export const transcodeCompleteSchema = z.object({
  durationS: z.number().int().min(0).max(86_400),
  master: z
    .string()
    .regex(outputFilename)
    .refine((name) => name.endsWith('.m3u8'), 'master must be an .m3u8 playlist.'),
  poster: z
    .string()
    .regex(outputFilename)
    .refine(
      (name) => /\.(jpe?g|png)$/.test(name),
      'poster must be a .jpg, .jpeg, or .png file.',
    )
    .nullable()
    .default(null),
});

export const transcodeFailSchema = z.object({
  error: z.string().trim().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Trust, safety, and administration
// ---------------------------------------------------------------------------

export const reportCreateSchema = z.object({
  titleId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(1000).default(''),
});

const takedownKind = z.enum(['dmca', 'guidelines']);

export const reportResolveSchema = z
  .object({
    action: z.enum(['dismiss', 'takedown', 'strike', 'takedown_and_strike']),
    kind: takedownKind.optional(),
    note: z.string().trim().max(1000).default(''),
  })
  .refine(
    (value) => !value.action.includes('takedown') || value.kind !== undefined,
    'A takedown needs a kind: dmca or guidelines.',
  );

export const scoutDecideSchema = z.object({
  approve: z.boolean(),
});

export const takedownCreateSchema = z.object({
  slug: z.string().trim().min(1).max(200),
  kind: takedownKind,
  reason: z.string().trim().min(1, 'A takedown needs a written reason.').max(1000),
});

// ---------------------------------------------------------------------------
// Monetization
// ---------------------------------------------------------------------------

/** Ad click destinations: https, or an app-relative path like /discover. */
const clickUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => /^https:\/\/\S+$/.test(value) || /^\/\S*$/.test(value),
    'Must be an https URL or an app-relative path.',
  );

export const adCreateSchema = z.object({
  sponsor: z.string().trim().min(1).max(80),
  headline: z.string().trim().min(1).max(140),
  mediaUrl: mediaUrl,
  clickUrl,
  durationS: z.number().int().min(3).max(60),
  cpmCents: z.number().int().min(1).max(1_000_000),
  active: z.boolean().default(true),
});

export const adUpdateSchema = adCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export const adImpressionSchema = z.object({
  titleId: z.string().min(1).max(64),
});

export const payoutDecideSchema = z.object({
  paid: z.boolean(),
});

// ---------------------------------------------------------------------------
// Community
// ---------------------------------------------------------------------------

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(1000),
  /** Reply target: a top-level comment on the same title, or null. */
  parentId: z.string().min(1).max(64).nullable().default(null),
});

export const commentReportSchema = z.object({
  reason: z.enum(COMMENT_REPORT_REASONS),
});

export const commentReportResolveSchema = z.object({
  action: z.enum(['dismiss', 'remove']),
});
