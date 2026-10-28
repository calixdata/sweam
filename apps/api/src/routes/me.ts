import { Hono } from 'hono';
import { logDelivery, sendPushToUser } from '../lib/fcm';
import { loadAnnouncementContent, releaseEmail } from '../lib/release';
import { hasBluAccess } from '../lib/blu';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { BlockedAccount, MyVerification, NotificationItem, TvDeviceSummary, VerificationStatus } from '@sweam/shared';
import { UPLOAD_SPECS } from '@sweam/shared';
import type { AppEnv } from '../env';
import { generateToken, hashPassword, sha256Hex, verifyPassword } from '../lib/auth';
import { emailChangeVerification, emailConfigured, sendEmail } from '../lib/email';
import { fail, nowIso, parseBody } from '../lib/http';
import type { TitleRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapTitle } from '../lib/mappers';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '../lib/ratelimit';
import { loadScoutMembership } from '../lib/scoutMembership';
import { cancelSubscription, stripeConfigured } from '../lib/stripe';
import { SESSION_COOKIE, bearerToken, requireUser, currentUser } from '../lib/session';
import {
  audienceUpdateSchema,
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  pushTokenDeleteSchema,
  pushTokenSchema,
  reportCreateSchema,
  tvClaimSchema,
  usernameSchema,
  verificationRequestSchema,
  notificationPrefsSchema,
} from '../lib/validate';
import { mediaKeyFor, resolveUploadContentType } from './studio';

/** In-app email-change links are good for 24 hours. */
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

/** Signed-in viewer state: watchlist, likes, reports, and notifications. */
export const meRoutes = new Hono<AppEnv>();

meRoutes.use('*', requireUser);

/** Change the account @username; keeps the creator handle in sync when present. */
meRoutes.post('/username', async (c) => {
  const user = currentUser(c);
  const { username } = await parseBody(c, usernameSchema);
  const taken = await c.env.DB.prepare(
    'SELECT 1 AS x FROM users WHERE username = ? COLLATE NOCASE AND id <> ?',
  )
    .bind(username, user.id)
    .first();
  if (taken) fail(409, 'username_taken', 'That username is taken. Please choose another.');

  const statements = [
    c.env.DB.prepare('UPDATE users SET username = ? WHERE id = ?').bind(username, user.id),
  ];
  // Creators are shown by handle everywhere; keep it equal to the username.
  if (user.handle) {
    statements.push(
      c.env.DB.prepare('UPDATE creator_profiles SET handle = ? WHERE user_id = ?').bind(username, user.id),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ username });
});

// ---------------------------------------------------------------------------
// Profile picture
// ---------------------------------------------------------------------------

/** Upload (or replace) the account's profile picture. Single PUT; images only. */
meRoutes.put('/avatar/:filename', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.upload, user.id);
  const filename = c.req.param('filename');
  const contentType = resolveUploadContentType(c.req.header('content-type'), filename);
  if (!contentType || !contentType.startsWith('image/')) {
    fail(415, 'unsupported_type', 'Upload a JPEG, PNG, or WebP image.');
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    fail(411, 'length_required', 'Uploads must include a Content-Length header.');
  }
  if (contentLength > UPLOAD_SPECS.avatar.maxBytes) {
    fail(413, 'too_large', `Profile pictures are limited to ${UPLOAD_SPECS.avatar.maxLabel}.`);
  }
  if (!c.req.raw.body) fail(400, 'empty_body', 'Upload body is empty.');

  const key = mediaKeyFor(user.id, filename);
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  const url = `/media/${key}`;
  await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(url, user.id).run();
  // The replaced picture is no longer referenced anywhere; free the storage.
  await deleteOwnMediaObject(c.env.MEDIA, user.id, user.avatarUrl);
  // `url` is what every uploader returns; `avatarUrl` is kept for the mobile app.
  return c.json({ url, avatarUrl: url }, 201);
});

/** Remove the account's profile picture (reverts to the initials fallback). */
meRoutes.delete('/avatar', async (c) => {
  const user = currentUser(c);
  await c.env.DB.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').bind(user.id).run();
  await deleteOwnMediaObject(c.env.MEDIA, user.id, user.avatarUrl);
  return c.json({ url: null, avatarUrl: null });
});

/**
 * Delete a /media object the user uploaded under their own prefix (a previous
 * profile picture). Anything else, including absolute URLs, is left alone, and
 * a failed delete never fails the request that replaced the picture.
 */
async function deleteOwnMediaObject(
  media: R2Bucket,
  userId: string,
  mediaUrl: string | null,
): Promise<void> {
  const prefix = `/media/u/${userId}/`;
  if (!mediaUrl || !mediaUrl.startsWith(prefix)) return;
  try {
    await media.delete(mediaUrl.slice('/media/'.length));
  } catch {
    // Orphaned objects are harmless; the new picture is already in place.
  }
}

// ---------------------------------------------------------------------------
// Identity verification (the free path: an ID plus a proof of address)
// ---------------------------------------------------------------------------

/** The account's verification state plus its latest request, for Settings. */
meRoutes.get('/verification', async (c) => {
  const user = currentUser(c);
  const [account, request] = await Promise.all([
    c.env.DB.prepare('SELECT verified, verified_at FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ verified: number; verified_at: string | null }>(),
    c.env.DB.prepare(
      `SELECT id, status, note, created_at, decided_at FROM identity_verifications
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(user.id)
      .first<{
        id: string;
        status: VerificationStatus;
        note: string | null;
        created_at: string;
        decided_at: string | null;
      }>(),
  ]);
  const payload: MyVerification = {
    verified: account?.verified === 1,
    verifiedAt: account?.verified_at ?? null,
    request: request
      ? {
          id: request.id,
          status: request.status,
          createdAt: request.created_at,
          decidedAt: request.decided_at,
          note: request.status === 'rejected' ? request.note : null,
        }
      : null,
  };
  return c.json(payload);
});

/**
 * Upload one verification document. Stored under verify/<userId>/ in R2, a
 * prefix the media gate serves only to the owner and to admins (never public,
 * even though it may be an image), and deleted once the request is decided.
 */
meRoutes.put('/verification/upload/:filename', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.upload, user.id);
  const filename = c.req.param('filename');
  const contentType = resolveUploadContentType(c.req.header('content-type'), filename);
  if (!contentType || !(contentType.startsWith('image/') || contentType === 'application/pdf')) {
    fail(415, 'unsupported_type', `Upload a ${UPLOAD_SPECS.verification.formats} file.`);
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    fail(411, 'length_required', 'Uploads must include a Content-Length header.');
  }
  if (contentLength > UPLOAD_SPECS.verification.maxBytes) {
    fail(413, 'too_large', `Documents are limited to ${UPLOAD_SPECS.verification.maxLabel}.`);
  }
  if (!c.req.raw.body) fail(400, 'empty_body', 'Upload body is empty.');

  const key = `verify/${user.id}/${crypto.randomUUID()}/${safeFilename(filename)}`;
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ url: `/media/${key}` }, 201);
});

function safeFilename(filename: string): string {
  const safe = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || 'document';
}

/** Submit (or resubmit after a rejection) an identity verification request. */
meRoutes.post('/verification', async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, verificationRequestSchema);
  const account = await c.env.DB.prepare('SELECT verified FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ verified: number }>();
  if (account?.verified === 1) fail(409, 'already_verified', 'Your account is already verified.');
  const open = await c.env.DB.prepare(
    "SELECT 1 AS x FROM identity_verifications WHERE user_id = ? AND status = 'pending'",
  )
    .bind(user.id)
    .first();
  if (open) fail(409, 'already_pending', 'Your verification request is already under review.');
  // Only this user's own uploads can be attached.
  const prefix = `/media/verify/${user.id}/`;
  if (!body.idDocUrl.startsWith(prefix) || !body.addressDocUrl.startsWith(prefix)) {
    fail(403, 'not_your_upload', 'Those documents do not belong to this account.');
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO identity_verifications (id, user_id, legal_name, id_doc_key, address_doc_key, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(id, user.id, body.legalName, body.idDocUrl.slice('/media/'.length), body.addressDocUrl.slice('/media/'.length), nowIso())
    .run();
  return c.json({ id, status: 'pending' }, 201);
});

// ---------------------------------------------------------------------------
// Release-day reminders for scheduled episodes
// ---------------------------------------------------------------------------

/** Loads a scheduled, still-unreleased episode on a published title, or 404. */
async function upcomingEpisode(db: D1Database, episodeId: string): Promise<{ id: string }> {
  const row = await db
    .prepare(
      `SELECT e.id FROM episodes e JOIN titles t ON t.id = e.title_id
       WHERE e.id = ? AND t.published = 1 AND e.release_at IS NOT NULL
         AND e.release_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(episodeId)
    .first<{ id: string }>();
  if (!row) fail(404, 'not_upcoming', 'That episode is not scheduled for a future release.');
  return row;
}

meRoutes.put('/release-reminders/:episodeId', async (c) => {
  const user = currentUser(c);
  const episode = await upcomingEpisode(c.env.DB, c.req.param('episodeId'));
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO release_reminders (user_id, episode_id, created_at) VALUES (?, ?, ?)',
  )
    .bind(user.id, episode.id, nowIso())
    .run();
  return c.json({ reminderSet: true });
});

meRoutes.delete('/release-reminders/:episodeId', async (c) => {
  const user = currentUser(c);
  await c.env.DB.prepare('DELETE FROM release_reminders WHERE user_id = ? AND episode_id = ?')
    .bind(user.id, c.req.param('episodeId'))
    .run();
  return c.json({ reminderSet: false });
});

// ---------------------------------------------------------------------------
// Account deletion (required by the app stores for any app with sign-up)
// ---------------------------------------------------------------------------

/**
 * Delete the signed-in account permanently. The password and a typed DELETE
 * confirm it. Live Stripe subscriptions are canceled first (best effort), then
 * the user row goes and every table referencing it cascades: profile, titles,
 * episodes, comments, likes, follows, sessions, notifications, and so on.
 * Admin accounts cannot be deleted this way.
 */
meRoutes.delete('/account', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.pwChange, user.id);
  const body = await parseBody(c, deleteAccountSchema);
  if (user.isAdmin) {
    fail(403, 'admin_account', 'Administrator accounts cannot be deleted from the app. Ask another admin to remove the admin role first.');
  }
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.password, row.password_hash))) {
    fail(400, 'invalid_password', 'Your password is incorrect.');
  }

  // Stop billing before the records disappear.
  if (stripeConfigured(c.env)) {
    const { results: subs } = await c.env.DB.prepare(
      `SELECT stripe_subscription_id AS id FROM blu_subscriptions
         WHERE subscriber_id = ?1 AND stripe_subscription_id IS NOT NULL AND status != 'canceled'
       UNION
       SELECT stripe_subscription_id AS id FROM scout_all_access
         WHERE user_id = ?1 AND stripe_subscription_id IS NOT NULL AND status != 'canceled'`,
    )
      .bind(user.id)
      .all<{ id: string }>();
    await Promise.allSettled(subs.map((sub) => cancelSubscription(c.env, sub.id)));
  }

  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Account security: change password, change email
// ---------------------------------------------------------------------------

/** Change the password, proving the current one, then sign out other sessions. */
meRoutes.post('/change-password', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.pwChange, user.id);
  const body = await parseBody(c, changePasswordSchema);
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
    fail(400, 'invalid_password', 'Your current password is incorrect.');
  }
  // Keep this session, but sign out every other device for safety.
  const token = getCookie(c, SESSION_COOKIE) ?? bearerToken(c);
  const currentHash = token ? await sha256Hex(token) : '';
  await c.env.DB.batch([
    c.env.DB
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(body.newPassword), user.id),
    c.env.DB
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .bind(user.id, currentHash),
  ]);
  return c.json({ ok: true });
});

/**
 * Request an email change. The new address must be confirmed from an emailed
 * link before it becomes the account email; nothing changes until then.
 */
meRoutes.post('/change-email', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.emailChange, user.id);
  const body = await parseBody(c, changeEmailSchema);
  if (!emailConfigured(c.env)) {
    fail(503, 'email_unavailable', 'Email changes are paused while email delivery is being set up.');
  }
  if (body.newEmail === user.email) {
    fail(400, 'same_email', 'That is already your account email.');
  }
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.password, row.password_hash))) {
    fail(400, 'invalid_password', 'Your password is incorrect.');
  }
  const taken = await c.env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ? AND id <> ?')
    .bind(body.newEmail, user.id)
    .first();
  if (taken) fail(409, 'email_taken', 'An account with that email already exists.');

  const token = generateToken();
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS).toISOString();
  await c.env.DB.prepare(
    'UPDATE users SET pending_email = ?, pending_email_token_hash = ?, pending_email_expires_at = ? WHERE id = ?',
  )
    .bind(body.newEmail, await sha256Hex(token), expiresAt, user.id)
    .run();
  const link = `${new URL(c.req.url).origin}/confirm-email-change?token=${encodeURIComponent(token)}`;
  try {
    await sendEmail(c.env, { to: body.newEmail, ...emailChangeVerification(link, user.displayName) });
  } catch {
    // Roll back the pending change so they can retry cleanly.
    await c.env.DB.prepare(
      'UPDATE users SET pending_email = NULL, pending_email_token_hash = NULL, pending_email_expires_at = NULL WHERE id = ?',
    )
      .bind(user.id)
      .run();
    fail(502, 'email_send_failed', 'We could not send the confirmation email. Please try again in a minute.');
  }
  return c.json({ pending: true, email: body.newEmail });
});

meRoutes.get('/watchlist', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT ${TITLE_SELECT}
     ${TITLE_FROM}
     JOIN watchlist w ON w.title_id = t.id
     WHERE w.user_id = ? AND t.published = 1
     ORDER BY w.added_at DESC`,
  )
    .bind(user.id)
    .all<TitleRow>();
  return c.json({ titles: results.map(mapTitle) });
});

async function assertPublishedTitle(db: D1Database, titleId: string): Promise<void> {
  const exists = await db
    .prepare('SELECT 1 AS x FROM titles WHERE id = ? AND published = 1')
    .bind(titleId)
    .first();
  if (!exists) fail(404, 'title_not_found', 'That title does not exist or is not published.');
}

meRoutes.put('/watchlist/:titleId', async (c) => {
  const user = currentUser(c);
  const titleId = c.req.param('titleId');
  await assertPublishedTitle(c.env.DB, titleId);
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO watchlist (user_id, title_id, added_at) VALUES (?, ?, ?)',
  )
    .bind(user.id, titleId, nowIso())
    .run();
  return c.json({ inMyWatchlist: true });
});

meRoutes.delete('/watchlist/:titleId', async (c) => {
  const user = currentUser(c);
  await c.env.DB.prepare('DELETE FROM watchlist WHERE user_id = ? AND title_id = ?')
    .bind(user.id, c.req.param('titleId'))
    .run();
  return c.json({ inMyWatchlist: false });
});

meRoutes.put('/likes/:titleId', async (c) => {
  const user = currentUser(c);
  const titleId = c.req.param('titleId');
  await assertPublishedTitle(c.env.DB, titleId);
  const result = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO likes (user_id, title_id, created_at) VALUES (?, ?, ?)',
  )
    .bind(user.id, titleId, nowIso())
    .run();
  // Only bump the counters when a row was actually inserted (idempotent likes).
  // Daily likes count like events and are never decremented; lifetime stats
  // stay authoritative for net totals.
  if (result.meta.changes > 0) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE title_stats SET likes = likes + 1 WHERE title_id = ?').bind(titleId),
      c.env.DB.prepare(
        `INSERT INTO title_stats_daily (title_id, day, impressions, plays, completes, likes, watch_seconds)
         VALUES (?, date('now'), 0, 0, 0, 1, 0)
         ON CONFLICT (title_id, day) DO UPDATE SET likes = likes + 1`,
      ).bind(titleId),
    ]);
  }
  return c.json({ likedByMe: true });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

meRoutes.post('/reports', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.report, user.id);
  const body = await parseBody(c, reportCreateSchema);
  await assertPublishedTitle(c.env.DB, body.titleId);

  const result = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO reports (id, title_id, reporter_id, reason, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
  )
    .bind(crypto.randomUUID(), body.titleId, user.id, body.reason, body.note, nowIso())
    .run();
  if (result.meta.changes === 0) {
    fail(409, 'already_reported', 'You already reported this title. Our moderators will review it.');
  }
  return c.json({ reported: true }, 201);
});

// ---------------------------------------------------------------------------
// Audience preference (For You / feed sex filter)
// ---------------------------------------------------------------------------

interface AudienceRow {
  sex: 'female' | 'male' | 'nonbinary' | 'undisclosed';
  verified_sex: 'female' | 'male' | null;
  feed_audience: 'all' | 'women' | 'men';
  feed_audience_verified: number;
}

meRoutes.get('/audience', async (c) => {
  const user = currentUser(c);
  const row = await c.env.DB.prepare(
    'SELECT sex, verified_sex, feed_audience, feed_audience_verified FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first<AudienceRow>();
  return c.json({
    sex: row?.sex ?? 'undisclosed',
    verifiedSex: row?.verified_sex ?? null,
    feedAudience: row?.feed_audience ?? 'all',
    verifiedOnly: (row?.feed_audience_verified ?? 0) === 1,
  });
});

meRoutes.put('/audience', async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, audienceUpdateSchema);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.sex !== undefined) {
    sets.push('sex = ?');
    binds.push(body.sex);
  }
  if (body.feedAudience !== undefined) {
    sets.push('feed_audience = ?');
    binds.push(body.feedAudience);
  }
  if (body.verifiedOnly !== undefined) {
    sets.push('feed_audience_verified = ?');
    binds.push(body.verifiedOnly ? 1 : 0);
  }
  binds.push(user.id);
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  const row = await c.env.DB.prepare(
    'SELECT sex, verified_sex, feed_audience, feed_audience_verified FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first<AudienceRow>();
  return c.json({
    sex: row?.sex ?? 'undisclosed',
    verifiedSex: row?.verified_sex ?? null,
    feedAudience: row?.feed_audience ?? 'all',
    verifiedOnly: (row?.feed_audience_verified ?? 0) === 1,
  });
});

// ---------------------------------------------------------------------------
// Blocked accounts
// ---------------------------------------------------------------------------

interface BlockedRow {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verified: number;
  created_at: string;
}

meRoutes.get('/blocks', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT COALESCE(cp.handle, u.username) AS handle, u.display_name, u.avatar_url,
       MAX(u.verified, COALESCE(cp.verified, 0)) AS verified, b.created_at
     FROM blocks b
     JOIN users u ON u.id = b.blocked_id
     LEFT JOIN creator_profiles cp ON cp.user_id = u.id
     WHERE b.blocker_id = ?
     ORDER BY b.created_at DESC
     LIMIT 500`,
  )
    .bind(user.id)
    .all<BlockedRow>();
  const blocks: BlockedAccount[] = results.map((row) => ({
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    verified: row.verified === 1,
    blockedAt: row.created_at,
  }));
  return c.json({ blocks });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  kind: NotificationItem['kind'];
  body: string;
  link: string | null;
  read: number;
  created_at: string;
}

meRoutes.get('/notifications', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, body, link, read, created_at
     FROM notifications WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all<NotificationRow>();
  const notifications: NotificationItem[] = results.map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    link: row.link,
    read: row.read === 1,
    createdAt: row.created_at,
  }));
  return c.json({ notifications });
});

meRoutes.get('/notifications/unread-count', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0',
  )
    .bind(currentUser(c).id)
    .first<{ n: number }>();
  return c.json({ unread: row?.n ?? 0 });
});

meRoutes.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0')
    .bind(currentUser(c).id)
    .run();
  return c.json({ ok: true });
});

/** Notification preferences: release emails on or off. */
async function loadNotificationPrefs(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      'SELECT release_emails, push_enabled, (SELECT COUNT(*) FROM push_tokens WHERE user_id = ?1) AS devices FROM users WHERE id = ?1',
    )
    .bind(userId)
    .first<{ release_emails: number; push_enabled: number; devices: number }>();
  return {
    releaseEmails: (row?.release_emails ?? 1) === 1,
    pushEnabled: (row?.push_enabled ?? 1) === 1,
    pushDevices: row?.devices ?? 0,
  };
}

meRoutes.get('/notification-prefs', async (c) => {
  return c.json(await loadNotificationPrefs(c.env.DB, currentUser(c).id));
});

/** Turn release emails and phone notifications on or off (either or both). */
meRoutes.put('/notification-prefs', async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, notificationPrefsSchema);
  const statements = [];
  if (body.releaseEmails !== undefined) {
    statements.push(c.env.DB.prepare('UPDATE users SET release_emails = ? WHERE id = ?').bind(body.releaseEmails ? 1 : 0, user.id));
  }
  if (body.pushEnabled !== undefined) {
    statements.push(c.env.DB.prepare('UPDATE users SET push_enabled = ? WHERE id = ?').bind(body.pushEnabled ? 1 : 0, user.id));
  }
  if (statements.length) await c.env.DB.batch(statements);
  return c.json(await loadNotificationPrefs(c.env.DB, user.id));
});

/**
 * Send a test push to every phone this account has registered and return what
 * Firebase answered for each, so a member (or Sweam) can see at once whether
 * phone notifications work. Limited to a few per hour.
 */
meRoutes.post('/push-test', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.pushTest, user.id);
  const results = await sendPushToUser(
    c.env.DB,
    user.id,
    'Sweam',
    'Test notification: phone notifications are working.',
    '/notifications',
    'test',
  );
  return c.json({ devices: results });
});

/**
 * Send this member the latest release email, marked as a test, so they (and
 * Sweam) can see exactly what release emails look like and that they arrive.
 */
meRoutes.post('/email-test', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.emailTest, user.id);
  if (!emailConfigured(c.env)) fail(503, 'email_disabled', 'Email sending is not configured.');
  const db = c.env.DB;
  const me = await db
    .prepare('SELECT email, display_name, email_verified, email_unsub_token FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ email: string; display_name: string; email_verified: number; email_unsub_token: string | null }>();
  if (!me || me.email_verified !== 1) fail(400, 'email_unverified', 'Verify your email address first.');

  const latest = await db
    .prepare(
      `SELECT a.title_id, a.episode_ids FROM release_announcements a JOIN titles t ON t.id = a.title_id
       WHERE a.is_clip = 0 AND a.mode = 'release' AND t.published = 1 AND t.suppressed = 0
         AND NOT EXISTS (SELECT 1 FROM takedowns tk WHERE tk.title_id = t.id AND tk.released_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ?1 AND b.blocked_id = t.creator_id) OR (b.blocker_id = t.creator_id AND b.blocked_id = ?1))
       ORDER BY a.created_at DESC LIMIT 1`,
    )
    .bind(user.id)
    .first<{ title_id: string; episode_ids: string }>();
  let content = latest ? await loadAnnouncementContent(db, latest.title_id, JSON.parse(latest.episode_ids) as string[]) : null;
  if (!content) {
    const ep = await db
      .prepare(
        `SELECT e.id, e.title_id FROM episodes e JOIN titles t ON t.id = e.title_id
         WHERE t.published = 1 AND t.suppressed = 0 AND t.is_blu = 0 AND e.media_type = 'video' AND e.is_clip = 0
           AND (e.release_at IS NULL OR e.release_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           AND NOT EXISTS (SELECT 1 FROM takedowns tk WHERE tk.title_id = t.id AND tk.released_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ?1 AND b.blocked_id = t.creator_id) OR (b.blocker_id = t.creator_id AND b.blocked_id = ?1))
         ORDER BY COALESCE(e.release_at, e.created_at) DESC LIMIT 1`,
      )
      .bind(user.id)
      .first<{ id: string; title_id: string }>();
    content = ep ? await loadAnnouncementContent(db, ep.title_id, [ep.id]) : null;
  }
  if (!content) fail(404, 'nothing_to_send', 'There is no release on Sweam yet to use for a test.');

  let token = me.email_unsub_token;
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
    await db.prepare('UPDATE users SET email_unsub_token = COALESCE(email_unsub_token, ?) WHERE id = ?').bind(token, user.id).run();
    token = (await db.prepare('SELECT email_unsub_token FROM users WHERE id = ?').bind(user.id).first<{ email_unsub_token: string }>())?.email_unsub_token ?? token;
  }
  const site = (c.env.PUBLIC_WEB_URL ?? 'https://sweam.co').replace(/\/+$/, '');
  const unsubscribeUrl = `${site}/api/email/unsubscribe?u=${encodeURIComponent(user.id)}&t=${token}`;
  const message = releaseEmail({
    site,
    content,
    recipientName: me.display_name,
    reason: 'member',
    canWatch: content.title.is_blu !== 1 || (await hasBluAccess(db, user.id, content.title.creator_id)),
    unsubscribeUrl,
    postalAddress: c.env.MAIL_POSTAL_ADDRESS?.trim() || undefined,
  });
  try {
    await sendEmail(c.env, {
      to: me.email,
      subject: `[Test] ${message.subject}`,
      html: message.html,
      text: message.text,
      headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Email failed.';
    await logDelivery(db, { channel: 'email', source: 'test', userId: user.id, target: me.email.split('@')[1] ?? null, ok: false, status: 0, error });
    fail(502, 'email_failed', `The test email could not be sent: ${error}`);
  }
  await logDelivery(db, { channel: 'email', source: 'test', userId: user.id, target: me.email.split('@')[1] ?? null, ok: true, status: 200, error: null });
  const [name, domain] = me.email.split('@');
  return c.json({ sent: true, to: `${(name ?? '').slice(0, 2)}…@${domain ?? ''}` });
});

// The mobile app registers its FCM device token here after sign-in.
meRoutes.post('/push-tokens', async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, pushTokenSchema);
  await c.env.DB.prepare(
    `INSERT INTO push_tokens (token, user_id, platform, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id, platform = excluded.platform, created_at = excluded.created_at`,
  )
    .bind(body.token, user.id, body.platform, nowIso())
    .run();
  return c.json({ ok: true });
});

meRoutes.delete('/push-tokens', async (c) => {
  const body = await parseBody(c, pushTokenDeleteSchema);
  await c.env.DB.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?')
    .bind(body.token, currentUser(c).id)
    .run();
  return c.json({ ok: true });
});

// The viewer's active Sweam Blu subscriptions and scout membership (for the manage screen).
meRoutes.get('/subscriptions', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT bs.creator_id, cp.handle, u.display_name, bs.price_cents, bs.current_period_end
     FROM blu_subscriptions bs
     JOIN creator_profiles cp ON cp.user_id = bs.creator_id
     JOIN users u ON u.id = bs.creator_id
     WHERE bs.subscriber_id = ? AND bs.status = 'active'
     ORDER BY bs.created_at DESC`,
  )
    .bind(user.id)
    .all<{
      creator_id: string;
      handle: string;
      display_name: string;
      price_cents: number;
      current_period_end: string | null;
    }>();
  // Scout membership includes Blu all-access, so an approved scout's standing is
  // reported here next to their creator subscriptions.
  const scoutMembership = await loadScoutMembership(c.env.DB, user.id);
  return c.json({
    blu: results.map((r) => ({
      creatorId: r.creator_id,
      handle: r.handle,
      displayName: r.display_name,
      priceCents: r.price_cents,
      currentPeriodEnd: r.current_period_end,
    })),
    scoutMembership,
    // Older cached bundles still read this shape.
    scoutAllAccess: {
      active: scoutMembership?.active ?? false,
      currentPeriodEnd: scoutMembership?.currentPeriodEnd ?? null,
    },
  });
});

meRoutes.delete('/likes/:titleId', async (c) => {
  const user = currentUser(c);
  const titleId = c.req.param('titleId');
  const result = await c.env.DB.prepare('DELETE FROM likes WHERE user_id = ? AND title_id = ?')
    .bind(user.id, titleId)
    .run();
  if (result.meta.changes > 0) {
    await c.env.DB.prepare(
      'UPDATE title_stats SET likes = MAX(likes - 1, 0) WHERE title_id = ?',
    )
      .bind(titleId)
      .run();
  }
  return c.json({ likedByMe: false });
});

// ---------------------------------------------------------------------------
// SweamTV devices. The TV shows a code (routes/tv.ts); the viewer claims it
// here from /activate, and Settings lists and unpairs TVs. Unpairing deletes
// the TV's session, so the set ends on the TV's next request.
// ---------------------------------------------------------------------------

meRoutes.post('/tv/claim', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.tvClaimUser, user.id);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.tvClaimIp, clientIp(c.req.raw));
  const body = await parseBody(c, tvClaimSchema);
  // One guarded UPDATE: only an unclaimed, unexpired code can be taken, and
  // the TV's next poll turns the claim into its session.
  const device = await c.env.DB.prepare(
    `UPDATE tv_devices SET user_id = ?
      WHERE code = ? AND user_id IS NULL AND code_expires_at > ?
      RETURNING id, platform, name`,
  )
    .bind(user.id, body.code, nowIso())
    .first<{ id: string; platform: string; name: string | null }>();
  if (!device) {
    fail(404, 'code_invalid', 'That code is not active. Check the code on your TV screen and try again.');
  }
  return c.json({ ok: true, device: { platform: device.platform, name: device.name } });
});

meRoutes.get('/tv/devices', async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, platform, name, paired_at, last_seen_at FROM tv_devices
      WHERE user_id = ? AND session_token_hash IS NOT NULL
      ORDER BY paired_at DESC`,
  )
    .bind(user.id)
    .all<{ id: string; platform: string; name: string | null; paired_at: string; last_seen_at: string | null }>();
  const devices: TvDeviceSummary[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    name: row.name,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
  }));
  return c.json({ devices });
});

meRoutes.delete('/tv/devices/:deviceId', async (c) => {
  const user = currentUser(c);
  const device = await c.env.DB.prepare(
    'SELECT id, session_token_hash FROM tv_devices WHERE id = ? AND user_id = ?',
  )
    .bind(c.req.param('deviceId'), user.id)
    .first<{ id: string; session_token_hash: string | null }>();
  if (!device) fail(404, 'not_found', 'That TV is not paired to your account.');
  await c.env.DB.batch([
    ...(device.session_token_hash
      ? [c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(device.session_token_hash)]
      : []),
    c.env.DB.prepare('DELETE FROM tv_devices WHERE id = ?').bind(device.id),
  ]);
  // A TV unpairing itself just deleted the session this request rode in on;
  // clear its cookie so the shell lands back on the pairing screen cleanly.
  const token = getCookie(c, SESSION_COOKIE) ?? bearerToken(c);
  if (token && device.session_token_hash === (await sha256Hex(token))) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
  }
  return c.json({ ok: true });
});
