import type { Env } from '../env';
import { emailConfigured, sendEmailBatch } from './email';
import type { BatchEmail } from './email';
import { logDelivery, sendPushToUserIds } from './fcm';
import { nowIso } from './http';
import { membershipActiveSql } from './scoutMembership';

/**
 * Release announcements. Every way an episode becomes watchable (a scheduled
 * release passing, an admin accepting a submission, a creator publishing a
 * title or adding an episode, a Verbatiim import, an unsuppress) converges
 * here: the 10-minute cron picks up titles with watchable, not-yet-announced
 * episodes, claims all of each title's due episodes together, and announces
 * them once.
 *
 *  - In-app notice and phone push: members who tapped "Notify me" on one of
 *    the episodes, plus the creator's followers.
 *  - Email: Notify-me holders and followers always; every other member with a
 *    verified address and release emails on only for vetted titles (an admin
 *    accepted the submission, or the creator is official or identity-verified),
 *    at most once per title per 20 hours and three times per creator per day.
 *    Until MAIL_POSTAL_ADDRESS is set (CAN-SPAM), only Notify-me emails go out.
 *
 * Instant clips and photo posts never get email; a scheduled one still gets
 * its in-app notice and push, and an unscheduled one is never announced.
 */

/** Titles announced per tick (all of a title's due episodes go together). */
const TITLE_BATCH = 5;
/** Wait this long after the newest unscheduled episode before announcing, so one-by-one uploads land as one email. */
const SETTLE_MINUTES = 20;
const MEMBER_WIDE_TITLE_COOLDOWN_HOURS = 20;
const MEMBER_WIDE_PER_CREATOR_PER_DAY = 3;
const RESEND_BATCH_MAX = 100;
/** Resend batches sent per tick. */
const BATCHES_PER_TICK = 5;
const MAX_ATTEMPTS = 5;

const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const BLOCKED_EITHER_WAY = (userCol: string, creatorParam: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${userCol} AND b.blocked_id = ${creatorParam}) OR (b.blocker_id = ${creatorParam} AND b.blocked_id = ${userCol}))`;
/** Accounts that may receive release email at all. */
const EMAILABLE = (u: string) =>
  `${u}.email_verified = 1 AND ${u}.release_emails = 1 AND ${u}.is_demo = 0
   AND ${u}.email NOT LIKE '%@demo.sweam' AND ${u}.email NOT LIKE '%@seed.sweam'
   AND ${u}.password_hash LIKE 'pbkdf2$%'`;

interface ClaimedEpisode {
  id: string;
  season: number;
  episode: number;
  name: string;
  release_at: string | null;
  is_clip: number;
}

interface TitleInfo {
  id: string;
  name: string;
  slug: string;
  kind: string;
  synopsis: string;
  poster_url: string | null;
  hero_url: string | null;
  is_blu: number;
  /** The creator's Sweam Blu subscription price (what checkout charges). */
  blu_price_cents: number | null;
  admin_locked: number;
  creator_id: string;
  creator_name: string;
  creator_handle: string | null;
  creator_official: number;
  creator_verified: number;
  episode_count: number;
  /** Published, not suppressed, no active takedown. */
  visible: number;
}

interface EpisodeInfo {
  id: string;
  season: number;
  episode: number;
  name: string;
  synopsis: string;
  thumbnail_url: string | null;
}

export interface AnnouncementContent {
  title: TitleInfo;
  episodes: EpisodeInfo[];
}

function siteUrl(env: Env): string {
  return (env.PUBLIC_WEB_URL ?? 'https://sweam.co').replace(/\/+$/, '');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/**
 * An image hosted by Sweam that a mail client can load without a session, or
 * null. External URLs are never embedded: they would let a third party see who
 * opened the email.
 */
export function emailImageUrl(site: string, url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/media/') && !url.startsWith('/media/verify/') && /\.(png|jpe?g|webp|gif)$/i.test(url)) {
    return `${site}${url}`;
  }
  return null;
}

function episodeLabel(ep: { season: number; episode: number; name: string }): string {
  return `S${ep.season} E${ep.episode}: ${ep.name}`;
}

/** A single-episode standalone title (a film, a short) reads as the title itself. */
function isStandalone(content: AnnouncementContent): boolean {
  return content.title.kind !== 'series' && content.title.episode_count <= 1 && content.episodes.length === 1;
}

/** The headline used in the subject, the in-app notice and the push. */
export function announcementHeadline(content: AnnouncementContent): { subject: string; notice: string } {
  const { title, episodes } = content;
  if (isStandalone(content)) {
    return { subject: `New on Sweam: ${title.name}`, notice: `New on Sweam: ${title.name}.` };
  }
  if (episodes.length === 1) {
    const ep = episodes[0]!;
    return {
      subject: `Out now: ${title.name}, ${episodeLabel(ep)}`,
      notice: `Out now: ${title.name}, S${ep.season} E${ep.episode}, ${ep.name}.`,
    };
  }
  return {
    subject: `Out now: ${title.name}, ${episodes.length} new episodes`,
    notice: `Out now: ${title.name}, ${episodes.length} new episodes.`,
  };
}

export type ReleaseReason = 'reminder' | 'follower' | 'member';

/** The release email for one member. Pure, so it is unit-tested. */
export function releaseEmail(opts: {
  site: string;
  content: AnnouncementContent;
  recipientName: string;
  reason: ReleaseReason;
  /** False for a Sweam Blu title this member cannot watch yet. */
  canWatch: boolean;
  unsubscribeUrl: string;
  postalAddress?: string;
}): { subject: string; html: string; text: string } {
  const { site, content, reason, canWatch } = opts;
  const { title, episodes } = content;
  const { subject } = announcementHeadline(content);
  const titleUrl = `${site}/t/${title.slug}`;
  const single = episodes.length === 1 ? episodes[0]! : null;
  const watchUrl = single ? `${site}/watch/${single.id}` : titleUrl;
  const ctaUrl = canWatch ? watchUrl : titleUrl;
  const ctaLabel = canWatch ? (single ? 'Watch now' : 'Watch the new episodes') : 'Subscribe to watch';
  const settingsUrl = `${site}/settings`;
  const standalone = isStandalone(content);
  const by = title.creator_handle ? `@${title.creator_handle}` : title.creator_name;
  const lead = standalone
    ? `${title.name} by ${by} is now streaming on Sweam.`
    : single
      ? `${episodeLabel(single)} is out now.`
      : `${episodes.length} new episodes are out now.`;
  const synopsis = clip((single && !standalone ? single.synopsis : '') || title.synopsis || '', 260);
  const why =
    reason === 'reminder'
      ? 'You asked Sweam to tell you when this released.'
      : reason === 'follower'
        ? `You follow ${by} on Sweam.`
        : 'Release emails are on for your Sweam account. This is a promotional email about new releases on Sweam.';
  const blu =
    title.is_blu === 1
      ? canWatch
        ? 'Sweam Blu: included with your subscription.'
        : `Sweam Blu: for subscribers${title.blu_price_cents ? `, $${(title.blu_price_cents / 100).toFixed(2)} a month` : ''}.`
      : null;
  const hero = emailImageUrl(site, title.hero_url);
  const image = hero ?? emailImageUrl(site, single?.thumbnail_url) ?? emailImageUrl(site, title.poster_url);
  // Only a hero banner is known to be wide; covers and posters are often tall, so
  // they render at a fixed width that keeps the Watch button near the top on phones.
  const imageIsWide = image !== null && image === hero;
  const company = opts.postalAddress ? `Falcyn Inc, doing business as Sweam, ${opts.postalAddress}` : 'Falcyn Inc, doing business as Sweam';

  const text = [
    `Hi ${opts.recipientName},`,
    '',
    `${title.name}`,
    lead,
    ...(synopsis ? ['', synopsis] : []),
    ...(blu ? ['', blu] : []),
    ...(episodes.length > 1 ? ['', ...episodes.map((ep) => `- ${episodeLabel(ep)}: ${site}/watch/${ep.id}`)] : []),
    '',
    `${ctaLabel}: ${ctaUrl}`,
    '',
    '--',
    why,
    `Stop release emails: ${opts.unsubscribeUrl}`,
    `Notification settings: ${settingsUrl}`,
    company,
  ].join('\n');

  const episodeRows =
    episodes.length > 1
      ? `<tr><td style="padding:16px 28px 0">${episodes
          .map(
            (ep) =>
              `<p style="margin:0 0 8px;font-size:15px;line-height:1.4"><a href="${escapeHtml(`${site}/watch/${ep.id}`)}" style="color:#4de0f3;text-decoration:none;font-weight:700">${escapeHtml(episodeLabel(ep))}</a></p>`,
          )
          .join('')}</td></tr>`
      : '';
  const imageRow = image
    ? `<tr><td style="padding:0"><img src="${escapeHtml(image)}" alt="${escapeHtml(`${title.name} cover art`)}" width="${imageIsWide ? 560 : 240}" style="display:block;${imageIsWide ? 'width:100%;max-width:560px;border-radius:12px 12px 0 0' : 'width:240px;margin:24px auto 0;border-radius:10px'};height:auto;border:0"></td></tr>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#080e19;font-family:Arial,Helvetica,sans-serif;color:#f4f7ff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(clip(lead + (synopsis ? ` ${synopsis}` : ''), 140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080e19"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px"><img src="${escapeHtml(`${site}/brand/sweam-wordmark-dark.png`)}" alt="Sweam" width="120" style="display:block;width:120px;height:auto;border:0"></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111c2d;border-radius:12px">
${imageRow}
<tr><td style="padding:24px 28px 0;font-size:15px;color:#a5b5cd">Hi ${escapeHtml(opts.recipientName)},</td></tr>
<tr><td style="padding:10px 28px 0"><h1 style="margin:0;font-size:26px;line-height:1.25;color:#f4f7ff">${escapeHtml(title.name)}</h1>
<p style="margin:8px 0 0;font-size:17px;line-height:1.4;color:#4de0f3;font-weight:700">${escapeHtml(lead)}</p></td></tr>
${synopsis ? `<tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.55;color:#d6deeb">${escapeHtml(synopsis)}</td></tr>` : ''}
${blu ? `<tr><td style="padding:12px 28px 0;font-size:14px;line-height:1.5;color:#a5b5cd">${escapeHtml(blu)}</td></tr>` : ''}
${episodeRows}
<tr><td style="padding:22px 28px 28px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#4de0f3;color:#04121a;text-decoration:none;font-weight:700;font-size:16px;padding:13px 26px;border-radius:999px">${escapeHtml(ctaLabel)}</a></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:#8796ad">${escapeHtml(why)}<br>
<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#a5b5cd">Stop release emails</a> &middot; <a href="${escapeHtml(settingsUrl)}" style="color:#a5b5cd">Notification settings</a><br>
${escapeHtml(company)}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}

/** Load what an announcement needs, including whether the title is still visible to members. */
export async function loadAnnouncementContent(
  db: D1Database,
  titleId: string,
  episodeIds: string[],
): Promise<AnnouncementContent | null> {
  const title = await db
    .prepare(
      `SELECT t.id, t.name, t.slug, t.kind, t.synopsis, t.poster_url, t.hero_url, t.is_blu,
         COALESCE(cp.blu_price_cents, t.blu_price_cents) AS blu_price_cents, t.admin_locked,
         t.creator_id, cu.display_name AS creator_name, cp.handle AS creator_handle,
         cu.official AS creator_official, cu.verified AS creator_verified,
         (SELECT COUNT(*) FROM episodes x WHERE x.title_id = t.id) AS episode_count,
         (t.published = 1 AND t.suppressed = 0
           AND NOT EXISTS (SELECT 1 FROM takedowns tk WHERE tk.title_id = t.id AND tk.released_at IS NULL)) AS visible
       FROM titles t JOIN users cu ON cu.id = t.creator_id
       LEFT JOIN creator_profiles cp ON cp.user_id = t.creator_id
       WHERE t.id = ?`,
    )
    .bind(titleId)
    .first<TitleInfo>();
  if (!title) return null;
  const { results } = await db
    .prepare(
      `SELECT id, season, episode, name, synopsis, thumbnail_url FROM episodes
       WHERE id IN (SELECT value FROM json_each(?)) ORDER BY season, episode`,
    )
    .bind(JSON.stringify(episodeIds))
    .all<EpisodeInfo>();
  if (results.length === 0) return null;
  return { title, episodes: results };
}

/**
 * Pick up titles with watchable, not-yet-announced episodes, announce them
 * (email queue first, then in-app and push), sweep late Notify-me reminders,
 * then send queued email. Returns what it did, for the admin button and logs.
 */
export async function announceReleasedEpisodes(env: Env): Promise<{ announced: number; queued: number; emailed: number }> {
  const db = env.DB;
  const now = nowIso();
  await db.prepare(`DELETE FROM delivery_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')`).run().catch(() => undefined);
  await db
    .prepare(`DELETE FROM email_outbox WHERE status IN ('sent', 'skipped', 'failed') AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days')`)
    .run()
    .catch(() => undefined);

  const settledBefore = new Date(Date.now() - SETTLE_MINUTES * 60_000).toISOString();
  const { results: dueTitles } = await db
    .prepare(
      `SELECT e.title_id, MIN(COALESCE(e.release_at, e.created_at)) AS first_due
       FROM episodes e JOIN titles t ON t.id = e.title_id
       WHERE e.release_notified_at IS NULL
         AND (e.release_at IS NULL OR e.release_at <= ?1)
         AND (e.release_at IS NOT NULL OR e.is_clip = 0)
         AND t.published = 1 AND t.suppressed = 0
         AND NOT EXISTS (SELECT 1 FROM takedowns tk WHERE tk.title_id = t.id AND tk.released_at IS NULL)
       GROUP BY e.title_id
       HAVING MAX(CASE WHEN e.release_at IS NULL THEN e.created_at END) IS NULL
           OR MAX(CASE WHEN e.release_at IS NULL THEN e.created_at END) <= ?2
       ORDER BY first_due
       LIMIT ${TITLE_BATCH}`,
    )
    .bind(now, settledBefore)
    .all<{ title_id: string }>();

  let announced = 0;
  let queued = 0;
  for (const { title_id } of dueTitles) {
    try {
      // Claim every due episode of the title in one statement: a title is never split.
      const { results: claimed } = await db
        .prepare(
          `UPDATE episodes SET release_notified_at = ?1
           WHERE title_id = ?2 AND release_notified_at IS NULL
             AND (release_at IS NULL OR release_at <= ?1)
             AND (release_at IS NOT NULL OR is_clip = 0)
           RETURNING id, season, episode, name, release_at, is_clip`,
        )
        .bind(now, title_id)
        .all<ClaimedEpisode>();
      if (claimed.length === 0) continue;
      announced += claimed.length;
      const releases = claimed.filter((e) => e.is_clip !== 1);
      const clips = claimed.filter((e) => e.is_clip === 1);
      if (releases.length) queued += await announce(env, title_id, releases, 'release', now);
      if (clips.length) await announce(env, title_id, clips, 'release', now, true);
    } catch (err) {
      console.error('release_announce_title_failed', title_id, err);
    }
  }

  // Late reminders: Notify me holders of an episode announced earlier (for
  // example one pulled back to a future date and released again).
  try {
    const { results: late } = await db
      .prepare(
        `SELECT DISTINCT rr.episode_id, e.title_id, e.is_clip
         FROM release_reminders rr JOIN episodes e ON e.id = rr.episode_id JOIN titles t ON t.id = e.title_id
         WHERE e.release_notified_at IS NOT NULL
           AND (e.release_at IS NULL OR e.release_at <= ?1)
           AND t.published = 1 AND t.suppressed = 0
         LIMIT 20`,
      )
      .bind(now)
      .all<{ episode_id: string; title_id: string; is_clip: number }>();
    const byTitle = new Map<string, string[]>();
    for (const r of late) byTitle.set(r.title_id, [...(byTitle.get(r.title_id) ?? []), r.episode_id]);
    for (const [titleId, ids] of byTitle) {
      const eps = ids.map((id) => ({ id, season: 0, episode: 0, name: '', release_at: null, is_clip: late.find((x) => x.episode_id === id)?.is_clip ?? 0 }));
      queued += await announce(env, titleId, eps, 'reminders', now, eps.every((e) => e.is_clip === 1));
    }
  } catch (err) {
    console.error('release_reminder_sweep_failed', err);
  }

  const emailed = await drainEmailOutbox(env).catch((err) => {
    console.error('release_email_drain_failed', err);
    return 0;
  });
  return { announced, queued, emailed };
}

async function announce(
  env: Env,
  titleId: string,
  episodes: ClaimedEpisode[],
  mode: 'release' | 'reminders',
  now: string,
  isClip = false,
): Promise<number> {
  const db = env.DB;
  const ids = episodes.map((e) => e.id);
  const idsJson = JSON.stringify(ids);
  const content = await loadAnnouncementContent(db, titleId, ids);
  if (!content) return 0;
  const { title } = content;
  const creatorId = title.creator_id;
  const { notice } = announcementHeadline(content);
  const link = ids.length === 1 ? `/watch/${ids[0]}` : `/t/${title.slug}`;
  const postalSet = Boolean(env.MAIL_POSTAL_ADDRESS && env.MAIL_POSTAL_ADDRESS.trim());

  // Member-wide email only for vetted titles, within the caps, with the postal address set.
  let memberWide = false;
  if (mode === 'release' && !isClip && postalSet) {
    const vetted = title.admin_locked === 1 || title.creator_official === 1 || title.creator_verified === 1;
    if (vetted) {
      const recentTitle = await db
        .prepare('SELECT 1 AS x FROM release_announcements WHERE title_id = ? AND member_wide = 1 AND created_at > ? LIMIT 1')
        .bind(titleId, hoursAgoIso(MEMBER_WIDE_TITLE_COOLDOWN_HOURS))
        .first();
      const creatorToday = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM release_announcements a JOIN titles t2 ON t2.id = a.title_id
           WHERE t2.creator_id = ? AND a.member_wide = 1 AND a.created_at > ?`,
        )
        .bind(creatorId, hoursAgoIso(24))
        .first<{ n: number }>();
      memberWide = !recentTitle && (creatorToday?.n ?? 0) < MEMBER_WIDE_PER_CREATOR_PER_DAY;
    }
  }

  const announcementId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO release_announcements (id, title_id, episode_ids, mode, is_clip, member_wide, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(announcementId, titleId, idsJson, mode, isClip ? 1 : 0, memberWide ? 1 : 0, now)
    .run();

  // 1. Queue email first, so a later failure (push, D1 limits) cannot lose it.
  let queued = 0;
  if (!isClip && emailConfigured(env)) {
    const followersToo = mode === 'release' && postalSet ? 1 : 0;
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO email_outbox (announcement_id, user_id, reason, status, attempts, created_at)
         SELECT ?3, u.id,
           CASE
             WHEN EXISTS (SELECT 1 FROM release_reminders rr WHERE rr.user_id = u.id AND rr.episode_id IN (SELECT value FROM json_each(?1))) THEN 'reminder'
             WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.creator_id = ?2) THEN 'follower'
             ELSE 'member'
           END,
           'queued', 0, ?4
         FROM users u
         WHERE ${EMAILABLE('u')}
           AND u.id <> ?2
           AND ${BLOCKED_EITHER_WAY('u.id', '?2')}
           AND (
             EXISTS (SELECT 1 FROM release_reminders rr WHERE rr.user_id = u.id AND rr.episode_id IN (SELECT value FROM json_each(?1)))
             OR (?5 = 1 AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.creator_id = ?2))
             OR ?6 = 1
           )`,
      )
      .bind(idsJson, creatorId, announcementId, now, followersToo, memberWide ? 1 : 0)
      .run();
    queued = res.meta.changes ?? 0;
  }

  // 2. In-app notice and push: Notify me holders, plus followers for a release.
  const audience = `
    SELECT r.user_id FROM (
      SELECT user_id FROM release_reminders WHERE episode_id IN (SELECT value FROM json_each(?1))
      ${mode === 'release' ? 'UNION SELECT follower_id AS user_id FROM follows WHERE creator_id = ?2' : ''}
    ) r
    WHERE r.user_id <> ?2 AND ${BLOCKED_EITHER_WAY('r.user_id', '?2')}`;
  const { results: people } = await db.prepare(audience).bind(idsJson, creatorId).all<{ user_id: string }>();
  if (people.length > 0) {
    await db
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, body, link, read, created_at)
         SELECT lower(hex(randomblob(16))), a.user_id, 'release', ?3, ?4, 0, ?5 FROM (${audience}) a`,
      )
      .bind(idsJson, creatorId, notice, link, now)
      .run();
    await sendPushToUserIds(db, people.map((p) => p.user_id), 'Sweam', notice, link, 'release').catch((err) =>
      console.error('release_push_failed', err),
    );
  }

  await db
    .prepare('UPDATE release_announcements SET notified_users = ?, email_recipients = ? WHERE id = ?')
    .bind(people.length, queued, announcementId)
    .run();
  await db.prepare('DELETE FROM release_reminders WHERE episode_id IN (SELECT value FROM json_each(?))').bind(idsJson).run();
  console.log('release_announced', mode, titleId, ids.length, 'notified', people.length, 'emails_queued', queued, 'member_wide', memberWide);
  return queued;
}

interface OutboxRow {
  id: number;
  announcement_id: string;
  user_id: string;
  reason: ReleaseReason;
  attempts: number;
  email: string;
  display_name: string;
  email_unsub_token: string | null;
  eligible: number;
  title_id: string;
  episode_ids: string;
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ids of members (from the given list) who can watch a creator's Sweam Blu titles. */
async function bluAccessSet(db: D1Database, creatorId: string, userIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < userIds.length; i += 90) {
    const chunk = JSON.stringify(userIds.slice(i, i + 90));
    const { results } = await db
      .prepare(
        `SELECT bs.subscriber_id AS user_id FROM blu_subscriptions bs
         WHERE bs.creator_id = ?1 AND bs.status = 'active'
           AND (bs.current_period_end IS NULL OR bs.current_period_end > ${SQL_NOW})
           AND bs.subscriber_id IN (SELECT value FROM json_each(?2))
         UNION
         SELECT sp.user_id FROM scout_profiles sp JOIN scout_all_access saa ON saa.user_id = sp.user_id
         WHERE sp.status = 'approved' AND ${membershipActiveSql('saa')}
           AND sp.user_id IN (SELECT value FROM json_each(?2))`,
      )
      .bind(creatorId, chunk)
      .all<{ user_id: string }>();
    for (const r of results) out.add(r.user_id);
  }
  return out;
}

/** Load a leased batch with everything needed to build and gate each email. */
async function loadBatch(db: D1Database, batchKey: string): Promise<OutboxRow[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.announcement_id, o.user_id, o.reason, o.attempts,
         u.email, u.display_name, u.email_unsub_token,
         (${EMAILABLE('u')} AND ${BLOCKED_EITHER_WAY('u.id', 't.creator_id')}) AS eligible,
         a.title_id, a.episode_ids
       FROM email_outbox o
       JOIN users u ON u.id = o.user_id
       JOIN release_announcements a ON a.id = o.announcement_id
       JOIN titles t ON t.id = a.title_id
       WHERE o.batch_key = ? AND o.status = 'sending'
       ORDER BY o.id`,
    )
    .bind(batchKey)
    .all<OutboxRow>();
  return results;
}

async function requeue(db: D1Database, ids: number[], error: string | null, bump: boolean): Promise<void> {
  if (ids.length === 0) return;
  await db
    .prepare(
      `UPDATE email_outbox SET
         status = CASE WHEN ?3 = 1 AND attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
         attempts = attempts + ?3, batch_key = NULL, last_error = ?2
       WHERE id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(ids), error, bump ? 1 : 0)
    .run();
}

/**
 * Send one leased batch. Returns 'stop' when the provider is unavailable or
 * misconfigured (the batch stays leased and is retried with the same key next
 * tick, without using up attempts), otherwise the number of emails sent.
 */
async function sendBatch(env: Env, batchKey: string, site: string): Promise<number | 'stop'> {
  const db = env.DB;
  const rows = await loadBatch(db, batchKey);
  if (rows.length === 0) return 0;
  const content = await loadAnnouncementContent(db, rows[0]!.title_id, JSON.parse(rows[0]!.episode_ids) as string[]);

  // Gate at send time: the title must still be visible, the member still eligible.
  const skipIds = rows.filter((r) => !content || content.title.visible !== 1 || r.eligible !== 1).map((r) => r.id);
  if (skipIds.length) {
    await db
      .prepare(`UPDATE email_outbox SET status = 'skipped', batch_key = NULL, last_error = ? WHERE id IN (SELECT value FROM json_each(?))`)
      .bind(content && content.title.visible === 1 ? 'No longer eligible (opted out, unverified or blocked).' : 'The title is no longer visible.', JSON.stringify(skipIds))
      .run();
  }
  const live = rows.filter((r) => !skipIds.includes(r.id));
  if (live.length === 0 || !content) return 0;

  // Every recipient needs an unsubscribe token before the link is built.
  const missing = live.filter((r) => !r.email_unsub_token);
  if (missing.length) {
    await db.batch(
      missing.map((r) =>
        db.prepare('UPDATE users SET email_unsub_token = COALESCE(email_unsub_token, ?) WHERE id = ?').bind(randomToken(), r.user_id),
      ),
    );
    const { results } = await db
      .prepare('SELECT id, email_unsub_token FROM users WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(missing.map((r) => r.user_id)))
      .all<{ id: string; email_unsub_token: string }>();
    const byId = new Map(results.map((x) => [x.id, x.email_unsub_token]));
    for (const r of missing) r.email_unsub_token = byId.get(r.user_id) ?? null;
  }

  const access = content.title.is_blu === 1 ? await bluAccessSet(db, content.title.creator_id, live.map((r) => r.user_id)) : null;
  const sendable = live.filter((r) => r.email_unsub_token);
  const noToken = live.filter((r) => !r.email_unsub_token).map((r) => r.id);
  if (noToken.length) await requeue(db, noToken, 'Could not create the unsubscribe token.', true);
  const messages: BatchEmail[] = sendable.map((r) => {
    const unsubscribeUrl = `${site}/api/email/unsubscribe?u=${encodeURIComponent(r.user_id)}&t=${r.email_unsub_token}`;
    const m = releaseEmail({
      site,
      content,
      recipientName: r.display_name,
      reason: r.reason,
      canWatch: access === null || access.has(r.user_id),
      unsubscribeUrl,
      postalAddress: env.MAIL_POSTAL_ADDRESS?.trim() || undefined,
    });
    return {
      to: r.email,
      ...m,
      headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      tags: [{ name: 'category', value: 'release' }],
    };
  });
  if (messages.length === 0) return 0;

  const result = await sendEmailBatch(env, messages, batchKey);
  await logDelivery(db, { channel: 'email', source: 'release', userId: null, target: `batch of ${messages.length}`, ok: result.ok, status: result.status, error: result.error });

  // The key was already used for this batch: Resend accepted it on an earlier try.
  const alreadySent = !result.ok && result.status === 409 && /invalid_idempotent_request/i.test(result.error ?? '');
  if (result.ok || alreadySent) {
    const failed = new Map(result.itemErrors.map((e) => [e.index, e.message]));
    const sentRows = sendable.filter((_, i) => !failed.has(i));
    const idMap: Record<string, string> = {};
    sendable.forEach((r, i) => {
      const id = result.ids[i];
      if (id && !failed.has(i)) idMap[String(r.id)] = id;
    });
    if (sentRows.length) {
      await db
        .prepare(
          `UPDATE email_outbox SET status = 'sent', sent_at = ?1, batch_key = NULL, last_error = NULL,
             attempts = attempts + 1,
             resend_id = (SELECT j.value FROM json_each(?2) j WHERE j.key = CAST(email_outbox.id AS TEXT))
           WHERE id IN (SELECT value FROM json_each(?3))`,
        )
        .bind(nowIso(), JSON.stringify(idMap), JSON.stringify(sentRows.map((r) => r.id)))
        .run();
    }
    for (const [index, message] of failed) {
      const row = sendable[index];
      if (row) await requeue(db, [row.id], message, true);
    }
    return sentRows.length;
  }
  if (result.retryable || result.status === 401 || result.status === 403) {
    // Provider down, rate or quota limited, or a key/domain problem: keep the
    // lease (same key next time) and stop for this tick without using attempts.
    await db.prepare('UPDATE email_outbox SET last_error = ? WHERE batch_key = ?').bind(result.error, batchKey).run();
    console.error('release_email_batch_deferred', result.status, result.error);
    return 'stop';
  }
  // A request Resend rejected outright (malformed): count an attempt and requeue.
  await requeue(db, sendable.map((r) => r.id), result.error, true);
  return 0;
}

/**
 * Send queued release emails in leased Resend batches of 100. A batch is
 * leased (status 'sending' plus a batch_key) before it is sent, so a retry
 * resends exactly the same rows under the same idempotency key.
 */
export async function drainEmailOutbox(env: Env, maxBatches = BATCHES_PER_TICK): Promise<number> {
  if (!emailConfigured(env)) return 0;
  const db = env.DB;
  const site = siteUrl(env);
  let sent = 0;
  let batches = 0;

  // Batches leased on an earlier tick that never finished.
  const { results: pending } = await db
    .prepare(`SELECT DISTINCT batch_key FROM email_outbox WHERE status = 'sending' AND batch_key IS NOT NULL LIMIT ${maxBatches}`)
    .all<{ batch_key: string }>();
  for (const { batch_key } of pending) {
    const r = await sendBatch(env, batch_key, site);
    batches++;
    if (r === 'stop') return sent;
    sent += r;
  }

  while (batches < maxBatches) {
    const next = await db
      .prepare(`SELECT announcement_id FROM email_outbox WHERE status = 'queued' AND attempts < ${MAX_ATTEMPTS} ORDER BY id LIMIT 1`)
      .first<{ announcement_id: string }>();
    if (!next) break;
    const batchKey = `sweam-release-${next.announcement_id}-${crypto.randomUUID()}`;
    const leased = await db
      .prepare(
        `UPDATE email_outbox SET status = 'sending', batch_key = ?1, last_error = NULL
         WHERE id IN (
           SELECT id FROM email_outbox
           WHERE announcement_id = ?2 AND status = 'queued' AND attempts < ${MAX_ATTEMPTS}
           ORDER BY id LIMIT ${RESEND_BATCH_MAX}
         )`,
      )
      .bind(batchKey, next.announcement_id)
      .run();
    if ((leased.meta.changes ?? 0) === 0) break;
    const r = await sendBatch(env, batchKey, site);
    batches++;
    if (r === 'stop') return sent;
    sent += r;
  }
  return sent;
}
