import { Hono } from 'hono';
import type { SubmissionItem } from '@sweam/shared';
import type { AppEnv } from '../env';
import { nowIso, parseBody } from '../lib/http';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { requireUser, currentUser } from '../lib/session';
import { submissionCreateSchema } from '../lib/validate';

/**
 * The curated intake door (docs/CREATOR-PROGRAM.md, "Content inclusion").
 * Signed-in users pitch finished work with a screener link; every submission
 * gets a human decision in the admin console.
 */
export const submissionRoutes = new Hono<AppEnv>();

submissionRoutes.use('*', requireUser);

interface SubmissionRow {
  id: string;
  title_name: string;
  kind: SubmissionItem['kind'];
  genre: SubmissionItem['genre'];
  synopsis: string;
  work_url: string;
  status: SubmissionItem['status'];
  note: string;
  created_at: string;
  decided_at: string | null;
}

export function mapSubmission(row: SubmissionRow): SubmissionItem {
  return {
    id: row.id,
    titleName: row.title_name,
    kind: row.kind,
    genre: row.genre,
    synopsis: row.synopsis,
    workUrl: row.work_url,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

submissionRoutes.post('/', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.submission, user.id);
  const body = await parseBody(c, submissionCreateSchema);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO submissions (id, user_id, title_name, kind, genre, synopsis, work_url, rights_confirmed, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?)`,
  )
    .bind(id, user.id, body.titleName, body.kind, body.genre, body.synopsis, body.workUrl, nowIso())
    .run();
  return c.json({ id }, 201);
});

submissionRoutes.get('/mine', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, title_name, kind, genre, synopsis, work_url, status, note, created_at, decided_at
     FROM submissions WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<SubmissionRow>();
  return c.json({ submissions: results.map(mapSubmission) });
});
