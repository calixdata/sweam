import { Hono } from 'hono';
import type { Context } from 'hono';
import type { MultipartInit, SubmissionItem } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { requireUser, currentUser } from '../lib/session';
import {
  multipartAbortSchema,
  multipartCompleteSchema,
  multipartInitSchema,
  submissionCreateSchema,
  verbatiimImportSchema,
} from '../lib/validate';
import { copyToR2, getRemoteJob, verbatiimConfigured } from '../lib/verbatiim';
import {
  MAX_PART_BYTES,
  MAX_UPLOAD_BYTES,
  MULTIPART_PART_SIZE,
  UPLOAD_CONTENT_TYPES,
} from './studio';

/**
 * The curated intake door. Signed-in users pitch finished work, and it can be
 * hosted on Sweam directly: upload the file here (the same resumable pipeline
 * the Studio uses), import a finished film from Verbatiim, or, as a fallback,
 * link an external screener. Every submission gets a human decision in the
 * admin console, and submitters can track status and withdraw a submission.
 */
export const submissionRoutes = new Hono<AppEnv>();

submissionRoutes.use('*', requireUser);

export interface SubmissionRow {
  id: string;
  title_name: string;
  kind: SubmissionItem['kind'];
  genre: SubmissionItem['genre'];
  rating: SubmissionItem['rating'];
  synopsis: string;
  work_url: string;
  source_url: string | null;
  captions_url: string | null;
  verbatiim_project_id: string | null;
  poster_url: string | null;
  series_id: string | null;
  series_name: string | null;
  status: SubmissionItem['status'];
  note: string;
  created_at: string;
  updated_at: string | null;
  decided_at: string | null;
}

export function mapSubmission(row: SubmissionRow): SubmissionItem {
  return {
    id: row.id,
    titleName: row.title_name,
    kind: row.kind,
    genre: row.genre,
    rating: row.rating,
    synopsis: row.synopsis,
    workUrl: row.work_url,
    sourceUrl: row.source_url,
    captionsUrl: row.captions_url,
    verbatiimProjectId: row.verbatiim_project_id,
    posterUrl: row.poster_url,
    seriesId: row.series_id,
    seriesName: row.series_name,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
  };
}

/** The submission columns plus the joined series name, for reads. */
export const SUBMISSION_SELECT = `s.id, s.title_name, s.kind, s.genre, s.rating, s.synopsis,
  s.work_url, s.source_url, s.captions_url, s.verbatiim_project_id, s.poster_url, s.series_id,
  se.name AS series_name, s.status, s.note, s.created_at, s.updated_at, s.decided_at`;

// ---------------------------------------------------------------------------
// Create, list, withdraw
// ---------------------------------------------------------------------------

submissionRoutes.post('/', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.submission, user.id);
  const body = await parseBody(c, submissionCreateSchema);

  // Resolve the series for a series submission: an existing one the creator
  // owns, or a new one created from the given name (so future parts reuse it).
  let seriesId: string | null = null;
  if (body.kind === 'series') {
    if (body.seriesId) {
      const owned = await c.env.DB.prepare('SELECT id FROM series WHERE id = ? AND user_id = ?')
        .bind(body.seriesId, user.id)
        .first<{ id: string }>();
      if (!owned) fail(404, 'series_not_found', 'That series is not one of yours.');
      seriesId = body.seriesId;
    } else if (body.seriesName) {
      seriesId = crypto.randomUUID();
      await c.env.DB.prepare('INSERT INTO series (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
        .bind(seriesId, user.id, body.seriesName, nowIso())
        .run();
    }
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO submissions
       (id, user_id, title_name, kind, genre, rating, synopsis, work_url, source_url, captions_url,
        verbatiim_project_id, poster_url, series_id, rights_confirmed, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?)`,
  )
    .bind(
      id,
      user.id,
      body.titleName,
      body.kind,
      body.genre,
      body.rating,
      body.synopsis,
      body.workUrl ?? '',
      body.sourceUrl ?? null,
      body.captionsUrl ?? null,
      body.verbatiimProjectId ?? null,
      body.posterUrl,
      seriesId,
      now,
      now,
    )
    .run();
  return c.json({ id }, 201);
});

submissionRoutes.get('/mine', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT ${SUBMISSION_SELECT} FROM submissions s
     LEFT JOIN series se ON se.id = s.series_id
     WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 30`,
  )
    .bind(user.id)
    .all<SubmissionRow>();
  return c.json({ submissions: results.map(mapSubmission) });
});

/** The creator's named series, for attaching a new part to an existing one. */
submissionRoutes.get('/series', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM series WHERE user_id = ? ORDER BY name',
  )
    .bind(currentUser(c).id)
    .all<{ id: string; name: string }>();
  return c.json({ series: results });
});

/** Withdraw a submission that has not been decided yet. */
submissionRoutes.post('/:submissionId/withdraw', async (c) => {
  const user = currentUser(c);
  const result = await c.env.DB.prepare(
    `UPDATE submissions SET status = 'withdrawn', updated_at = ?
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'under_review')`,
  )
    .bind(nowIso(), c.req.param('submissionId'), user.id)
    .run();
  if (result.meta.changes === 0) {
    fail(404, 'not_withdrawable', 'No open submission of yours with that id to withdraw.');
  }
  return c.json({ status: 'withdrawn' });
});

// ---------------------------------------------------------------------------
// Direct upload (any signed-in user; the Studio uploader gated to creators is
// a separate door). Intake objects live under a `sub/<userId>/` prefix.
// ---------------------------------------------------------------------------

function intakeKeyFor(userId: string, filename: string): string {
  const safeName = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `sub/${userId}/${crypto.randomUUID()}/${safeName || 'upload'}`;
}

function assertOwnIntakeKey(c: Context<AppEnv>, key: string): void {
  if (!key.startsWith(`sub/${currentUser(c).id}/`)) {
    fail(404, 'upload_not_found', 'No such upload.');
  }
}

submissionRoutes.put('/upload/:filename', async (c) => {
  await enforceRateLimit(c.env.DB, RATE_LIMITS.upload, currentUser(c).id);
  const contentType = c.req.header('content-type') ?? '';
  if (!UPLOAD_CONTENT_TYPES.has(contentType)) {
    fail(415, 'unsupported_type', 'Upload MP4/WebM video, WebVTT captions, or JPEG/PNG/WebP images.');
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    fail(411, 'length_required', 'Uploads must include a Content-Length header.');
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    fail(413, 'too_large', 'Uploads are limited to 512 MB in this release.');
  }
  if (!c.req.raw.body) fail(400, 'empty_body', 'Upload body is empty.');

  const key = intakeKeyFor(currentUser(c).id, c.req.param('filename'));
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ url: `/media/${key}` }, 201);
});

submissionRoutes.post('/upload/multipart', async (c) => {
  await enforceRateLimit(c.env.DB, RATE_LIMITS.upload, currentUser(c).id);
  const body = await parseBody(c, multipartInitSchema);
  if (!UPLOAD_CONTENT_TYPES.has(body.contentType)) {
    fail(415, 'unsupported_type', 'Upload MP4/WebM video, WebVTT captions, or JPEG/PNG/WebP images.');
  }
  const key = intakeKeyFor(currentUser(c).id, body.filename);
  const upload = await c.env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType: body.contentType },
  });
  const payload: MultipartInit = { key, uploadId: upload.uploadId, partSize: MULTIPART_PART_SIZE };
  return c.json(payload, 201);
});

submissionRoutes.put('/upload/multipart/part', async (c) => {
  const key = c.req.query('key') ?? '';
  const uploadId = c.req.query('uploadId') ?? '';
  const partNumber = Number(c.req.query('partNumber') ?? '0');
  assertOwnIntakeKey(c, key);
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    fail(400, 'bad_part', 'Provide uploadId and a part number between 1 and 10000.');
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_PART_BYTES) {
    fail(400, 'bad_part_size', 'Each part needs a Content-Length up to 64 MB.');
  }
  if (!c.req.raw.body) fail(400, 'empty_body', 'Part body is empty.');

  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  try {
    const part = await upload.uploadPart(partNumber, c.req.raw.body);
    return c.json({ partNumber: part.partNumber, etag: part.etag });
  } catch {
    fail(409, 'upload_gone', 'That multipart upload no longer exists; start it again.');
  }
});

submissionRoutes.post('/upload/multipart/complete', async (c) => {
  const body = await parseBody(c, multipartCompleteSchema);
  assertOwnIntakeKey(c, body.key);
  const upload = c.env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
  try {
    await upload.complete(body.parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })));
  } catch {
    fail(409, 'upload_gone', 'That multipart upload could not be completed; start it again.');
  }
  return c.json({ url: `/media/${body.key}` }, 201);
});

submissionRoutes.post('/upload/multipart/abort', async (c) => {
  const body = await parseBody(c, multipartAbortSchema);
  assertOwnIntakeKey(c, body.key);
  const upload = c.env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
  try {
    await upload.abort();
  } catch {
    // Aborting an already-gone upload is success from the client's view.
  }
  return c.json({ aborted: true });
});

// ---------------------------------------------------------------------------
// Verbatiim deep import: pull a finished film into Sweam's own storage, so
// Sweam hosts it rather than being a link to a third party.
// ---------------------------------------------------------------------------

submissionRoutes.get('/verbatiim/status', (c) => c.json({ connected: verbatiimConfigured(c.env) }));

submissionRoutes.post('/verbatiim/import', async (c) => {
  if (!verbatiimConfigured(c.env)) {
    fail(503, 'verbatiim_off', 'Verbatiim import is not connected on this deployment.');
  }
  await enforceRateLimit(c.env.DB, RATE_LIMITS.upload, currentUser(c).id);
  const body = await parseBody(c, verbatiimImportSchema);

  const job = await getRemoteJob(c.env, body.projectId);
  if (job.status !== 'done') {
    fail(409, 'not_ready', 'That Verbatiim project has not finished rendering yet.');
  }
  const names = new Set(job.outputs.map((output) => output.name));
  if (!names.has('episode.mp4')) {
    fail(422, 'no_film', 'That Verbatiim project has no finished film to import.');
  }

  const folder = `sub/${currentUser(c).id}/${crypto.randomUUID()}`;
  const videoKey = `${folder}/verbatiim-episode.mp4`;
  await copyToR2(c.env, job.id, 'episode.mp4', videoKey, 'video/mp4');

  let captionsUrl: string | null = null;
  if (names.has('captions.vtt')) {
    await copyToR2(c.env, job.id, 'captions.vtt', `${folder}/captions.vtt`, 'text/vtt');
    captionsUrl = `/media/${folder}/captions.vtt`;
  }
  return c.json({ sourceUrl: `/media/${videoKey}`, captionsUrl, projectId: job.id }, 201);
});
