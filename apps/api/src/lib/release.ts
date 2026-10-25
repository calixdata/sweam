import type { Env } from '../env';
import { emailConfigured, sendEmail } from './email';
import { logDelivery } from './fcm';
import { nowIso } from './http';
import { notify } from './notify';

/**
 * Scheduled releases. An episode with `release_at` in the future is listed
 * (cover art, synopsis, date) but not streamable; it unlocks by itself the
 * moment the instant passes, because every read compares `release_at` to now.
 * What runs here is the announcement: from the cron every few minutes, once
 * per episode, everyone who tapped "Notify me" plus the creator's followers
 * gets an in-app notice, a push to each registered phone, and (unless they
 * turned it off) an email. Every push and email attempt lands in delivery_log.
 */

interface DueRow {
  id: string;
  title_id: string;
  season: number;
  episode: number;
  name: string;
  title_name: string;
  creator_id: string;
  creator_handle: string | null;
}

interface PersonRow {
  user_id: string;
  email: string;
  display_name: string;
  email_verified: number;
  release_emails: number;
  email_unsub_token: string | null;
  reminded: number;
}

const BATCH = 25;

function siteUrl(env: Env): string {
  return (env.PUBLIC_WEB_URL ?? 'https://sweam.co').replace(/\/+$/, '');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function unsubToken(db: D1Database, person: PersonRow): Promise<string> {
  if (person.email_unsub_token) return person.email_unsub_token;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await db
    .prepare('UPDATE users SET email_unsub_token = COALESCE(email_unsub_token, ?) WHERE id = ?')
    .bind(token, person.user_id)
    .run();
  const row = await db
    .prepare('SELECT email_unsub_token FROM users WHERE id = ?')
    .bind(person.user_id)
    .first<{ email_unsub_token: string }>();
  return row?.email_unsub_token ?? token;
}

export function releaseEmail(opts: {
  site: string;
  titleName: string;
  season: number;
  episode: number;
  episodeName: string;
  episodeId: string;
  creatorHandle: string | null;
  recipientName: string;
  reminded: boolean;
  unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const watchUrl = `${opts.site}/watch/${opts.episodeId}`;
  const settingsUrl = `${opts.site}/settings`;
  const label = `S${opts.season} E${opts.episode}: ${opts.episodeName}`;
  const why = opts.reminded
    ? 'You asked to be notified when this episode released.'
    : `You follow ${opts.creatorHandle ? `@${opts.creatorHandle}` : 'this creator'} on Sweam.`;
  const subject = `Out now: ${opts.titleName}, ${label}`;
  const text = [
    `Hi ${opts.recipientName},`,
    '',
    `${opts.titleName}, ${label}, is out now on Sweam.`,
    '',
    `Watch it: ${watchUrl}`,
    '',
    why,
    `Stop release emails: ${opts.unsubscribeUrl}`,
    `Notification settings: ${settingsUrl}`,
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#080e19;font-family:Arial,Helvetica,sans-serif;color:#f4f7ff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080e19"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111c2d;border-radius:12px">
<tr><td style="padding:28px 28px 8px;font-size:22px;font-weight:800;letter-spacing:3px">SWEAM</td></tr>
<tr><td style="padding:8px 28px 0;font-size:15px;color:#a5b5cd">Hi ${escapeHtml(opts.recipientName)},</td></tr>
<tr><td style="padding:12px 28px 0"><h1 style="margin:0;font-size:24px;line-height:1.3;color:#f4f7ff">${escapeHtml(opts.titleName)}</h1>
<p style="margin:6px 0 0;font-size:17px;color:#4de0f3;font-weight:700">${escapeHtml(label)} is out now</p></td></tr>
<tr><td style="padding:24px 28px"><a href="${escapeHtml(watchUrl)}" style="display:inline-block;background:#4de0f3;color:#04121a;text-decoration:none;font-weight:700;font-size:16px;padding:12px 24px;border-radius:999px">Watch now</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:13px;line-height:1.5;color:#a5b5cd">${escapeHtml(why)}<br>
<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#a5b5cd">Stop release emails</a> &middot; <a href="${escapeHtml(settingsUrl)}" style="color:#a5b5cd">Notification settings</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}

export async function announceReleasedEpisodes(env: Env): Promise<number> {
  const db = env.DB;
  const now = nowIso();
  // Keep the delivery log to the last 30 days.
  await db
    .prepare("DELETE FROM delivery_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')")
    .run()
    .catch(() => undefined);

  const { results } = await db
    .prepare(
      `SELECT e.id, e.title_id, e.season, e.episode, e.name, t.name AS title_name, t.creator_id, cp.handle AS creator_handle
       FROM episodes e JOIN titles t ON t.id = e.title_id
       LEFT JOIN creator_profiles cp ON cp.user_id = t.creator_id
       WHERE e.release_at IS NOT NULL AND e.release_at <= ? AND e.release_notified_at IS NULL
         AND t.published = 1 AND t.suppressed = 0
       ORDER BY e.release_at
       LIMIT ${BATCH}`,
    )
    .bind(now)
    .all<DueRow>();

  const site = siteUrl(env);
  for (const ep of results) {
    // Claim first so a concurrent run never announces the same episode twice.
    const claimed = await db
      .prepare('UPDATE episodes SET release_notified_at = ? WHERE id = ? AND release_notified_at IS NULL')
      .bind(now, ep.id)
      .run();
    if (claimed.meta.changes === 0) continue;

    const body = `Out now: ${ep.title_name}, S${ep.season} E${ep.episode}, ${ep.name}.`;
    const link = `/watch/${ep.id}`;
    // Reminder subscribers and followers, each person once.
    const { results: people } = await db
      .prepare(
        `SELECT u.id AS user_id, u.email, u.display_name, u.email_verified, u.release_emails, u.email_unsub_token,
           MAX(x.reminded) AS reminded
         FROM (
           SELECT user_id, 1 AS reminded FROM release_reminders WHERE episode_id = ?1
           UNION ALL
           SELECT follower_id AS user_id, 0 AS reminded FROM follows WHERE creator_id = ?2
         ) x JOIN users u ON u.id = x.user_id
         GROUP BY u.id`,
      )
      .bind(ep.id, ep.creator_id)
      .all<PersonRow>();

    for (const person of people) {
      if (person.user_id === ep.creator_id) continue;
      // In-app notice plus a push to every registered phone (logged per device).
      await notify(db, person.user_id, 'release', body, link);

      if (!emailConfigured(env) || person.release_emails !== 1 || person.email_verified !== 1) continue;
      try {
        const token = await unsubToken(db, person);
        const unsubscribeUrl = `${site}/api/email/unsubscribe?u=${encodeURIComponent(person.user_id)}&t=${token}`;
        const message = releaseEmail({
          site,
          titleName: ep.title_name,
          season: ep.season,
          episode: ep.episode,
          episodeName: ep.name,
          episodeId: ep.id,
          creatorHandle: ep.creator_handle,
          recipientName: person.display_name,
          reminded: person.reminded === 1,
          unsubscribeUrl,
        });
        await sendEmail(env, {
          to: person.email,
          ...message,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        await logDelivery(db, { channel: 'email', source: 'release', userId: person.user_id, target: person.email.split('@')[1] ?? null, ok: true, status: 200, error: null });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Email failed.';
        console.error('release_email_failed', error);
        await logDelivery(db, { channel: 'email', source: 'release', userId: person.user_id, target: person.email.split('@')[1] ?? null, ok: false, status: 0, error });
      }
    }
    await db.prepare('DELETE FROM release_reminders WHERE episode_id = ?').bind(ep.id).run();
  }
  return results.length;
}
