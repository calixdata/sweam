import { Hono } from 'hono';
import type { VerbatiimJob, VerbatiimStatus } from '@sweam/shared';
import { VERBATIIM_NAME } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { requireCreator, currentUser } from '../lib/session';
import { assertGoodStanding } from '../lib/standing';
import { verbatiimJobSchema } from '../lib/validate';
import {
  VerbatiimError,
  createRemoteJob,
  getRemoteJob,
  importJob,
  mapJob,
  progressLine,
  syncJob,
  verbatiimConfigured,
  verifyWebhookSignature,
  type VerbatiimJobRow,
} from '../lib/verbatiim';

/** Studio side: creators start and follow Verbatiim films. Mounted at /api/studio/verbatiim. */
export const verbatiimStudioRoutes = new Hono<AppEnv>();

/** Verbatiim calls this when a job finishes. Mounted at /api/integrations/verbatiim. */
export const verbatiimWebhookRoutes = new Hono<AppEnv>();

function asStatus(err: unknown): never {
  if (err instanceof VerbatiimError) fail(err.status === 422 ? 422 : err.status >= 500 ? 502 : 400, 'verbatiim_error', err.message);
  throw err;
}

verbatiimStudioRoutes.get('/status', requireCreator, (c) => {
  const payload: VerbatiimStatus = { connected: verbatiimConfigured(c.env), name: VERBATIIM_NAME };
  return c.json(payload);
});

async function ownedTitleId(c: Parameters<typeof currentUser>[0], titleId: string): Promise<{ id: string }> {
  const row = await c.env.DB.prepare('SELECT id FROM titles WHERE id = ? AND creator_id = ?')
    .bind(titleId, currentUser(c).id)
    .first<{ id: string }>();
  if (!row) fail(404, 'title_not_found', 'No such title in your Studio.');
  return row;
}

verbatiimStudioRoutes.post('/titles/:titleId/jobs', requireCreator, async (c) => {
  if (!verbatiimConfigured(c.env)) fail(503, 'verbatiim_not_connected', `${VERBATIIM_NAME} is not connected on this server yet.`);
  const user = currentUser(c);
  await assertGoodStanding(c.env.DB, user.id);
  const title = await ownedTitleId(c, c.req.param('titleId'));
  const body = await parseBody(c, verbatiimJobSchema);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.verbatiim, user.id);

  const clash = await c.env.DB.prepare(
    `SELECT 1 AS x FROM episodes WHERE title_id = ? AND season = ? AND episode = ?
     UNION ALL
     SELECT 1 FROM verbatiim_jobs WHERE title_id = ? AND season = ? AND episode = ? AND status IN ('queued', 'running', 'importing')`,
  )
    .bind(title.id, body.season, body.episode, title.id, body.season, body.episode)
    .first();
  if (clash) fail(409, 'episode_exists', `Season ${body.season} episode ${body.episode} is already taken or being made.`);

  const webhookUrl = `${new URL(c.req.url).origin}/api/integrations/verbatiim/webhook`;
  const remote = await createRemoteJob(c.env, {
    mode: body.mode,
    text: body.text,
    name: body.name,
    clipCount: body.clipCount,
    webhookUrl,
  }).catch(asStatus);

  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO verbatiim_jobs (id, remote_id, creator_id, title_id, mode, season, episode, name, synopsis, status, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
  )
    .bind(id, remote.id, user.id, title.id, body.mode, body.season, body.episode, body.name, body.synopsis, progressLine(remote) ?? 'Queued', now, now)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM verbatiim_jobs WHERE id = ?').bind(id).first<VerbatiimJobRow>();
  return c.json(mapJob(row!), 201);
});

verbatiimStudioRoutes.get('/titles/:titleId/jobs', requireCreator, async (c) => {
  const title = await ownedTitleId(c, c.req.param('titleId'));
  const load = () =>
    c.env.DB.prepare('SELECT * FROM verbatiim_jobs WHERE title_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(title.id)
      .all<VerbatiimJobRow>();
  let { results } = await load();
  // Refresh jobs still in flight so progress moves even when webhooks cannot
  // reach this server (local dev); finished films import in the background.
  const active = results.filter((r) => r.status === 'queued' || r.status === 'running');
  if (active.length && verbatiimConfigured(c.env)) {
    for (const row of active) {
      try {
        const remote = await getRemoteJob(c.env, row.remote_id);
        if (remote.status === 'done') c.executionCtx.waitUntil(importJob(c.env, row, remote));
        else await syncJob(c.env, row, remote);
      } catch {
        // Verbatiim briefly unreachable: show the last known state.
      }
    }
    ({ results } = await load());
  }
  const jobs: VerbatiimJob[] = results.map(mapJob);
  return c.json({ jobs });
});

/** "Check now": re-read the job from Verbatiim and import it if it is finished. */
verbatiimStudioRoutes.post('/jobs/:jobId/refresh', requireCreator, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM verbatiim_jobs WHERE id = ? AND creator_id = ?')
    .bind(c.req.param('jobId'), currentUser(c).id)
    .first<VerbatiimJobRow>();
  if (!row) fail(404, 'job_not_found', 'No such job.');
  if (!verbatiimConfigured(c.env)) fail(503, 'verbatiim_not_connected', `${VERBATIIM_NAME} is not connected on this server yet.`);
  await syncJob(c.env, row).catch(asStatus);
  const fresh = await c.env.DB.prepare('SELECT * FROM verbatiim_jobs WHERE id = ?').bind(row.id).first<VerbatiimJobRow>();
  return c.json(mapJob(fresh!));
});

verbatiimWebhookRoutes.post('/webhook', async (c) => {
  if (!verbatiimConfigured(c.env)) return c.json({ ok: false }, 404);
  const raw = await c.req.text();
  const valid = await verifyWebhookSignature(c.env.VERBATIIM_WEBHOOK_SECRET!, raw, c.req.header('verbatiim-signature'));
  if (!valid) fail(401, 'bad_signature', 'Signature did not verify.');
  let remoteId: string | undefined;
  try {
    remoteId = (JSON.parse(raw) as { job?: { id?: string } }).job?.id;
  } catch {
    fail(400, 'bad_json', 'Body must be JSON.');
  }
  if (!remoteId) fail(400, 'bad_payload', 'Missing job id.');
  const row = await c.env.DB.prepare('SELECT * FROM verbatiim_jobs WHERE remote_id = ?').bind(remoteId).first<VerbatiimJobRow>();
  // Unknown jobs are acknowledged so Verbatiim stops retrying; nothing else happens.
  if (row) c.executionCtx.waitUntil(syncJob(c.env, row).catch(() => undefined));
  return c.json({ ok: true });
});
