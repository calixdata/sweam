import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { TvFeed, TvPairPollResult, TvPairStart } from '@sweam/shared';
import { TV_PAIR_CODE_TTL_MINUTES, TV_PAIR_POLL_SECONDS } from '@sweam/shared';
import type { AppEnv } from '../env';
import { sha256Hex } from '../lib/auth';
import { fail, nowIso, parseBody } from '../lib/http';
import type { TitleRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapTitle } from '../lib/mappers';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '../lib/ratelimit';
import {
  SESSION_COOKIE,
  bearerToken,
  createSession,
  currentUser,
  requireUser,
} from '../lib/session';
import type { TvCatalogEntry } from '../lib/tv';
import { buildTvRows, generatePairCode } from '../lib/tv';
import { tvPairPollSchema, tvPairStartSchema } from '../lib/validate';

/**
 * SweamTV: the lean-back channel for AI-generated binge series and films
 * (tv.sweam.co, Roku, Samsung, LG). The catalog is browsable without an
 * account, exactly like the website; WATCHING uses the paired account's
 * session, so resume and history are shared with the web and the app.
 *
 * Pairing: the TV asks for a code (/pair/start), shows it on screen, and
 * polls (/pair/poll). The viewer claims the code at sweam.co/activate while
 * signed in (routes/me.ts). The next poll mints a normal session, hands the
 * TV its token exactly once, and retires the code.
 */
export const tvRoutes = new Hono<AppEnv>();

const SQL_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

interface TvTitleRow extends TitleRow {
  featured: number;
  latest_release_at: string | null;
}

/** The SweamTV home catalog: published AI originals shaped into rails. Public. */
tvRoutes.get('/feed', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT ${TITLE_SELECT}, t.featured AS featured,
      (SELECT MAX(COALESCE(e.release_at, e.created_at)) FROM episodes e
        WHERE e.title_id = t.id
          AND (e.release_at IS NULL OR e.release_at <= ${SQL_NOW})) AS latest_release_at
     ${TITLE_FROM}
     WHERE t.published = 1 AND t.suppressed = 0 AND t.ai_original = 1
       AND t.promo_only = 0 AND t.is_blu = 0
     ORDER BY t.featured DESC, t.published_at DESC
     LIMIT 100`,
  ).all<TvTitleRow>();
  const entries: TvCatalogEntry[] = (result.results ?? []).map((row) => ({
    title: mapTitle(row),
    featured: row.featured === 1,
    latestReleaseAt: row.latest_release_at,
  }));
  const feed: TvFeed = { rows: buildTvRows(entries), generatedAt: nowIso() };
  return c.json(feed);
});

/** Start pairing: create the device row and hand the TV its code. */
tvRoutes.post('/pair/start', async (c) => {
  await enforceRateLimit(c.env.DB, RATE_LIMITS.tvPairStart, clientIp(c.req.raw));
  const body = await parseBody(c, tvPairStartSchema);
  const deviceId = `tvd_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + TV_PAIR_CODE_TTL_MINUTES * 60_000).toISOString();
  // The partial unique index on code rejects a duplicate while another TV's
  // code is on screen; with a 32^6 space a retry is nearly never needed.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePairCode();
    try {
      await c.env.DB.prepare(
        'INSERT INTO tv_devices (id, platform, name, code, code_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(deviceId, body.platform, body.name ?? null, code, expiresAt, nowIso())
        .run();
      const payload: TvPairStart = {
        deviceId,
        code,
        expiresAt,
        pollSeconds: TV_PAIR_POLL_SECONDS,
        activateUrl: 'https://sweam.co/activate',
      };
      return c.json(payload, 201);
    } catch {
      // Code collision (the device id is a fresh UUID, so only the unique
      // code index can reject the insert): draw another code.
    }
  }
  fail(500, 'pair_unavailable', 'Could not start pairing. Try again.');
});

/**
 * The TV's poll while its code is on screen. Unknown devices, wrong codes,
 * retired codes and expired codes all get one indistinguishable 'expired'
 * answer, so polling leaks nothing about which codes exist.
 */
tvRoutes.post('/pair/poll', async (c) => {
  await enforceRateLimit(c.env.DB, RATE_LIMITS.tvPairPoll, clientIp(c.req.raw));
  const body = await parseBody(c, tvPairPollSchema);
  const row = await c.env.DB.prepare(
    'SELECT id, code, code_expires_at, user_id FROM tv_devices WHERE id = ?',
  )
    .bind(body.deviceId)
    .first<{ id: string; code: string | null; code_expires_at: string | null; user_id: string | null }>();
  if (!row || !row.code || row.code !== body.code) {
    return c.json({ status: 'expired' } satisfies TvPairPollResult);
  }
  if (!row.code_expires_at || row.code_expires_at <= nowIso()) {
    return c.json({ status: 'expired' } satisfies TvPairPollResult);
  }
  if (!row.user_id) {
    return c.json({ status: 'pending' } satisfies TvPairPollResult);
  }

  // Claimed: mint the session and hand it over exactly once. The guarded
  // UPDATE retires the code; if a concurrent poll won the race, discard the
  // extra session rather than leaking two.
  const session = await createSession(c.env.DB, row.user_id);
  const tokenHash = await sha256Hex(session.token);
  const now = nowIso();
  const updated = await c.env.DB.prepare(
    `UPDATE tv_devices SET code = NULL, code_expires_at = NULL, session_token_hash = ?,
       paired_at = ?, last_seen_at = ?
     WHERE id = ? AND code = ?`,
  )
    .bind(tokenHash, now, now, row.id, body.code)
    .run();
  if ((updated.meta?.changes ?? 0) === 0) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return c.json({ status: 'expired' } satisfies TvPairPollResult);
  }
  const user = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ display_name: string; username: string | null }>();
  // The TV web app lives on this same Worker (tv.sweam.co), so a cookie signs
  // it in for /api and /media; Roku and other native shells use the returned
  // token as an Authorization: Bearer header instead.
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: c.env.ENVIRONMENT === 'production',
    maxAge: 30 * 86_400,
  });
  return c.json({
    status: 'paired',
    token: session.token,
    user: { username: user?.username ?? null, displayName: user?.display_name ?? '' },
  } satisfies TvPairPollResult);
});

/**
 * Boot check for a TV shell that kept its session: who is watching? Also
 * freshens the device's last-seen time when the shell names itself.
 */
tvRoutes.get('/session', requireUser, async (c) => {
  const user = currentUser(c);
  const deviceId = c.req.query('device');
  if (deviceId) {
    const token = getCookie(c, SESSION_COOKIE) ?? bearerToken(c);
    if (token) {
      await c.env.DB.prepare(
        'UPDATE tv_devices SET last_seen_at = ? WHERE id = ? AND session_token_hash = ?',
      )
        .bind(nowIso(), deviceId, await sha256Hex(token))
        .run();
    }
  }
  return c.json({ user: { username: user.username, displayName: user.displayName } });
});
