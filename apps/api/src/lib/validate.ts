import { z } from 'zod';
import {
  ADVISORIES,
  COMMENT_REPORT_REASONS,
  CONTENT_KINDS,
  GENRES,
  RATINGS,
  REPORT_REASONS,
  VERBATIIM_MAX_TEXT,
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

/** Confirm a sign-up: the token from the verification email link. */
export const verifyTokenSchema = z.object({ token: z.string().trim().min(1).max(256) });

/** Ask for a fresh verification email. */
export const resendVerificationSchema = z.object({ email });

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
// Submissions
// ---------------------------------------------------------------------------

export const submissionCreateSchema = z
  .object({
    titleName: z.string().trim().min(1, 'The work needs a name.').max(120),
    kind,
    genre,
    rating: z.enum(RATINGS),
    synopsis: z
      .string()
      .trim()
      .min(20, 'A synopsis is required: tell us about the work in at least a couple of sentences.')
      .max(2000),
    /** Cover art is required (an uploaded /media image or an https image URL). */
    posterUrl: mediaUrl,
    /** The primary path: the work uploaded to Sweam, or imported from Verbatiim. */
    sourceUrl: mediaUrl.nullable().default(null),
    captionsUrl: mediaUrl.nullable().default(null),
    /** The Verbatiim project the upload was imported from, if any. */
    verbatiimProjectId: z.string().trim().min(1).max(200).nullable().default(null),
    /** Series linkage: an existing series id, or a new series name to create. */
    seriesId: z.string().trim().min(1).max(64).nullable().default(null),
    seriesName: z.string().trim().min(1).max(120).nullable().default(null),
    /** Optional external screener fallback: https only. */
    workUrl: z
      .string()
      .trim()
      .url('Enter a valid https link, or upload the file instead.')
      .max(2048)
      .refine((value) => value.startsWith('https://'), 'The screener link must be https.')
      .nullable()
      .default(null),
    rightsConfirmed: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm you hold the rights to this work.' }),
    }),
  })
  .refine((value) => Boolean(value.sourceUrl || value.workUrl || value.verbatiimProjectId), {
    message: 'Add your work: upload a file, import from Verbatiim, or paste a screener link.',
    path: ['sourceUrl'],
  })
  .refine((value) => value.kind !== 'series' || Boolean(value.seriesId || value.seriesName), {
    message: 'For a series, choose an existing series or name a new one.',
    path: ['seriesName'],
  });

/** Name a new series to group future parts under. */
export const seriesCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name the series.').max(120),
});

/** A creator's request for Sweam to remove one of their live titles. */
export const removalRequestSchema = z.object({
  reason: z.string().trim().min(10, 'Give a brief reason for the removal request.').max(1000),
});

/** An admin's decision on a removal request. */
export const removalDecideSchema = z.object({
  remove: z.boolean(),
  note: z.string().trim().max(1000).default(''),
});

/** Import a finished film from a Verbatiim project id or share link. */
export const verbatiimImportSchema = z.object({
  projectId: z
    .string()
    .trim()
    .min(1, 'Paste a Verbatiim project id or link.')
    .max(400)
    .transform((value) => value.split(/[/?#]/).filter(Boolean).pop() ?? value)
    .refine((value) => value.length >= 1 && value.length <= 200, 'That is not a Verbatiim project id.'),
});

export const submissionDecideSchema = z.object({
  accept: z.boolean(),
  note: z.string().trim().max(1000).default(''),
});

/** Triage move between the two open states (Received <-> Under review). */
export const submissionStatusSchema = z.object({
  status: z.enum(['pending', 'under_review']),
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

/** Starting a Verbatiim film. The rights confirmation mirrors the submission form's. */
export const verbatiimJobSchema = z.object({
  mode: z.enum(['adapt', 'fountain', 'prompt']),
  text: z
    .string()
    .trim()
    .min(1, 'Paste the prose, screenplay, or prompt.')
    .max(VERBATIIM_MAX_TEXT, 'That text is too long for one episode.'),
  name: z.string().trim().min(1, 'Episode name is required.').max(120),
  synopsis: z.string().trim().max(2000).default(''),
  season: z.number().int().min(1).max(100).default(1),
  episode: z.number().int().min(1).max(500).default(1),
  clipCount: z.number().int().min(0).max(10).default(3),
  rightsConfirmed: z.literal(true, { errorMap: () => ({ message: 'Confirm you hold the rights to this text.' }) }),
});
