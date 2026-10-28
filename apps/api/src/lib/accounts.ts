import type { Env } from '../env';
import { hashPassword } from './auth';
import { accountStandingEmail, emailConfigured, passwordSetByStaffEmail, sendEmail } from './email';
import { fail, nowIso } from './http';
import { cancelSubscription, stripeConfigured } from './stripe';

/**
 * Staff control of accounts: suspend (optionally until a date), ban, restore,
 * set a password, and delete. A suspended or banned account cannot sign in, its
 * sessions end, and its titles and comments are hidden with the same switches
 * moderation already uses (titles: suppressed and unpublished; comments:
 * removed_by_admin). What each action hid is recorded in account_actions, so a
 * restore brings back exactly that and nothing an admin hid separately.
 */

export type AccountStatus = 'active' | 'suspended' | 'banned';

interface Target {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  account_status: AccountStatus;
  is_admin: number;
}

async function loadTarget(db: D1Database, userId: string): Promise<Target> {
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.username, u.account_status,
         EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id) AS is_admin
       FROM users u WHERE u.id = ?`,
    )
    .bind(userId)
    .first<Target>();
  if (!row) fail(404, 'user_not_found', 'No account with that id.');
  return row;
}

const labelOf = (t: Target) => `${t.display_name}${t.username ? ` (@${t.username})` : ''} <${t.email}>`;

function guard(actorId: string, t: Target): void {
  if (t.id === actorId) fail(400, 'self', 'You cannot do this to your own account.');
  if (t.is_admin === 1) fail(403, 'admin_account', 'Administrator accounts cannot be suspended, banned or deleted. Remove the admin role first.');
}

/** A date for people: "November 3, 2026". */
export function untilLabel(until: string | null): string | null {
  if (!until) return null;
  const d = new Date(until);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** What the sign-in form says to a suspended or banned account (after a correct password). */
export function standingMessage(status: AccountStatus, until: string | null): string {
  if (status === 'banned') {
    return 'This account has been banned for breaking Sweam\'s rules. If you think this is a mistake, email support@sweam.co.';
  }
  const label = untilLabel(until);
  return `This account is suspended ${label ? `until ${label}` : 'until further notice'}. If you think this is a mistake, email support@sweam.co.`;
}

async function notifyOwner(env: Env, to: string, message: { subject: string; html: string; text: string }): Promise<boolean> {
  if (!emailConfigured(env)) return false;
  try {
    await sendEmail(env, { to, ...message });
    return true;
  } catch (err) {
    console.error('account_notice_email_failed', err);
    return false;
  }
}

/** Suspend or ban. Hides content not already hidden, ends every session. */
export async function setStanding(
  env: Env,
  actorId: string,
  userId: string,
  status: 'suspended' | 'banned',
  reason: string | null,
  until: string | null,
  emailOwner: boolean,
): Promise<{ hiddenTitles: number; hiddenComments: number; emailed: boolean }> {
  const db = env.DB;
  const t = await loadTarget(db, userId);
  guard(actorId, t);
  if (status === 'suspended' && until && until <= nowIso()) fail(400, 'until_past', 'The end of the suspension must be in the future.');

  const { results: titles } = await db
    .prepare('SELECT id FROM titles WHERE creator_id = ? AND published = 1 AND suppressed = 0')
    .bind(userId)
    .all<{ id: string }>();
  const { results: comments } = await db
    .prepare("SELECT id FROM comments WHERE author_id = ? AND status = 'visible'")
    .bind(userId)
    .all<{ id: string }>();
  const titleIds = JSON.stringify(titles.map((r) => r.id));
  const commentIds = JSON.stringify(comments.map((r) => r.id));
  const now = nowIso();

  await db.batch([
    db.prepare('UPDATE titles SET suppressed = 1, published = 0 WHERE id IN (SELECT value FROM json_each(?))').bind(titleIds),
    db.prepare("UPDATE comments SET status = 'removed_by_admin' WHERE id IN (SELECT value FROM json_each(?))").bind(commentIds),
    db
      .prepare('UPDATE users SET account_status = ?, status_reason = ?, status_until = ?, status_changed_at = ? WHERE id = ?')
      .bind(status, reason, status === 'suspended' ? until : null, now, userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db
      .prepare(
        `INSERT INTO account_actions (id, user_id, user_label, action, reason, until, hidden_titles, hidden_comments, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), userId, labelOf(t), status === 'banned' ? 'ban' : 'suspend', reason, status === 'suspended' ? until : null, titleIds, commentIds, actorId, now),
  ]);
  const emailed = emailOwner ? await notifyOwner(env, t.email, accountStandingEmail(status, t.display_name, reason, untilLabel(until))) : false;
  console.log('account_standing', actorId, userId, status, titles.length, comments.length);
  return { hiddenTitles: titles.length, hiddenComments: comments.length, emailed };
}

/** Back to active: unhide exactly what every open suspension or ban hid. */
export async function restoreAccount(
  env: Env,
  actorId: string,
  userId: string,
  emailOwner: boolean,
): Promise<{ restoredTitles: number; restoredComments: number; emailed: boolean }> {
  const db = env.DB;
  const t = await loadTarget(db, userId);
  if (t.account_status === 'active') return { restoredTitles: 0, restoredComments: 0, emailed: false };
  const { results: open } = await db
    .prepare(
      "SELECT id, hidden_titles, hidden_comments FROM account_actions WHERE user_id = ? AND action IN ('suspend', 'ban') AND restored_at IS NULL",
    )
    .bind(userId)
    .all<{ id: string; hidden_titles: string | null; hidden_comments: string | null }>();
  const parse = (s: string | null): string[] => {
    try {
      const v = JSON.parse(s ?? '[]');
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  const titleIds = [...new Set(open.flatMap((a) => parse(a.hidden_titles)))];
  const commentIds = [...new Set(open.flatMap((a) => parse(a.hidden_comments)))];
  const now = nowIso();
  const res = await db.batch([
    db
      .prepare('UPDATE titles SET suppressed = 0, published = 1 WHERE suppressed = 1 AND id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(titleIds)),
    db
      .prepare("UPDATE comments SET status = 'visible' WHERE status = 'removed_by_admin' AND id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(commentIds)),
    db.prepare('UPDATE account_actions SET restored_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(now, JSON.stringify(open.map((a) => a.id))),
    db
      .prepare("UPDATE users SET account_status = 'active', status_reason = NULL, status_until = NULL, status_changed_at = ? WHERE id = ?")
      .bind(now, userId),
    db
      .prepare('INSERT INTO account_actions (id, user_id, user_label, action, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), userId, labelOf(t), 'restore', actorId, now),
  ]);
  const emailed = emailOwner ? await notifyOwner(env, t.email, accountStandingEmail('restored', t.display_name, null, null)) : false;
  console.log('account_restored', actorId, userId);
  return { restoredTitles: res[0]?.meta.changes ?? 0, restoredComments: res[1]?.meta.changes ?? 0, emailed };
}

/** Timer: restore suspensions whose end date has passed. */
export async function restoreExpiredSuspensions(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM users WHERE account_status = 'suspended' AND status_until IS NOT NULL AND status_until <= ? LIMIT 20",
  )
    .bind(nowIso())
    .all<{ id: string }>();
  for (const r of results) await restoreAccount(env, 'system', r.id, true).catch((err) => console.error('auto_restore_failed', r.id, err));
  return results.length;
}

/** Staff set a password: the owner is signed out everywhere and told by email. */
export async function setPasswordByStaff(env: Env, actorId: string, userId: string, password: string): Promise<{ emailed: boolean }> {
  const db = env.DB;
  const t = await loadTarget(db, userId);
  const now = nowIso();
  await db.batch([
    db
      .prepare('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL WHERE id = ?')
      .bind(await hashPassword(password), userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM rate_limits WHERE bucket = ?').bind(`signin-email:${t.email.toLowerCase()}`),
    db
      .prepare('INSERT INTO account_actions (id, user_id, user_label, action, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), userId, labelOf(t), 'set_password', actorId, now),
  ]);
  console.log('account_password_set_by_staff', actorId, userId);
  return { emailed: await notifyOwner(env, t.email, passwordSetByStaffEmail(t.display_name)) };
}

/** The account's own media files, to remove from storage after the rows are gone. */
async function mediaKeys(db: D1Database, userId: string): Promise<{ keys: string[]; prefixes: string[] }> {
  // Two queries: D1 allows at most 5 parts in one compound SELECT.
  const [own, eps] = await db.batch<{ u: string | null }>([
    db
      .prepare(
        `SELECT avatar_url AS u FROM users WHERE id = ?1
         UNION ALL SELECT poster_url FROM titles WHERE creator_id = ?1
         UNION ALL SELECT hero_url FROM titles WHERE creator_id = ?1`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT e.video_url AS u FROM episodes e JOIN titles t ON t.id = e.title_id WHERE t.creator_id = ?1
         UNION ALL SELECT e.thumbnail_url FROM episodes e JOIN titles t ON t.id = e.title_id WHERE t.creator_id = ?1
         UNION ALL SELECT e.captions_url FROM episodes e JOIN titles t ON t.id = e.title_id WHERE t.creator_id = ?1`,
      )
      .bind(userId),
  ]);
  const results = [...(own?.results ?? []), ...(eps?.results ?? [])];
  const keys: string[] = [];
  const prefixes: string[] = [];
  for (const { u } of results) {
    if (!u || !u.startsWith('/media/')) continue;
    const key = u.slice('/media/'.length).split('?')[0] ?? '';
    if (!key || key.startsWith('music/')) continue; // the shared music library is not the account's
    // An HLS playlist lives in a folder with its segments: remove the folder.
    if (key.endsWith('.m3u8')) prefixes.push(key.slice(0, key.lastIndexOf('/') + 1));
    else keys.push(key);
  }
  return { keys: [...new Set(keys)], prefixes: [...new Set(prefixes)].filter((p) => p.length > 3) };
}

/** Remove media files in the background (best effort). */
export async function removeMedia(media: R2Bucket, files: { keys: string[]; prefixes: string[] }): Promise<void> {
  for (let i = 0; i < files.keys.length; i += 500) await media.delete(files.keys.slice(i, i + 500)).catch(() => undefined);
  for (const prefix of files.prefixes) {
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const list = await media.list({ prefix, cursor, limit: 1000 }).catch(() => null);
      if (!list || list.objects.length === 0) break;
      await media.delete(list.objects.map((o) => o.key)).catch(() => undefined);
      if (!list.truncated) break;
      cursor = list.cursor;
    }
  }
}

/**
 * Delete an account for good: live subscriptions are canceled, the user row is
 * deleted (every table that references it cascades: profile, titles, episodes,
 * comments, likes, follows, sessions, notifications...), and the media files
 * are removed from storage afterwards (returned for waitUntil).
 */
export async function deleteAccountCompletely(
  env: Env,
  userId: string,
  record: { actorId: string; label?: string } | null,
): Promise<{ files: { keys: string[]; prefixes: string[] } }> {
  const db = env.DB;
  const files = await mediaKeys(db, userId);
  if (stripeConfigured(env)) {
    const { results: subs } = await db
      .prepare(
        `SELECT stripe_subscription_id AS id FROM blu_subscriptions
           WHERE subscriber_id = ?1 AND stripe_subscription_id IS NOT NULL AND status != 'canceled'
         UNION
         SELECT stripe_subscription_id AS id FROM scout_all_access
           WHERE user_id = ?1 AND stripe_subscription_id IS NOT NULL AND status != 'canceled'`,
      )
      .bind(userId)
      .all<{ id: string }>();
    await Promise.allSettled(subs.map((sub) => cancelSubscription(env, sub.id)));
  }
  const stmts = [db.prepare('DELETE FROM users WHERE id = ?').bind(userId)];
  if (record) {
    stmts.push(
      db
        .prepare('INSERT INTO account_actions (id, user_id, user_label, action, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), userId, record.label ?? userId, 'delete', record.actorId, nowIso()),
    );
  }
  await db.batch(stmts);
  return { files };
}

/** Admin delete: guarded, recorded, and confirmed by typing the username or email. */
export async function deleteAccountByStaff(
  env: Env,
  actorId: string,
  userId: string,
  confirm: string,
): Promise<{ files: { keys: string[]; prefixes: string[] }; label: string }> {
  const t = await loadTarget(env.DB, userId);
  guard(actorId, t);
  const typed = confirm.trim().replace(/^@/, '').toLowerCase();
  if (typed !== t.email.toLowerCase() && typed !== (t.username ?? '').toLowerCase()) {
    fail(400, 'confirm', 'Type the account\'s username or email exactly to confirm.');
  }
  const out = await deleteAccountCompletely(env, userId, { actorId, label: labelOf(t) });
  console.log('account_deleted_by_staff', actorId, userId, out.files.keys.length, out.files.prefixes.length);
  return { ...out, label: labelOf(t) };
}
