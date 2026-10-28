import type { Env } from '../env';
import { nowIso } from './http';

/**
 * Sends Sweam's activity to PM Bestie Analytics, the event analytics inside
 * the Sweam product workspace on pmbestie.net (Falcyn's own tool, no outside
 * vendor). It runs on the 10-minute release timer:
 *
 *  - each source below reads rows newer than its saved cursor (sync_cursors),
 *  - every row becomes one or more events with a stable id, so a row that is
 *    sent twice is stored once (PM Bestie ignores ids it has already seen),
 *  - outside people go to the LIVE key; the team, house accounts, the store
 *    review account and anyone listed in PMB_TEAM_USER_IDS go to the TEST key;
 *    demo and seed accounts are never sent,
 *  - a source's cursor moves only after PM Bestie accepted its events.
 *
 * No email address, name, password, payment or IP data is sent: people are
 * identified by Sweam's internal user id, web visitors by the daily,
 * unlinkable visitor hash the first-party analytics already stores.
 */

export interface PmbEvent {
  id: string;
  event: string;
  user_id?: string;
  anonymous_id?: string;
  timestamp: string;
  properties: Record<string, string | number | boolean | null>;
}

type Row = Record<string, unknown>;

interface Source {
  name: string;
  /** ?1 = cursor (inclusive), ?2 = row limit. Must return a `ts` column. */
  sql: string;
  limit: number;
  events(row: Row): PmbEvent[];
}

const DEFAULT_URL = 'https://pmbestie.net/api/collect';
const BATCH = 100;
const MAX_PAGES_PER_SOURCE = 4;
const LONG_FORM_SECONDS = 600;

const s = (v: unknown): string => (v == null ? '' : String(v));
const minutes = (seconds: unknown): number | null =>
  typeof seconds === 'number' && seconds > 0 ? Math.round((seconds / 60) * 10) / 10 : null;

/** Stable event id, at most 80 characters (PM Bestie's limit). */
export function eventId(...parts: string[]): string {
  return parts.join(':').slice(0, 80);
}

function userEvent(id: string, event: string, uid: unknown, ts: unknown, properties: PmbEvent['properties'] = {}): PmbEvent {
  return { id, event, user_id: s(uid), timestamp: s(ts), properties };
}

export const SOURCES: Source[] = [
  {
    name: 'accounts',
    sql: `SELECT id AS uid, created_at AS ts, email_verified FROM users WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 200,
    events: (r) => [userEvent(eventId('acct', s(r.uid)), 'account_created', r.uid, r.ts, { email_verified: r.email_verified === 1 })],
  },
  {
    name: 'creator_profiles',
    sql: `SELECT user_id AS uid, created_at AS ts, handle FROM creator_profiles WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 200,
    events: (r) => [userEvent(eventId('crp', s(r.uid)), 'creator_profile_created', r.uid, r.ts, { creator_handle: s(r.handle) })],
  },
  {
    name: 'titles_published',
    sql: `SELECT id, creator_id AS uid, published_at AS ts, kind, name, is_blu FROM titles
          WHERE published = 1 AND published_at IS NOT NULL AND published_at >= ?1 ORDER BY published_at LIMIT ?2`,
    limit: 200,
    events: (r) => [
      userEvent(eventId('tp', s(r.id)), 'title_published', r.uid, r.ts, {
        title_id: s(r.id),
        title_name: s(r.name),
        catalog_kind: s(r.kind),
        blu: r.is_blu === 1,
      }),
    ],
  },
  {
    name: 'episodes',
    sql: `SELECT e.id, t.creator_id AS uid, e.created_at AS ts, e.title_id, t.name, e.is_clip, e.media_type, e.duration_s, e.release_at
          FROM episodes e JOIN titles t ON t.id = e.title_id WHERE e.created_at >= ?1 ORDER BY e.created_at LIMIT ?2`,
    limit: 200,
    events: (r) => [
      userEvent(eventId('ep', s(r.id)), r.is_clip === 1 ? 'clip_created' : 'episode_added', r.uid, r.ts, {
        title_id: s(r.title_id),
        title_name: s(r.name),
        episode_id: s(r.id),
        media_type: s(r.media_type) || 'video',
        duration_minutes: minutes(r.duration_s),
        scheduled: Boolean(r.release_at && s(r.release_at) > s(r.ts)),
      }),
    ],
  },
  {
    name: 'uploads',
    sql: `SELECT j.id, t.creator_id AS uid, j.updated_at AS ts, j.episode_id, e.title_id, j.audio_mode
          FROM transcode_jobs j JOIN episodes e ON e.id = j.episode_id JOIN titles t ON t.id = e.title_id
          WHERE j.status = 'done' AND j.updated_at >= ?1 ORDER BY j.updated_at LIMIT ?2`,
    limit: 200,
    events: (r) => [
      userEvent(eventId('up', s(r.id)), 'upload_completed', r.uid, r.ts, {
        title_id: s(r.title_id),
        episode_id: s(r.episode_id),
        audio_mode: s(r.audio_mode) || 'keep',
      }),
    ],
  },
  {
    name: 'submissions',
    sql: `SELECT id, user_id AS uid, created_at AS ts, kind, is_adaptation FROM submissions WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 200,
    events: (r) => [userEvent(eventId('sub', s(r.id)), 'submission_received', r.uid, r.ts, { catalog_kind: s(r.kind), adaptation: r.is_adaptation === 1 })],
  },
  {
    name: 'submission_decisions',
    sql: `SELECT id, user_id AS uid, decided_at AS ts, status FROM submissions
          WHERE decided_at IS NOT NULL AND decided_at >= ?1 ORDER BY decided_at LIMIT ?2`,
    limit: 200,
    events: (r) => [userEvent(eventId('subd', s(r.id)), 'submission_decided', r.uid, r.ts, { decision: s(r.status) })],
  },
  {
    // Signed-in watch progress (the web player). Rows update as people watch, so
    // the same row is read again; the stable ids keep one start and one finish.
    name: 'watching',
    sql: `SELECT p.user_id AS uid, p.updated_at AS ts, p.episode_id, e.title_id, t.name, p.completed, p.duration_s
          FROM progress p JOIN episodes e ON e.id = p.episode_id JOIN titles t ON t.id = e.title_id
          WHERE p.updated_at >= ?1 ORDER BY p.updated_at LIMIT ?2`,
    limit: 300,
    events: (r) => {
      const props = {
        title_id: s(r.title_id),
        title_name: s(r.name),
        episode_id: s(r.episode_id),
        duration_minutes: minutes(r.duration_s),
        long_form: typeof r.duration_s === 'number' && r.duration_s >= LONG_FORM_SECONDS,
      };
      const out = [userEvent(eventId('vs', s(r.uid), s(r.episode_id)), 'video_started', r.uid, r.ts, props)];
      if (r.completed === 1) {
        out.push(userEvent(eventId('vc', s(r.uid), s(r.episode_id)), 'video_completed', r.uid, r.ts, props));
        // The launch funnel's stage: 70 percent or more of a title 10 minutes or longer.
        if (props.long_form) out.push(userEvent(eventId('vf', s(r.uid), s(r.episode_id)), 'video_finished', r.uid, r.ts, props));
      }
      return out;
    },
  },
  {
    name: 'follows',
    sql: `SELECT follower_id AS uid, created_at AS ts, creator_id FROM follows WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 300,
    events: (r) => [userEvent(eventId('fo', s(r.uid), s(r.creator_id)), 'interaction_made', r.uid, r.ts, { interaction_type: 'follow', creator_id: s(r.creator_id) })],
  },
  {
    name: 'comments',
    sql: `SELECT id, author_id AS uid, created_at AS ts, title_id, parent_id FROM comments WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 300,
    events: (r) => [
      userEvent(eventId('cm', s(r.id)), 'interaction_made', r.uid, r.ts, { interaction_type: r.parent_id ? 'reply' : 'comment', title_id: s(r.title_id) }),
    ],
  },
  {
    name: 'likes',
    sql: `SELECT user_id AS uid, created_at AS ts, title_id FROM likes WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 300,
    events: (r) => [userEvent(eventId('lk', s(r.uid), s(r.title_id)), 'interaction_made', r.uid, r.ts, { interaction_type: 'like', title_id: s(r.title_id) })],
  },
  {
    name: 'watchlist',
    sql: `SELECT user_id AS uid, added_at AS ts, title_id FROM watchlist WHERE added_at >= ?1 ORDER BY added_at LIMIT ?2`,
    limit: 300,
    events: (r) => [userEvent(eventId('wl', s(r.uid), s(r.title_id)), 'watchlist_added', r.uid, r.ts, { title_id: s(r.title_id) })],
  },
  {
    name: 'scout_applications',
    sql: `SELECT user_id AS uid, created_at AS ts FROM scout_profiles WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 200,
    events: (r) => [userEvent(eventId('sa', s(r.uid)), 'scout_application_submitted', r.uid, r.ts)],
  },
  {
    name: 'scout_decisions',
    sql: `SELECT user_id AS uid, decided_at AS ts, status, created_at FROM scout_profiles
          WHERE decided_at IS NOT NULL AND decided_at >= ?1 ORDER BY decided_at LIMIT ?2`,
    limit: 200,
    events: (r) => {
      const hours = Math.max(0, Math.round((Date.parse(s(r.ts)) - Date.parse(s(r.created_at))) / 36e5));
      const approved = r.status === 'approved';
      return [userEvent(eventId('sd', s(r.uid)), approved ? 'scout_approved' : 'scout_declined', r.uid, r.ts, { hours_to_decision: Number.isFinite(hours) ? hours : null })];
    },
  },
  {
    name: 'one_sheet_views',
    sql: `SELECT id, scout_user_id AS uid, viewed_at AS ts, title_id FROM onesheet_views WHERE viewed_at >= ?1 ORDER BY viewed_at LIMIT ?2`,
    limit: 300,
    events: (r) => [userEvent(eventId('os', s(r.id)), 'one_sheet_viewed', r.uid, r.ts, { title_id: s(r.title_id) })],
  },
  {
    name: 'scout_interests',
    sql: `SELECT id, scout_user_id AS uid, created_at AS ts, title_id FROM scout_interests WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 300,
    events: (r) => [userEvent(eventId('si', s(r.id)), 'scout_interest_expressed', r.uid, r.ts, { title_id: s(r.title_id) })],
  },
  {
    name: 'scout_offers',
    sql: `SELECT id, scout_user_id AS uid, created_at AS ts, kind FROM scout_offers WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 300,
    events: (r) => [userEvent(eventId('so', s(r.id)), 'scout_offer_sent', r.uid, r.ts, { offer_kind: s(r.kind) })],
  },
  {
    name: 'scout_memberships',
    sql: `SELECT user_id AS uid, created_at AS ts, status FROM scout_all_access WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 200,
    events: (r) => [userEvent(eventId('sm', s(r.uid)), 'scout_membership_started', r.uid, r.ts, { status: s(r.status) })],
  },
  {
    name: 'blu_subscriptions',
    sql: `SELECT id, subscriber_id AS uid, created_at AS ts, creator_id FROM blu_subscriptions WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 200,
    events: (r) => [userEvent(eventId('bs', s(r.id)), 'blu_subscribed', r.uid, r.ts, { creator_id: s(r.creator_id) })],
  },
  {
    name: 'ucast_votes',
    sql: `SELECT pick_id, user_id AS uid, created_at AS ts FROM ucast_votes WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 300,
    events: (r) => [userEvent(eventId('uv', s(r.uid), s(r.pick_id)), 'ucast_voted', r.uid, r.ts)],
  },
  {
    name: 'push_devices',
    sql: `SELECT user_id AS uid, created_at AS ts, platform FROM push_tokens WHERE created_at >= ?1 ORDER BY created_at LIMIT ?2`,
    limit: 200,
    events: (r) => [userEvent(eventId('pt', s(r.uid), s(r.ts)), 'push_device_registered', r.uid, r.ts, { platform: s(r.platform) })],
  },
  {
    // Consented web page views (analytics.sweam.co). The visitor hash changes
    // every day by design, so a visitor cannot be followed across days or
    // joined to an account. Admin pages are the team and are skipped.
    name: 'web_visits',
    sql: `SELECT id, ts, day, path, ref_host, width_bucket, visitor_hash FROM analytics_hits
          WHERE ts >= ?1 AND path NOT LIKE '/admin%' ORDER BY ts LIMIT ?2`,
    limit: 400,
    events: (r) => webVisitEvents(r),
  },
];

export function webVisitEvents(r: Row): PmbEvent[] {
  const day = s(r.day);
  const hash = s(r.visitor_hash).slice(0, 32);
  const anon = `v${hash}`;
  const path = s(r.path) || '/';
  const base = { anonymous_id: anon, timestamp: s(r.ts) };
  const props = { path, referrer: s(r.ref_host) || '(direct)', width: s(r.width_bucket), platform: 'web' };
  const out: PmbEvent[] = [
    // The first page of the day for this visitor is the visit (ids keep the first one).
    { id: eventId('sv', day, hash), event: 'site_visited', ...base, properties: { ...props, landing_path: path } },
    { id: eventId('pv', s(r.id)), event: 'page_viewed', ...base, properties: props },
  ];
  if (path === '/scout' || path.startsWith('/scout/') || path.startsWith('/scouts')) {
    out.push({ id: eventId('sl', day, hash), event: 'scout_landing_viewed', ...base, properties: props });
  }
  return out;
}

export interface Person {
  id: string;
  demo: number;
  official: number;
  admin: number;
}

/**
 * Split events by who they are about: live (outside people and anonymous web
 * visitors), test (the team), or dropped (demo and seed accounts).
 */
export function splitByAudience(events: PmbEvent[], people: Map<string, Person>, teamIds: Set<string>): { live: PmbEvent[]; test: PmbEvent[]; dropped: number } {
  const live: PmbEvent[] = [];
  const test: PmbEvent[] = [];
  let dropped = 0;
  for (const e of events) {
    if (!e.user_id) {
      live.push(e);
      continue;
    }
    const p = people.get(e.user_id);
    if (p?.demo) dropped++;
    else if (teamIds.has(e.user_id) || p?.official || p?.admin) test.push(e);
    else live.push(e);
  }
  return { live, test, dropped };
}

export function teamIdsFrom(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

async function post(env: Env, key: string, events: PmbEvent[]): Promise<{ ok: boolean; status: number; accepted: number; error?: string }> {
  let accepted = 0;
  for (let i = 0; i < events.length; i += BATCH) {
    const res = await fetch(env.PMB_ANALYTICS_URL || DEFAULT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pmb-key': key, 'user-agent': 'sweam-pmb-sync' },
      body: JSON.stringify({ events: events.slice(i, i + BATCH) }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, accepted, error: text.slice(0, 300) };
    try {
      accepted += Number((JSON.parse(text) as { accepted?: number }).accepted ?? 0);
    } catch {
      /* counted as sent */
    }
  }
  return { ok: true, status: 200, accepted };
}

async function loadPeople(db: D1Database, ids: string[]): Promise<Map<string, Person>> {
  const people = new Map<string, Person>();
  if (!ids.length) return people;
  const { results } = await db
    .prepare(
      `SELECT u.id,
         (u.is_demo = 1 OR u.email LIKE '%@demo.sweam' OR u.email LIKE '%@seed.sweam') AS demo,
         COALESCE(u.official, 0) AS official,
         EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id) AS admin
       FROM users u WHERE u.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<Person>();
  for (const p of results) people.set(p.id, p);
  return people;
}

export interface SyncReport {
  live: number;
  test: number;
  dropped: number;
  sources: Record<string, number>;
  stoppedAt?: string;
  error?: string;
}

/** One sync pass. Safe to run often: unchanged sources cost one small query each. */
export async function syncPmBestie(env: Env): Promise<SyncReport> {
  const report: SyncReport = { live: 0, test: 0, dropped: 0, sources: {} };
  const liveKey = env.PMB_ANALYTICS_LIVE_KEY?.trim();
  if (!liveKey) return report;
  const testKey = env.PMB_ANALYTICS_TEST_KEY?.trim();
  const teamIds = teamIdsFrom(env.PMB_TEAM_USER_IDS);
  const db = env.DB;
  // sync_cursors: migration 0044.
  const { results: cursorRows } = await db.prepare(`SELECT name, value FROM sync_cursors WHERE name LIKE 'pmb:%'`).all<{ name: string; value: string }>();
  const cursors = new Map(cursorRows.map((c) => [c.name, c.value]));

  for (const src of SOURCES) {
    const key = `pmb:${src.name}`;
    for (let page = 0; page < MAX_PAGES_PER_SOURCE; page++) {
      // A saved cursor ends in "|more" when its page was full: rows sharing the
      // last timestamp may remain, so read from it inclusively (ids drop the
      // repeats). Otherwise everything up to it was read: read strictly after.
      const saved = cursors.get(key) ?? '1970-01-01T00:00:00.000Z|more';
      const [cursor = '1970-01-01T00:00:00.000Z', more] = saved.split('|');
      const sql = more ? src.sql : src.sql.replace('>= ?1', '> ?1');
      const { results: rows } = await db.prepare(sql).bind(cursor, src.limit).all<Row>();
      if (!rows.length) break;
      const maxTs = rows.reduce((m, r) => (s(r.ts) > m ? s(r.ts) : m), cursor);
      const events = rows.flatMap((r) => (r.ts ? src.events(r) : []));
      const uids = [...new Set(events.map((e) => e.user_id).filter((x): x is string => Boolean(x)))];
      const split = splitByAudience(events, await loadPeople(db, uids), teamIds);
      const sentLive = split.live.length ? await post(env, liveKey, split.live) : { ok: true, status: 200, accepted: 0 };
      const sentTest = split.test.length && testKey ? await post(env, testKey, split.test) : { ok: true, status: 200, accepted: 0 };
      if (!sentLive.ok || !sentTest.ok) {
        const bad = !sentLive.ok ? sentLive : sentTest;
        report.stoppedAt = src.name;
        report.error = `${bad.status} ${bad.error ?? ''}`.trim();
        console.error('pmb_sync_failed', src.name, report.error);
        return report;
      }
      report.live += sentLive.accepted;
      report.test += sentTest.accepted;
      report.dropped += split.dropped;
      report.sources[src.name] = (report.sources[src.name] ?? 0) + events.length;
      const full = rows.length >= src.limit;
      const next = full ? `${maxTs}|more` : maxTs;
      if (next !== saved) {
        await db
          .prepare('INSERT INTO sync_cursors (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
          .bind(key, next, nowIso())
          .run();
        cursors.set(key, next);
      }
      // Stop when the page was not full, or a full page did not move the cursor
      // (more rows share one timestamp than a page holds; very unlikely).
      if (!full || maxTs === cursor) break;
    }
  }
  if (report.live || report.test) console.log('pmb_sync', JSON.stringify(report));
  return report;
}
