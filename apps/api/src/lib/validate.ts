import { z } from 'zod';
import { ADVISORIES, CONTENT_KINDS, GENRES } from '@sweam/shared';

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
