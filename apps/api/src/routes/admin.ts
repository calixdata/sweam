import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  AdminAccount,
  AdminAd,
  AdminCommentReport,
  AdminMonetization,
  AdminOverview,
  AdminPayout,
  AdminRemovalRequest,
  AdminReport,
  AdminScoutApplication,
  AdminStrike,
  AdminSubmission,
  AdminTakedown,
  AdminTitleEpisodes,
  AdminTranscodeJob,
  AdminVerificationRequest,
  AdminVideoReplacement,
  AiSubmissionReview,
  MultipartInit,
  ClipReviewItem,
  CommentReportReason,
  ReportReason,
  TakedownKind,
  TranscodeStatus,
} from '@sweam/shared';
import { formatMillicents } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import { likeEscape } from '../lib/mappers';
import { notify } from '../lib/notify';
import { announceReleasedEpisodes } from '../lib/release';
import { applyVideoReplacement } from '../lib/replace';
import { requireAdmin, currentUser } from '../lib/session';
import { SUSPENSION_STRIKES, strikeCutoffIso } from '../lib/standing';
import {
  MAX_PART_BYTES,
  MAX_UPLOAD_BYTES,
  MULTIPART_PART_SIZE,
  mediaKeyFor,
  resolveUploadContentType,
} from './studio';
import {
  adCreateSchema,
  adUpdateSchema,
  adminUserSearchSchema,
  clipDecideSchema,
  commentReportResolveSchema,
  multipartAbortSchema,
  multipartCompleteSchema,
  multipartInitSchema,
  payoutDecideSchema,
  removalDecideSchema,
  replaceDecideSchema,
  replaceVideoSchema,
  reportResolveSchema,
  scoutDecideSchema,
  submissionDecideSchema,
  submissionStatusSchema,
  suppressSchema,
  takedownCreateSchema,
  verificationDecideSchema,
  verifiedToggleSchema,
} from '../lib/validate';
import { grantFreeMembership } from '../lib/scoutMembership';
import { cancelSubscription, stripeConfigured } from '../lib/stripe';
import { AiReviewError, aiReviewConfigured, reviewSubmission } from '../lib/aiReview';
import { PublishError, publishSubmission, type PublishableSubmission } from '../lib/publish';
import { SUBMISSION_SELECT, mapSubmission, type SubmissionRow } from './submissions';

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
    // Scout applications needing an admin look: unpaid (pending) + auto-approved (provisional).
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM scout_profiles WHERE status = 'pending' OR (status = 'approved' AND provisional = 1)",
    ),
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
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM clip_reviews WHERE state IN ('pending', 'flagged')"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM identity_verifications WHERE status = 'pending'"),
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
    pendingSubmissions: count(12),
    pendingClips: count(13),
    pendingVerifications: count(14),
  };
  return c.json(payload);
});

// ---------------------------------------------------------------------------
// Submissions review
// ---------------------------------------------------------------------------

const SUBMISSION_STATUSES = ['pending', 'under_review', 'accepted', 'declined', 'withdrawn'] as const;

adminRoutes.get('/submissions', async (c) => {
  const requested = c.req.query('status');
  // No filter defaults to the open queue; ?status=all shows every state; a
  // valid status shows just that column.
  let filter = "WHERE s.status IN ('pending', 'under_review')";
  if (requested === 'all') filter = '';
  else if ((SUBMISSION_STATUSES as readonly string[]).includes(requested ?? '')) {
    filter = `WHERE s.status = '${requested}'`;
  }
  const { results } = await c.env.DB.prepare(
    `SELECT ${SUBMISSION_SELECT}, s.ai_review, u.display_name, u.email, cp.handle
     FROM submissions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN creator_profiles cp ON cp.user_id = s.user_id
     LEFT JOIN series se ON se.id = s.series_id
     ${filter}
     ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,
       s.created_at DESC
     LIMIT 200`,
  ).all<
    SubmissionRow & {
      ai_review: string | null;
      display_name: string;
      email: string;
      handle: string | null;
    }
  >();

  const submissions: AdminSubmission[] = results.map((row) => ({
    ...mapSubmission(row),
    submitter: { displayName: row.display_name, email: row.email, handle: row.handle },
    aiReview: row.ai_review ? (JSON.parse(row.ai_review) as AiSubmissionReview) : null,
  }));
  return c.json({ submissions });
});

/** Triage a submission between Received and Under review without deciding it. */
adminRoutes.post('/submissions/:submissionId/status', async (c) => {
  const body = await parseBody(c, submissionStatusSchema);
  const result = await c.env.DB.prepare(
    `UPDATE submissions SET status = ?, reviewer_id = ?, updated_at = ?
     WHERE id = ? AND status IN ('pending', 'under_review')`,
  )
    .bind(body.status, currentUser(c).id, nowIso(), c.req.param('submissionId'))
    .run();
  if (result.meta.changes === 0) fail(404, 'submission_not_found', 'No open submission with that id.');
  return c.json({ status: body.status });
});

adminRoutes.post('/submissions/:submissionId/decide', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, submissionDecideSchema);
  const submission = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.title_name, s.kind, s.genre, s.audiences, s.genres, s.subgenres,
       s.rating, s.synopsis, s.source_url, s.captions_url, s.series_id, s.poster_url, s.release_date,
       u.display_name
     FROM submissions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.status IN ('pending', 'under_review')`,
  )
    .bind(c.req.param('submissionId'))
    .first<PublishableSubmission & { display_name: string }>();
  if (!submission) fail(404, 'submission_not_found', 'No open submission with that id.');

  const now = nowIso();
  if (body.accept) {
    let published;
    try {
      published = await publishSubmission(c.env, submission, submission.display_name);
    } catch (err) {
      if (err instanceof PublishError) fail(422, 'cannot_publish', err.message);
      throw err;
    }
    await c.env.DB.prepare(
      'UPDATE submissions SET status = ?, note = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE id = ?',
    )
      .bind('accepted', body.note, now, admin.id, now, submission.id)
      .run();
    await notify(
      c.env.DB,
      submission.user_id,
      'submission',
      `Your submission "${submission.title_name}" was accepted and is now live on Sweam.${body.note ? ` Reviewer note: ${body.note}` : ''}`,
      `/t/${published.slug}`,
    );
    return c.json({ status: 'accepted', slug: published.slug });
  }

  await c.env.DB.prepare(
    'UPDATE submissions SET status = ?, note = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE id = ?',
  )
    .bind('declined', body.note, now, admin.id, now, submission.id)
    .run();
  await notify(
    c.env.DB,
    submission.user_id,
    'submission',
    `Your submission "${submission.title_name}" was not selected this time.${body.note ? ` Reviewer note: ${body.note}` : ''}`,
    '/submit',
  );
  return c.json({ status: 'declined' });
});

// ---------------------------------------------------------------------------
// Removal requests (creators can ask Sweam to take a live title down)
// ---------------------------------------------------------------------------

adminRoutes.get('/removal-requests', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.reason, r.created_at,
       t.id AS title_id, t.name AS title_name, t.slug,
       u.display_name, cp.handle
     FROM removal_requests r
     JOIN titles t ON t.id = r.title_id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN creator_profiles cp ON cp.user_id = r.user_id
     WHERE r.status = 'open'
     ORDER BY r.created_at
     LIMIT 100`,
  ).all<{
    id: string;
    reason: string;
    created_at: string;
    title_id: string;
    title_name: string;
    slug: string;
    display_name: string;
    handle: string | null;
  }>();

  const requests: AdminRemovalRequest[] = results.map((row) => ({
    id: row.id,
    reason: row.reason,
    createdAt: row.created_at,
    title: { id: row.title_id, name: row.title_name, slug: row.slug },
    creator: { displayName: row.display_name, handle: row.handle },
  }));
  return c.json({ requests });
});

adminRoutes.post('/removal-requests/:requestId/decide', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, removalDecideSchema);
  const request = await c.env.DB.prepare(
    `SELECT r.id, r.title_id, r.user_id, t.name AS title_name
     FROM removal_requests r JOIN titles t ON t.id = r.title_id
     WHERE r.id = ? AND r.status = 'open'`,
  )
    .bind(c.req.param('requestId'))
    .first<{ id: string; title_id: string; user_id: string; title_name: string }>();
  if (!request) fail(404, 'request_not_found', 'No open removal request with that id.');

  const now = nowIso();
  if (body.remove) {
    // Only Sweam can remove: delete the title (episodes cascade) and settle the request.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM titles WHERE id = ?').bind(request.title_id),
      c.env.DB.prepare(
        "UPDATE removal_requests SET status = 'removed', decided_at = ?, decided_by = ? WHERE id = ?",
      ).bind(now, admin.id, request.id),
    ]);
    await notify(
      c.env.DB,
      request.user_id,
      'takedown',
      `Your removal request for "${request.title_name}" was completed; it is no longer on Sweam.${body.note ? ` Note: ${body.note}` : ''}`,
    );
    return c.json({ status: 'removed' });
  }

  await c.env.DB.prepare(
    "UPDATE removal_requests SET status = 'declined', decided_at = ?, decided_by = ? WHERE id = ?",
  )
    .bind(now, admin.id, request.id)
    .run();
  await notify(
    c.env.DB,
    request.user_id,
    'takedown_released',
    `Your removal request for "${request.title_name}" was reviewed and the title will stay on Sweam.${body.note ? ` Note: ${body.note}` : ''}`,
  );
  return c.json({ status: 'declined' });
});

// ---------------------------------------------------------------------------
// Instant clip review queue (posted live, reviewed after)
// ---------------------------------------------------------------------------

interface ClipReviewRow {
  id: string;
  state: ClipReviewItem['state'];
  caption: string;
  created_at: string;
  ai_review: string | null;
  ai_error: string | null;
  decided_at: string | null;
  title_id: string;
  title_name: string;
  slug: string;
  published: number;
  episode_id: string;
  display_name: string;
  handle: string | null;
}

function mapClipReview(row: ClipReviewRow): ClipReviewItem {
  let ai: AiSubmissionReview | null = null;
  if (row.ai_review) {
    try {
      ai = JSON.parse(row.ai_review) as AiSubmissionReview;
    } catch {
      ai = null;
    }
  }
  return {
    id: row.id,
    state: row.state,
    caption: row.caption,
    createdAt: row.created_at,
    title: { id: row.title_id, name: row.title_name, slug: row.slug, published: row.published === 1 },
    episodeId: row.episode_id,
    creator: { displayName: row.display_name, handle: row.handle },
    ai,
    aiError: row.ai_error,
    decidedAt: row.decided_at,
  };
}

/** The open clip queue: flagged (hidden, needs a call) first, then pending. */
adminRoutes.get('/clip-reviews', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cr.id, cr.state, cr.caption, cr.created_at, cr.ai_review, cr.ai_error, cr.decided_at,
       cr.episode_id, t.id AS title_id, t.name AS title_name, t.slug, t.published,
       u.display_name, cp.handle
     FROM clip_reviews cr
     JOIN titles t ON t.id = cr.title_id
     JOIN users u ON u.id = cr.creator_id
     LEFT JOIN creator_profiles cp ON cp.user_id = cr.creator_id
     WHERE cr.state IN ('pending', 'flagged')
     ORDER BY (cr.state = 'flagged') DESC, cr.created_at
     LIMIT 100`,
  ).all<ClipReviewRow>();
  return c.json({ clips: results.map(mapClipReview) });
});

/** Clear a clip (keep it live) or remove it (hide it). Only Sweam decides. */
adminRoutes.post('/clip-reviews/:reviewId/decide', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, clipDecideSchema);
  const review = await c.env.DB.prepare(
    `SELECT cr.id, cr.title_id, cr.creator_id, t.name AS title_name, t.slug
     FROM clip_reviews cr JOIN titles t ON t.id = cr.title_id
     WHERE cr.id = ? AND cr.state IN ('pending', 'flagged')`,
  )
    .bind(c.req.param('reviewId'))
    .first<{ id: string; title_id: string; creator_id: string; title_name: string; slug: string }>();
  if (!review) fail(404, 'clip_not_found', 'No open clip review with that id.');

  const now = nowIso();
  if (body.action === 'remove') {
    await c.env.DB.batch([
      c.env.DB
        .prepare("UPDATE titles SET published = 0, review_state = 'removed' WHERE id = ?")
        .bind(review.title_id),
      c.env.DB
        .prepare(
          "UPDATE clip_reviews SET state = 'removed', decided_by = ?, decided_at = ? WHERE id = ?",
        )
        .bind(admin.id, now, review.id),
    ]);
    await notify(
      c.env.DB,
      review.creator_id,
      'takedown',
      `Your clip "${review.title_name}" was removed by Sweam for a Community Guidelines issue.${body.note ? ` Note: ${body.note}` : ''} Posting prohibited content can cost you your account.`,
    );
    return c.json({ status: 'removed' });
  }

  await c.env.DB.batch([
    c.env.DB
      .prepare("UPDATE titles SET published = 1, review_state = 'cleared' WHERE id = ?")
      .bind(review.title_id),
    c.env.DB
      .prepare(
        "UPDATE clip_reviews SET state = 'cleared', decided_by = ?, decided_at = ? WHERE id = ?",
      )
      .bind(admin.id, now, review.id),
  ]);
  return c.json({ status: 'cleared' });
});

/** AI-assisted triage: Claude assesses the described work against the guidelines. */
adminRoutes.post('/submissions/:submissionId/ai-review', async (c) => {
  if (!aiReviewConfigured(c.env)) {
    fail(503, 'ai_off', 'AI review is not configured. Set the ANTHROPIC_API_KEY secret to enable it.');
  }
  const row = await c.env.DB.prepare(
    'SELECT id, title_name, kind, genre, synopsis, source_url, verbatiim_project_id FROM submissions WHERE id = ?',
  )
    .bind(c.req.param('submissionId'))
    .first<{
      id: string;
      title_name: string;
      kind: string;
      genre: string;
      synopsis: string;
      source_url: string | null;
      verbatiim_project_id: string | null;
    }>();
  if (!row) fail(404, 'submission_not_found', 'No submission with that id.');

  const hosting = row.verbatiim_project_id
    ? 'Imported from Verbatiim, hosted on Sweam'
    : row.source_url
      ? 'Uploaded to Sweam'
      : 'External screener link';
  let review: AiSubmissionReview;
  try {
    review = await reviewSubmission(c.env, {
      titleName: row.title_name,
      kind: row.kind,
      genre: row.genre,
      synopsis: row.synopsis,
      hosting,
    });
  } catch (err) {
    if (err instanceof AiReviewError) fail(502, 'ai_failed', err.message);
    throw err;
  }
  await c.env.DB.prepare(
    'UPDATE submissions SET ai_review = ?, ai_reviewed_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind(JSON.stringify(review), review.reviewedAt, nowIso(), row.id)
    .run();
  return c.json({ review });
});

// ---------------------------------------------------------------------------
// Scout applications
// ---------------------------------------------------------------------------

/**
 * Scout applications that need an admin look. Approval is automatic and
 * provisional once an applicant accepts the terms and puts a card on file, so
 * this lists (a) provisional scouts to confirm or revoke and (b) applications
 * still waiting on a card.
 */
adminRoutes.get('/scout-applications', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT sp.user_id, u.display_name, u.email, sp.org_name, sp.org_url, sp.contact_email, sp.created_at,
       sp.first_name, sp.last_name, sp.position, sp.work_email, sp.status, sp.provisional, sp.beta_free
     FROM scout_profiles sp
     JOIN users u ON u.id = sp.user_id
     WHERE sp.status = 'pending' OR (sp.status = 'approved' AND sp.provisional = 1)
     ORDER BY sp.created_at`,
  ).all<{
    user_id: string;
    display_name: string;
    email: string;
    org_name: string;
    org_url: string | null;
    contact_email: string;
    created_at: string;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
    work_email: string | null;
    status: 'pending' | 'approved';
    provisional: number;
    beta_free: number;
  }>();

  const applications: AdminScoutApplication[] = results.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    orgName: row.org_name,
    orgUrl: row.org_url,
    contactEmail: row.contact_email,
    createdAt: row.created_at,
    firstName: row.first_name,
    lastName: row.last_name,
    position: row.position,
    workEmail: row.work_email,
    status: row.status,
    provisional: row.provisional === 1,
    betaFree: row.beta_free === 1,
  }));
  return c.json({ applications });
});

/**
 * Confirm or revoke a scout. Approving clears the provisional flag, or manually
 * approves an application that never added a card: that scout's membership
 * (which includes Blu all-access) starts as a first-50 free period when seats
 * remain, otherwise it needs a card. Rejecting revokes access and cancels any
 * live Stripe subscription so a revoked scout is not billed.
 */
adminRoutes.post('/scout-applications/:userId/decide', async (c) => {
  const body = await parseBody(c, scoutDecideSchema);
  const userId = c.req.param('userId');
  const row = await c.env.DB.prepare(
    `SELECT org_name, status FROM scout_profiles
     WHERE user_id = ? AND (status = 'pending' OR (status = 'approved' AND provisional = 1))`,
  )
    .bind(userId)
    .first<{ org_name: string; status: 'pending' | 'approved' }>();
  if (!row) fail(404, 'application_not_found', 'No scout application awaiting review for that user.');

  // Approval without a card on file: start the free membership so access is real.
  let freeUntil: string | null = null;
  if (body.approve && row.status === 'pending') {
    freeUntil = await grantFreeMembership(c.env.DB, userId);
  }

  const now = nowIso();
  let billingWarning: string | null = null;
  if (!body.approve) {
    const access = await c.env.DB.prepare(
      "SELECT stripe_subscription_id FROM scout_all_access WHERE user_id = ? AND status IN ('active', 'past_due')",
    )
      .bind(userId)
      .first<{ stripe_subscription_id: string | null }>();
    if (access?.stripe_subscription_id && stripeConfigured(c.env)) {
      try {
        await cancelSubscription(c.env, access.stripe_subscription_id);
      } catch (err) {
        // Revoking is a safety action, so it still goes through; the admin is told to cancel in Stripe.
        billingWarning = err instanceof Error ? err.message : 'Stripe cancellation failed.';
      }
    }
    await c.env.DB.prepare(
      "UPDATE scout_all_access SET status = 'canceled', canceled_at = ? WHERE user_id = ? AND status != 'canceled'",
    )
      .bind(now, userId)
      .run();
  }

  const status = body.approve ? 'approved' : 'rejected';
  await c.env.DB.prepare(
    'UPDATE scout_profiles SET status = ?, provisional = 0, decided_at = ? WHERE user_id = ?',
  )
    .bind(status, now, userId)
    .run();

  const wasProvisional = row.status === 'approved';
  const message = body.approve
    ? wasProvisional
      ? `Your scout access for ${row.org_name} has been confirmed.`
      : freeUntil
        ? `Your scout application for ${row.org_name} was approved. As one of the first 50 Scouts your membership, including all Blu content, is free until ${freeUntil.slice(0, 10)}.`
        : `Your scout application for ${row.org_name} was approved. Add a card in the scout portal to start your membership.`
    : wasProvisional
      ? `Your scout access for ${row.org_name} was revoked and your membership canceled.`
      : `Your scout application for ${row.org_name} was not approved.`;
  await notify(c.env.DB, userId, 'scout_decision', message, body.approve ? '/scout' : null);
  return c.json({ status, billingWarning, freeUntil });
});

// ---------------------------------------------------------------------------
// Accounts: search + the verified check (staff can grant it directly)
// ---------------------------------------------------------------------------

interface AdminAccountRow {
  id: string;
  display_name: string;
  username: string | null;
  email: string;
  verified: number;
  verified_at: string | null;
  official: number;
  is_demo: number;
  is_creator: number;
  created_at: string;
}

function mapAdminAccount(row: AdminAccountRow): AdminAccount {
  return {
    id: row.id,
    displayName: row.display_name,
    username: row.username,
    email: row.email,
    verified: row.verified === 1,
    verifiedAt: row.verified_at,
    official: row.official === 1,
    isDemo: row.is_demo === 1,
    isCreator: row.is_creator === 1,
    createdAt: row.created_at,
  };
}

const ADMIN_ACCOUNT_SELECT = `u.id, u.display_name, u.username, u.email, u.verified, u.verified_at,
  u.official, u.is_demo, (cp.user_id IS NOT NULL) AS is_creator, u.created_at
  FROM users u LEFT JOIN creator_profiles cp ON cp.user_id = u.id`;

/** Find accounts by username, display name, or email (exact username first). */
adminRoutes.get('/users', async (c) => {
  const parsed = adminUserSearchSchema.safeParse({ q: c.req.query('q') ?? '' });
  if (!parsed.success) fail(400, 'validation_failed', parsed.error.issues[0]?.message ?? 'Invalid search.');
  const term = parsed.data.q.replace(/^@+/, '').trim();
  const pattern = `%${likeEscape(term)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT ${ADMIN_ACCOUNT_SELECT}
     WHERE u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'
     ORDER BY (lower(u.username) = lower(?)) DESC, (lower(u.email) = lower(?)) DESC, u.created_at DESC
     LIMIT 25`,
  )
    .bind(pattern, pattern, pattern, term, term)
    .all<AdminAccountRow>();
  return c.json({ accounts: results.map(mapAdminAccount) });
});

/**
 * Grant or remove the verified check by hand. Granting also closes any
 * document request still waiting for that account (approved, documents
 * deleted) so the queue and the account never disagree.
 */
adminRoutes.post('/users/:userId/verified', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, verifiedToggleSchema);
  const userId = c.req.param('userId');
  const target = await c.env.DB.prepare('SELECT id, verified FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; verified: number }>();
  if (!target) fail(404, 'user_not_found', 'No account with that id.');

  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        body.verified && body.verifiedSex
          ? 'UPDATE users SET verified = ?, verified_at = ?, verified_sex = ? WHERE id = ?'
          : 'UPDATE users SET verified = ?, verified_at = ? WHERE id = ?',
      )
      .bind(
        ...(body.verified && body.verifiedSex
          ? [1, now, body.verifiedSex, userId]
          : [body.verified ? 1 : 0, body.verified ? now : null, userId]),
      ),
    c.env.DB
      .prepare('UPDATE creator_profiles SET verified = ? WHERE user_id = ?')
      .bind(body.verified ? 1 : 0, userId),
  ]);

  if (body.verified) {
    const { results: pending } = await c.env.DB.prepare(
      "SELECT id, id_doc_key, address_doc_key FROM identity_verifications WHERE user_id = ? AND status = 'pending'",
    )
      .bind(userId)
      .all<{ id: string; id_doc_key: string; address_doc_key: string }>();
    for (const request of pending) {
      await c.env.DB.prepare(
        "UPDATE identity_verifications SET status = 'approved', note = 'Verified by Sweam staff.', reviewer_id = ?, decided_at = ? WHERE id = ?",
      )
        .bind(admin.id, now, request.id)
        .run();
      await Promise.allSettled([
        c.env.MEDIA.delete(request.id_doc_key),
        c.env.MEDIA.delete(request.address_doc_key),
      ]);
    }
  }

  const changed = (target.verified === 1) !== body.verified;
  if (changed) {
    await notify(
      c.env.DB,
      userId,
      'verification',
      body.verified
        ? 'Your account is now verified. The verified check shows next to your name across Sweam.'
        : 'The verified check was removed from your account.',
      '/settings',
    );
  }
  const row = await c.env.DB.prepare(`SELECT ${ADMIN_ACCOUNT_SELECT} WHERE u.id = ?`)
    .bind(userId)
    .first<AdminAccountRow>();
  return c.json({ account: row ? mapAdminAccount(row) : null });
});

// ---------------------------------------------------------------------------
// Identity verification queue
// ---------------------------------------------------------------------------

adminRoutes.get('/verifications', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.user_id, v.legal_name, v.id_doc_key, v.address_doc_key, v.created_at,
       u.display_name, u.username, u.email, u.sex
     FROM identity_verifications v JOIN users u ON u.id = v.user_id
     WHERE v.status = 'pending'
     ORDER BY v.created_at`,
  ).all<{
    id: string;
    user_id: string;
    legal_name: string;
    id_doc_key: string;
    address_doc_key: string;
    created_at: string;
    display_name: string;
    username: string | null;
    email: string;
    sex: 'female' | 'male' | 'nonbinary' | 'undisclosed';
  }>();
  const requests: AdminVerificationRequest[] = results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    email: row.email,
    legalName: row.legal_name,
    idDocUrl: `/media/${row.id_doc_key}`,
    addressDocUrl: `/media/${row.address_doc_key}`,
    createdAt: row.created_at,
    declaredSex: row.sex,
  }));
  return c.json({ requests });
});

/**
 * Approve or reject an identity verification. Approval marks the account
 * verified (the pink check). Either way the documents are deleted from
 * storage: Sweam keeps the decision, not the papers.
 */
adminRoutes.post('/verifications/:id/decide', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, verificationDecideSchema);
  const row = await c.env.DB.prepare(
    "SELECT id, user_id, id_doc_key, address_doc_key FROM identity_verifications WHERE id = ? AND status = 'pending'",
  )
    .bind(c.req.param('id'))
    .first<{ id: string; user_id: string; id_doc_key: string; address_doc_key: string }>();
  if (!row) fail(404, 'verification_not_found', 'No pending verification request with that id.');

  const now = nowIso();
  const status = body.approve ? 'approved' : 'rejected';
  const statements = [
    c.env.DB
      .prepare(
        'UPDATE identity_verifications SET status = ?, note = ?, reviewer_id = ?, decided_at = ?, sex = ? WHERE id = ?',
      )
      .bind(status, body.note || null, admin.id, now, body.sex ?? null, row.id),
  ];
  if (body.approve) {
    statements.push(
      body.sex
        ? c.env.DB.prepare('UPDATE users SET verified = 1, verified_at = ?, verified_sex = ? WHERE id = ?').bind(now, body.sex, row.user_id)
        : c.env.DB.prepare('UPDATE users SET verified = 1, verified_at = ? WHERE id = ?').bind(now, row.user_id),
      c.env.DB.prepare('UPDATE creator_profiles SET verified = 1 WHERE user_id = ?').bind(row.user_id),
    );
  }
  await c.env.DB.batch(statements);
  await Promise.allSettled([c.env.MEDIA.delete(row.id_doc_key), c.env.MEDIA.delete(row.address_doc_key)]);

  await notify(
    c.env.DB,
    row.user_id,
    'verification',
    body.approve
      ? 'Your identity is verified. Your account now carries the verified check.'
      : `Your verification request was not approved${body.note ? `: ${body.note}` : '.'} You can submit it again from Settings.`,
    '/settings',
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
// Comment reports
// ---------------------------------------------------------------------------

adminRoutes.get('/comment-reports', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cr.id, cr.reason, cr.created_at,
       co.id AS comment_id, co.body, u.display_name AS author_name,
       t.name AS title_name, t.slug AS title_slug,
       ru.display_name AS reporter_name
     FROM comment_reports cr
     JOIN comments co ON co.id = cr.comment_id
     JOIN users u ON u.id = co.author_id
     JOIN titles t ON t.id = co.title_id
     JOIN users ru ON ru.id = cr.reporter_id
     WHERE cr.status = 'open' AND co.status = 'visible'
     ORDER BY cr.created_at
     LIMIT 100`,
  ).all<{
    id: string;
    reason: CommentReportReason;
    created_at: string;
    comment_id: string;
    body: string;
    author_name: string;
    title_name: string;
    title_slug: string;
    reporter_name: string;
  }>();

  const reports: AdminCommentReport[] = results.map((row) => ({
    id: row.id,
    reason: row.reason,
    createdAt: row.created_at,
    comment: {
      id: row.comment_id,
      body: row.body,
      authorName: row.author_name,
      titleName: row.title_name,
      titleSlug: row.title_slug,
    },
    reporter: { displayName: row.reporter_name },
  }));
  return c.json({ reports });
});

adminRoutes.post('/comment-reports/:reportId/resolve', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, commentReportResolveSchema);
  const report = await c.env.DB.prepare(
    `SELECT cr.id, cr.comment_id, co.author_id, t.name AS title_name
     FROM comment_reports cr
     JOIN comments co ON co.id = cr.comment_id
     JOIN titles t ON t.id = co.title_id
     WHERE cr.id = ? AND cr.status = 'open'`,
  )
    .bind(c.req.param('reportId'))
    .first<{ id: string; comment_id: string; author_id: string; title_name: string }>();
  if (!report) fail(404, 'report_not_found', 'No open comment report with that id.');

  const now = nowIso();
  if (body.action === 'remove') {
    // Removing the comment settles every open report against it at once.
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE comments SET status = 'removed_by_admin' WHERE id = ?").bind(
        report.comment_id,
      ),
      c.env.DB.prepare(
        `UPDATE comment_reports SET status = 'resolved', resolved_by = ?, resolved_at = ?
         WHERE comment_id = ? AND status = 'open'`,
      ).bind(admin.id, now, report.comment_id),
    ]);
    await notify(
      c.env.DB,
      report.author_id,
      'comment',
      `Your comment on ${report.title_name} was removed by moderators.`,
    );
  } else {
    await c.env.DB.prepare(
      `UPDATE comment_reports SET status = 'dismissed', resolved_by = ?, resolved_at = ? WHERE id = ?`,
    )
      .bind(admin.id, now, report.id)
      .run();
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
         a.category, a.target_genre,
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
      category: string;
      target_genre: string | null;
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
    category: row.category,
    targetGenre: row.target_genre,
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
    `INSERT INTO ads (id, sponsor, headline, media_url, click_url, duration_s, cpm_cents, active, category, target_genre, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      body.category,
      body.targetGenre,
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
    category: body.category,
    target_genre: body.targetGenre,
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
// In-place video replacement
// ---------------------------------------------------------------------------

/** Admin upload for a replacement video (admins may not be creators). */
adminRoutes.put('/upload/:filename', async (c) => {
  const filename = c.req.param('filename');
  const contentType = resolveUploadContentType(c.req.header('content-type'), filename);
  if (!contentType) {
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
  const key = mediaKeyFor(currentUser(c).id, filename);
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ url: `/media/${key}` }, 201);
});

// Multipart admin upload — a full episode exceeds the Worker request-body limit,
// so large replacement videos go up in parts (mirrors the Studio uploader).
function assertAdminKey(c: Context<AppEnv>, key: string): void {
  if (!key.startsWith(`u/${currentUser(c).id}/`)) {
    fail(404, 'upload_not_found', 'No such upload.');
  }
}

adminRoutes.post('/upload/multipart', async (c) => {
  const body = await parseBody(c, multipartInitSchema);
  const contentType = resolveUploadContentType(body.contentType, body.filename);
  if (!contentType) {
    fail(415, 'unsupported_type', 'Upload MP4/WebM video, WebVTT captions, or JPEG/PNG/WebP images.');
  }
  const key = mediaKeyFor(currentUser(c).id, body.filename);
  const upload = await c.env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType } });
  const payload: MultipartInit = { key, uploadId: upload.uploadId, partSize: MULTIPART_PART_SIZE };
  return c.json(payload, 201);
});

adminRoutes.put('/upload/multipart/part', async (c) => {
  const key = c.req.query('key') ?? '';
  const uploadId = c.req.query('uploadId') ?? '';
  const partNumber = Number(c.req.query('partNumber') ?? '0');
  assertAdminKey(c, key);
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

adminRoutes.post('/upload/multipart/complete', async (c) => {
  const body = await parseBody(c, multipartCompleteSchema);
  assertAdminKey(c, body.key);
  const upload = c.env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
  try {
    await upload.complete(body.parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })));
  } catch {
    fail(409, 'upload_gone', 'That multipart upload could not be completed; start it again.');
  }
  return c.json({ url: `/media/${body.key}` }, 201);
});

adminRoutes.post('/upload/multipart/abort', async (c) => {
  const body = await parseBody(c, multipartAbortSchema);
  assertAdminKey(c, body.key);
  const upload = c.env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
  try {
    await upload.abort();
  } catch {
    // Aborting an already-gone upload is success from the client's view.
  }
  return c.json({ aborted: true });
});

/** Look up a title's episodes by slug, for the admin video-swap tool. */
adminRoutes.get('/titles/:slug/episodes', async (c) => {
  const title = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.published, t.suppressed, cp.handle FROM titles t
     LEFT JOIN creator_profiles cp ON cp.user_id = t.creator_id WHERE t.slug = ?`,
  )
    .bind(c.req.param('slug'))
    .first<{ id: string; name: string; slug: string; published: number; suppressed: number; handle: string | null }>();
  if (!title) fail(404, 'title_not_found', 'No title with that slug.');
  const { results } = await c.env.DB.prepare(
    'SELECT id, season, episode, name, duration_s FROM episodes WHERE title_id = ? ORDER BY season, episode',
  )
    .bind(title.id)
    .all<{ id: string; season: number; episode: number; name: string; duration_s: number }>();
  const payload: AdminTitleEpisodes = {
    title: {
      id: title.id,
      name: title.name,
      slug: title.slug,
      creatorHandle: title.handle,
      published: title.published === 1,
      suppressed: title.suppressed === 1,
    },
    episodes: results.map((e) => ({
      id: e.id,
      season: e.season,
      episode: e.episode,
      name: e.name,
      durationS: e.duration_s,
    })),
  };
  return c.json(payload);
});

/**
 * Suppress or unsuppress a title (investigation hold). Suppressing hides it
 * from every public surface (all of which filter published = 1) and freezes the
 * creator out of changing its visibility or deleting it, without issuing a
 * takedown or strike. Unsuppressing republishes it. Silent: no creator notice.
 */
adminRoutes.post('/titles/:slug/suppress', async (c) => {
  const body = await parseBody(c, suppressSchema);
  const title = await c.env.DB.prepare(
    'SELECT id, published, suppressed FROM titles WHERE slug = ?',
  )
    .bind(c.req.param('slug'))
    .first<{ id: string; published: number; suppressed: number }>();
  if (!title) fail(404, 'title_not_found', 'No title with that slug.');

  if (body.suppress) {
    if (title.suppressed === 1) {
      return c.json({ suppressed: true, published: title.published === 1 });
    }
    if (title.published !== 1) {
      fail(409, 'not_live', 'Only a currently-live title can be suppressed.');
    }
    await c.env.DB.prepare('UPDATE titles SET suppressed = 1, published = 0 WHERE id = ?')
      .bind(title.id)
      .run();
    return c.json({ suppressed: true, published: false });
  }

  if (title.suppressed !== 1) {
    return c.json({ suppressed: false, published: title.published === 1 });
  }
  await c.env.DB.prepare('UPDATE titles SET suppressed = 0, published = 1 WHERE id = ?')
    .bind(title.id)
    .run();
  return c.json({ suppressed: false, published: true });
});

/** Swap an episode's live video directly (admin), then notify the creator. */
adminRoutes.post('/episodes/:episodeId/replace-video', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, replaceVideoSchema);
  const ep = await c.env.DB.prepare(
    `SELECT e.id, e.title_id, e.season, e.episode, t.creator_id, t.name AS title_name, t.slug
     FROM episodes e JOIN titles t ON t.id = e.title_id WHERE e.id = ?`,
  )
    .bind(c.req.param('episodeId'))
    .first<{
      id: string;
      title_id: string;
      season: number;
      episode: number;
      creator_id: string;
      title_name: string;
      slug: string;
    }>();
  if (!ep) fail(404, 'episode_not_found', 'No such episode.');

  const now = nowIso();
  await applyVideoReplacement(c.env, ep.id, body.sourceUrl, body.captionsUrl);
  await c.env.DB.prepare(
    `INSERT INTO video_replacements
       (id, episode_id, title_id, creator_id, requested_by, kind, source_url, captions_url, note, status, created_at, decided_at, decided_by)
     VALUES (?, ?, ?, ?, ?, 'admin_direct', ?, ?, '', 'applied', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), ep.id, ep.title_id, ep.creator_id, admin.id, body.sourceUrl, body.captionsUrl, now, now, admin.id)
    .run();
  await notify(
    c.env.DB,
    ep.creator_id,
    'video_update',
    `An admin updated the video for ${ep.title_name} (S${ep.season} E${ep.episode}). It is re-processing now.`,
    `/t/${ep.slug}`,
  );
  return c.json({ ok: true });
});

/** Pending creator video-replacement requests. */
adminRoutes.get('/video-replacements', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT vr.id, vr.kind, vr.status, vr.note, vr.source_url, vr.captions_url, vr.created_at,
       e.id AS episode_id, e.season, e.episode, e.name AS episode_name,
       t.id AS title_id, t.name AS title_name, t.slug,
       u.display_name AS creator_name, cp.handle AS creator_handle
     FROM video_replacements vr
     JOIN episodes e ON e.id = vr.episode_id
     JOIN titles t ON t.id = vr.title_id
     JOIN users u ON u.id = vr.creator_id
     LEFT JOIN creator_profiles cp ON cp.user_id = vr.creator_id
     WHERE vr.status = 'pending' ORDER BY vr.created_at`,
  ).all<{
    id: string;
    kind: AdminVideoReplacement['kind'];
    status: string;
    note: string;
    source_url: string;
    captions_url: string | null;
    created_at: string;
    episode_id: string;
    season: number;
    episode: number;
    episode_name: string;
    title_id: string;
    title_name: string;
    slug: string;
    creator_name: string;
    creator_handle: string | null;
  }>();
  const replacements: AdminVideoReplacement[] = results.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    note: r.note,
    sourceUrl: r.source_url,
    captionsUrl: r.captions_url,
    createdAt: r.created_at,
    episode: { id: r.episode_id, season: r.season, episode: r.episode, name: r.episode_name },
    title: { id: r.title_id, name: r.title_name, slug: r.slug },
    creator: { handle: r.creator_handle, displayName: r.creator_name },
  }));
  return c.json({ replacements });
});

/** Apply or reject a pending creator replacement request. */
adminRoutes.post('/video-replacements/:id/decide', async (c) => {
  const admin = currentUser(c);
  const body = await parseBody(c, replaceDecideSchema);
  const vr = await c.env.DB.prepare(
    `SELECT vr.id, vr.episode_id, vr.creator_id, vr.source_url, vr.captions_url,
       e.season, e.episode, t.name AS title_name, t.slug
     FROM video_replacements vr
     JOIN episodes e ON e.id = vr.episode_id
     JOIN titles t ON t.id = vr.title_id
     WHERE vr.id = ? AND vr.status = 'pending'`,
  )
    .bind(c.req.param('id'))
    .first<{
      id: string;
      episode_id: string;
      creator_id: string;
      source_url: string;
      captions_url: string | null;
      season: number;
      episode: number;
      title_name: string;
      slug: string;
    }>();
  if (!vr) fail(404, 'replacement_not_found', 'No pending replacement with that id.');

  if (body.apply) {
    await applyVideoReplacement(c.env, vr.episode_id, vr.source_url, vr.captions_url);
  }
  await c.env.DB.prepare(
    'UPDATE video_replacements SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?',
  )
    .bind(body.apply ? 'applied' : 'rejected', nowIso(), admin.id, vr.id)
    .run();
  await notify(
    c.env.DB,
    vr.creator_id,
    'video_update',
    body.apply
      ? `Your replacement video for ${vr.title_name} (S${vr.season} E${vr.episode}) was applied and is re-processing.`
      : `Your replacement video for ${vr.title_name} (S${vr.season} E${vr.episode}) was not applied.`,
    `/t/${vr.slug}`,
  );
  return c.json({ status: body.apply ? 'applied' : 'rejected' });
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
/**
 * Announce scheduled episodes that have released since the last cron tick
 * (the same job the 10-minute cron runs), for ops and for testing.
 */
adminRoutes.post('/maintenance/announce-releases', async (c) => {
  const announced = await announceReleasedEpisodes(c.env.DB);
  return c.json({ announced });
});

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
