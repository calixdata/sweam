import { Hono } from 'hono';
import type {
  AdminAd,
  AdminMonetization,
  AdminOverview,
  AdminPayout,
  AdminReport,
  AdminScoutApplication,
  AdminStrike,
  AdminTakedown,
  AdminTranscodeJob,
  ReportReason,
  TakedownKind,
  TranscodeStatus,
} from '@sweam/shared';
import { formatMillicents } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import { notify } from '../lib/notify';
import { requireAdmin, currentUser } from '../lib/session';
import { SUSPENSION_STRIKES, strikeCutoffIso } from '../lib/standing';
import {
  adCreateSchema,
  adUpdateSchema,
  payoutDecideSchema,
  reportResolveSchema,
  scoutDecideSchema,
  takedownCreateSchema,
} from '../lib/validate';

/**
 * The admin console API. Admins are provisioned in the `admins` table by
 * operations; every route here sits behind requireAdmin. Moderation actions
 * always notify the affected creator: silence is how moderation loses trust.
 */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireAdmin);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

adminRoutes.get('/overview', async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM users'),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM creator_profiles'),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM scout_profiles WHERE status = 'approved'"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM scout_profiles WHERE status = 'pending'"),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM titles WHERE published = 1'),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM titles WHERE published = 0'),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM takedowns WHERE released_at IS NULL'),
    c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM transcode_jobs`,
    ),
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(plays), 0) AS plays, COALESCE(SUM(watch_seconds), 0) AS watch FROM title_stats',
    ),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM payout_requests WHERE status = 'pending'"),
    c.env.DB.prepare('SELECT COALESCE(SUM(revenue_millicents), 0) AS n FROM ad_impressions'),
  ]);

  const count = (index: number) => (results[index]?.results?.[0] as { n: number } | undefined)?.n ?? 0;
  const transcode = (results[8]?.results?.[0] ?? {}) as {
    queued: number | null;
    running: number | null;
    failed: number | null;
  };
  const totals = (results[9]?.results?.[0] ?? {}) as { plays: number | null; watch: number | null };

  const payload: AdminOverview = {
    users: count(0),
    creators: count(1),
    approvedScouts: count(2),
    pendingScoutApplications: count(3),
    publishedTitles: count(4),
    draftTitles: count(5),
    openReports: count(6),
    activeTakedowns: count(7),
    transcode: {
      queued: transcode.queued ?? 0,
      running: transcode.running ?? 0,
      failed: transcode.failed ?? 0,
    },
    totalPlays: totals.plays ?? 0,
    totalWatchHours: Math.round((totals.watch ?? 0) / 3600),
    pendingPayouts: count(10),
    revenueMillicents: count(11),
  };
  return c.json(payload);
});

// ---------------------------------------------------------------------------
// Scout applications
// ---------------------------------------------------------------------------

adminRoutes.get('/scout-applications', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT sp.user_id, u.display_name, u.email, sp.org_name, sp.org_url, sp.contact_email, sp.created_at
     FROM scout_profiles sp
     JOIN users u ON u.id = sp.user_id
     WHERE sp.status = 'pending'
     ORDER BY sp.created_at`,
  ).all<{
    user_id: string;
    display_name: string;
    email: string;
    org_name: string;
    org_url: string | null;
    contact_email: string;
    created_at: string;
  }>();

  const applications: AdminScoutApplication[] = results.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    orgName: row.org_name,
    orgUrl: row.org_url,
    contactEmail: row.contact_email,
    createdAt: row.created_at,
  }));
  return c.json({ applications });
});

adminRoutes.post('/scout-applications/:userId/decide', async (c) => {
  const body = await parseBody(c, scoutDecideSchema);
  const userId = c.req.param('userId');
  const row = await c.env.DB.prepare(
    "SELECT org_name FROM scout_profiles WHERE user_id = ? AND status = 'pending'",
  )
    .bind(userId)
    .first<{ org_name: string }>();
  if (!row) fail(404, 'application_not_found', 'No pending application for that user.');

  const status = body.approve ? 'approved' : 'rejected';
  await c.env.DB.prepare('UPDATE scout_profiles SET status = ?, decided_at = ? WHERE user_id = ?')
    .bind(status, nowIso(), userId)
    .run();
  await notify(
    c.env.DB,
    userId,
    'scout_decision',
    body.approve
      ? `Your scout application for ${row.org_name} was approved. The boards are open.`
      : `Your scout application for ${row.org_name} was not approved.`,
    body.approve ? '/scout' : null,
  );
  return c.json({ status });
});

// ---------------------------------------------------------------------------
// Reports and moderation
// ---------------------------------------------------------------------------

interface ReportRow {
  id: string;
  reason: ReportReason;
  note: string;
  created_at: string;
  title_id: string;
  title_name: string;
  slug: string;
  published: number;
  creator_id: string;
  creator_handle: string;
  creator_name: string;
  reporter_name: string;
  active_strikes: number;
}

adminRoutes.get('/reports', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.reason, r.note, r.created_at,
       t.id AS title_id, t.name AS title_name, t.slug, t.published,
       cu.id AS creator_id, cp.handle AS creator_handle, cu.display_name AS creator_name,
       ru.display_name AS reporter_name,
       (SELECT COUNT(*) FROM strikes s
        WHERE s.creator_id = cu.id AND s.revoked_at IS NULL AND s.created_at >= ?) AS active_strikes
     FROM reports r
     JOIN titles t ON t.id = r.title_id
     JOIN users cu ON cu.id = t.creator_id
     JOIN creator_profiles cp ON cp.user_id = cu.id
     JOIN users ru ON ru.id = r.reporter_id
     WHERE r.status = 'open'
     ORDER BY r.created_at
     LIMIT 100`,
  )
    .bind(strikeCutoffIso())
    .all<ReportRow>();

  const reports: AdminReport[] = results.map((row) => ({
    id: row.id,
    reason: row.reason,
    note: row.note,
    createdAt: row.created_at,
    title: { id: row.title_id, name: row.title_name, slug: row.slug, published: row.published === 1 },
    creator: {
      userId: row.creator_id,
      handle: row.creator_handle,
      displayName: row.creator_name,
      activeStrikes: row.active_strikes,
    },
    reporter: { displayName: row.reporter_name },
  }));
  return c.json({ reports });
});

adminRoutes.post('/reports/:reportId/resolve', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, reportResolveSchema);
  const report = await c.env.DB.prepare(
    `SELECT r.id, r.title_id, t.name AS title_name, t.creator_id
     FROM reports r JOIN titles t ON t.id = r.title_id
     WHERE r.id = ? AND r.status = 'open'`,
  )
    .bind(c.req.param('reportId'))
    .first<{ id: string; title_id: string; title_name: string; creator_id: string }>();
  if (!report) fail(404, 'report_not_found', 'No open report with that id.');

  const now = nowIso();
  const takedown = body.action === 'takedown' || body.action === 'takedown_and_strike';
  const strike = body.action === 'strike' || body.action === 'takedown_and_strike';
  const statements = [
    c.env.DB.prepare(
      'UPDATE reports SET status = ?, resolved_by = ?, resolution = ?, resolved_at = ? WHERE id = ?',
    ).bind(
      body.action === 'dismiss' ? 'dismissed' : 'resolved',
      admin.id,
      body.note ? `${body.action}: ${body.note}` : body.action,
      now,
      report.id,
    ),
  ];

  if (takedown) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO takedowns (id, title_id, kind, reason, report_id, issued_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        report.title_id,
        body.kind,
        body.note || `Resolved from a ${body.action} report action.`,
        report.id,
        admin.id,
        now,
      ),
      c.env.DB.prepare('UPDATE titles SET published = 0 WHERE id = ?').bind(report.title_id),
    );
  }
  if (strike) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO strikes (id, creator_id, reason, report_id, issued_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        report.creator_id,
        body.note || `Strike issued while resolving a report on ${report.title_name}.`,
        report.id,
        admin.id,
        now,
      ),
    );
  }
  await c.env.DB.batch(statements);

  if (takedown) {
    await notify(
      c.env.DB,
      report.creator_id,
      'takedown',
      `${report.title_name} was removed from the catalog (${body.kind === 'dmca' ? 'DMCA' : 'community guidelines'}). It cannot be republished until the takedown is released.`,
      '/studio',
    );
  }
  if (strike) {
    await notify(
      c.env.DB,
      report.creator_id,
      'strike',
      `A strike was issued on your account regarding ${report.title_name}. ${SUSPENSION_STRIKES} active strikes suspend publishing.`,
      '/studio',
    );
  }
  return c.json({ resolved: true, action: body.action });
});

// ---------------------------------------------------------------------------
// Takedowns
// ---------------------------------------------------------------------------

interface TakedownRow {
  id: string;
  kind: TakedownKind;
  reason: string;
  created_at: string;
  released_at: string | null;
  title_id: string;
  title_name: string;
  slug: string;
  creator_handle: string;
}

adminRoutes.get('/takedowns', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT td.id, td.kind, td.reason, td.created_at, td.released_at,
       t.id AS title_id, t.name AS title_name, t.slug, cp.handle AS creator_handle
     FROM takedowns td
     JOIN titles t ON t.id = td.title_id
     JOIN creator_profiles cp ON cp.user_id = t.creator_id
     WHERE td.released_at IS NULL
     ORDER BY td.created_at DESC
     LIMIT 100`,
  ).all<TakedownRow>();

  const takedowns: AdminTakedown[] = results.map((row) => ({
    id: row.id,
    kind: row.kind,
    reason: row.reason,
    createdAt: row.created_at,
    releasedAt: row.released_at,
    title: { id: row.title_id, name: row.title_name, slug: row.slug },
    creatorHandle: row.creator_handle,
  }));
  return c.json({ takedowns });
});

/** Direct takedown, no report required (admin-initiated, e.g. a DMCA notice by email). */
adminRoutes.post('/takedowns', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, takedownCreateSchema);
  const title = await c.env.DB.prepare('SELECT id, name, creator_id FROM titles WHERE slug = ?')
    .bind(body.slug)
    .first<{ id: string; name: string; creator_id: string }>();
  if (!title) fail(404, 'title_not_found', 'No title with that slug.');

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO takedowns (id, title_id, kind, reason, report_id, issued_by, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(crypto.randomUUID(), title.id, body.kind, body.reason, admin.id, nowIso()),
    c.env.DB.prepare('UPDATE titles SET published = 0 WHERE id = ?').bind(title.id),
  ]);
  await notify(
    c.env.DB,
    title.creator_id,
    'takedown',
    `${title.name} was removed from the catalog (${body.kind === 'dmca' ? 'DMCA' : 'community guidelines'}). It cannot be republished until the takedown is released.`,
    '/studio',
  );
  return c.json({ id: title.id }, 201);
});

adminRoutes.post('/takedowns/:takedownId/release', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT td.id, t.name AS title_name, t.creator_id
     FROM takedowns td JOIN titles t ON t.id = td.title_id
     WHERE td.id = ? AND td.released_at IS NULL`,
  )
    .bind(c.req.param('takedownId'))
    .first<{ id: string; title_name: string; creator_id: string }>();
  if (!row) fail(404, 'takedown_not_found', 'No active takedown with that id.');

  await c.env.DB.prepare('UPDATE takedowns SET released_at = ? WHERE id = ?')
    .bind(nowIso(), row.id)
    .run();
  await notify(
    c.env.DB,
    row.creator_id,
    'takedown_released',
    `The takedown on ${row.title_name} was released. You may republish it from your Studio.`,
    '/studio',
  );
  return c.json({ released: true });
});

// ---------------------------------------------------------------------------
// Strikes
// ---------------------------------------------------------------------------

adminRoutes.get('/strikes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.reason, s.created_at, cp.handle, u.display_name
     FROM strikes s
     JOIN users u ON u.id = s.creator_id
     JOIN creator_profiles cp ON cp.user_id = s.creator_id
     WHERE s.revoked_at IS NULL AND s.created_at >= ?
     ORDER BY s.created_at DESC
     LIMIT 100`,
  )
    .bind(strikeCutoffIso())
    .all<{ id: string; reason: string; created_at: string; handle: string; display_name: string }>();

  const strikes: AdminStrike[] = results.map((row) => ({
    id: row.id,
    reason: row.reason,
    createdAt: row.created_at,
    creator: { handle: row.handle, displayName: row.display_name },
  }));
  return c.json({ strikes });
});

adminRoutes.post('/strikes/:strikeId/revoke', async (c) => {
  const result = await c.env.DB.prepare(
    'UPDATE strikes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  )
    .bind(nowIso(), c.req.param('strikeId'))
    .run();
  if (result.meta.changes === 0) fail(404, 'strike_not_found', 'No active strike with that id.');
  return c.json({ revoked: true });
});

// ---------------------------------------------------------------------------
// Transcode queue health
// ---------------------------------------------------------------------------

adminRoutes.get('/transcode', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.status, j.attempts, j.error, j.updated_at,
       e.name AS episode_name, t.name AS title_name
     FROM transcode_jobs j
     JOIN episodes e ON e.id = j.episode_id
     JOIN titles t ON t.id = e.title_id
     WHERE j.status IN ('queued', 'running', 'failed')
     ORDER BY j.updated_at DESC
     LIMIT 50`,
  ).all<{
    id: string;
    status: TranscodeStatus;
    attempts: number;
    error: string | null;
    updated_at: string;
    episode_name: string;
    title_name: string;
  }>();

  const jobs: AdminTranscodeJob[] = results.map((row) => ({
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    updatedAt: row.updated_at,
    episodeName: row.episode_name,
    titleName: row.title_name,
  }));
  return c.json({ jobs });
});

adminRoutes.post('/transcode/:jobId/requeue', async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE transcode_jobs
     SET status = 'queued', attempts = 0, error = NULL, claimed_by = NULL, claimed_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'failed'`,
  )
    .bind(nowIso(), c.req.param('jobId'))
    .run();
  if (result.meta.changes === 0) fail(404, 'job_not_found', 'No failed job with that id.');
  return c.json({ requeued: true });
});

// ---------------------------------------------------------------------------
// Monetization
// ---------------------------------------------------------------------------

adminRoutes.get('/monetization', async (c) => {
  const [totalsRow, adsResult, payoutsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS impressions,
         COALESCE(SUM(revenue_millicents), 0) AS revenue,
         COALESCE(SUM(creator_millicents), 0) AS creator
       FROM ad_impressions`,
    ).first<{ impressions: number; revenue: number; creator: number }>(),
    c.env.DB.prepare(
      `SELECT a.id, a.sponsor, a.headline, a.media_url, a.click_url, a.duration_s, a.cpm_cents, a.active,
         COUNT(ai.id) AS impressions, COALESCE(SUM(ai.revenue_millicents), 0) AS revenue
       FROM ads a
       LEFT JOIN ad_impressions ai ON ai.ad_id = a.id
       GROUP BY a.id ORDER BY a.created_at DESC`,
    ).all<{
      id: string;
      sponsor: string;
      headline: string;
      media_url: string;
      click_url: string;
      duration_s: number;
      cpm_cents: number;
      active: number;
      impressions: number;
      revenue: number;
    }>(),
    c.env.DB.prepare(
      `SELECT p.id, p.amount_millicents, p.requested_at, cp.handle, u.display_name
       FROM payout_requests p
       JOIN users u ON u.id = p.creator_id
       JOIN creator_profiles cp ON cp.user_id = p.creator_id
       WHERE p.status = 'pending'
       ORDER BY p.requested_at`,
    ).all<{
      id: string;
      amount_millicents: number;
      requested_at: string;
      handle: string;
      display_name: string;
    }>(),
  ]);

  const totals = totalsRow ?? { impressions: 0, revenue: 0, creator: 0 };
  const ads: AdminAd[] = adsResult.results.map((row) => ({
    id: row.id,
    sponsor: row.sponsor,
    headline: row.headline,
    mediaUrl: row.media_url,
    clickUrl: row.click_url,
    durationS: row.duration_s,
    cpmCents: row.cpm_cents,
    active: row.active === 1,
    impressions: row.impressions,
    revenueMillicents: row.revenue,
  }));
  const pendingPayouts: AdminPayout[] = payoutsResult.results.map((row) => ({
    id: row.id,
    amountMillicents: row.amount_millicents,
    requestedAt: row.requested_at,
    creator: { handle: row.handle, displayName: row.display_name },
  }));

  const payload: AdminMonetization = {
    totals: {
      impressions: totals.impressions,
      revenueMillicents: totals.revenue,
      creatorMillicents: totals.creator,
      platformMillicents: totals.revenue - totals.creator,
    },
    ads,
    pendingPayouts,
  };
  return c.json(payload);
});

adminRoutes.post('/ads', async (c) => {
  const body = await parseBody(c, adCreateSchema);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO ads (id, sponsor, headline, media_url, click_url, duration_s, cpm_cents, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.sponsor,
      body.headline,
      body.mediaUrl,
      body.clickUrl,
      body.durationS,
      body.cpmCents,
      body.active ? 1 : 0,
      nowIso(),
    )
    .run();
  return c.json({ id }, 201);
});

adminRoutes.patch('/ads/:adId', async (c) => {
  const body = await parseBody(c, adUpdateSchema);
  const sets: string[] = [];
  const values: unknown[] = [];
  const columns: Record<string, unknown> = {
    sponsor: body.sponsor,
    headline: body.headline,
    media_url: body.mediaUrl,
    click_url: body.clickUrl,
    duration_s: body.durationS,
    cpm_cents: body.cpmCents,
    active: body.active === undefined ? undefined : body.active ? 1 : 0,
  };
  for (const [column, value] of Object.entries(columns)) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  const result = await c.env.DB.prepare(`UPDATE ads SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, c.req.param('adId'))
    .run();
  if (result.meta.changes === 0) fail(404, 'ad_not_found', 'No ad with that id.');
  return c.json({ ok: true });
});

adminRoutes.post('/payouts/:payoutId/decide', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, payoutDecideSchema);
  const payout = await c.env.DB.prepare(
    `SELECT p.id, p.creator_id, p.amount_millicents FROM payout_requests p
     WHERE p.id = ? AND p.status = 'pending'`,
  )
    .bind(c.req.param('payoutId'))
    .first<{ id: string; creator_id: string; amount_millicents: number }>();
  if (!payout) fail(404, 'payout_not_found', 'No pending payout with that id.');

  await c.env.DB.prepare(
    'UPDATE payout_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?',
  )
    .bind(body.paid ? 'paid' : 'rejected', nowIso(), admin.id, payout.id)
    .run();
  await notify(
    c.env.DB,
    payout.creator_id,
    'payout',
    body.paid
      ? `Your payout of ${formatMillicents(payout.amount_millicents)} was approved and marked paid.`
      : `Your payout request of ${formatMillicents(payout.amount_millicents)} was declined; the amount is back in your available balance.`,
    '/studio/earnings',
  );
  return c.json({ status: body.paid ? 'paid' : 'rejected' });
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

const GC_JOBS_PER_RUN = 20;

/**
 * Delete HLS outputs left behind by superseded, canceled, and failed jobs.
 * The episode's current job (the newest non-canceled one) is never touched.
 * Bounded per run to stay inside Worker limits; run again while `more`.
 */
adminRoutes.post('/maintenance/hls-gc', async (c) => {
  const { results: jobs } = await c.env.DB.prepare(
    `SELECT j.id, j.episode_id FROM transcode_jobs j
     WHERE j.cleaned_at IS NULL
       AND (j.status = 'canceled'
            OR (j.status IN ('done', 'failed') AND j.id != (
              SELECT id FROM transcode_jobs
              WHERE episode_id = j.episode_id AND status != 'canceled'
              ORDER BY created_at DESC LIMIT 1
            )))
     ORDER BY j.created_at
     LIMIT ${GC_JOBS_PER_RUN}`,
  ).all<{ id: string; episode_id: string }>();

  let deletedObjects = 0;
  for (const job of jobs) {
    const prefix = `hls/${job.episode_id}/${job.id}/`;
    const listing = await c.env.MEDIA.list({ prefix, limit: 1000 });
    if (listing.objects.length > 0) {
      await c.env.MEDIA.delete(listing.objects.map((object) => object.key));
      deletedObjects += listing.objects.length;
    }
    await c.env.DB.prepare('UPDATE transcode_jobs SET cleaned_at = ? WHERE id = ?')
      .bind(nowIso(), job.id)
      .run();
  }

  return c.json({
    sweptJobs: jobs.length,
    deletedObjects,
    more: jobs.length === GC_JOBS_PER_RUN,
  });
});
