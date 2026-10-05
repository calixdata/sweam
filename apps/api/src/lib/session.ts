import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { SessionUser } from '@sweam/shared';
import type { AppEnv } from '../env';
import { generateToken, sha256Hex } from './auth';
import { isActiveScout } from './blu';
import { fail, nowIso } from './http';

export const SESSION_COOKIE = 'sweam_session';
const SESSION_TTL_DAYS = 30;

export interface NewSession {
  token: string;
  expiresAt: string;
}

export async function createSession(db: D1Database, userId: string): Promise<NewSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, expiresAt, nowIso())
    .run();
  return { token, expiresAt };
}

interface SessionRow {
  expires_at: string;
  token_hash: string;
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  username: string | null;
  handle: string | null;
  scout_status: 'pending' | 'approved' | 'rejected' | null;
  scout_org: string | null;
  is_admin: number | null;
}

export async function resolveSession(db: D1Database, token: string): Promise<SessionUser | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.expires_at, s.token_hash, u.id, u.email, u.display_name, u.avatar_url, u.username, cp.handle,
        sp.status AS scout_status, sp.org_name AS scout_org,
        (a.user_id IS NOT NULL) AS is_admin
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN creator_profiles cp ON cp.user_id = u.id
       LEFT JOIN scout_profiles sp ON sp.user_id = u.id
       LEFT JOIN admins a ON a.user_id = u.id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    username: row.username,
    handle: row.handle,
    scout:
      row.scout_status && row.scout_org ? { status: row.scout_status, orgName: row.scout_org } : null,
    isAdmin: row.is_admin === 1,
  };
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

/** The bearer token from an Authorization header, for native clients. */
export function bearerToken(c: Context<AppEnv>): string | null {
  const header = c.req.header('authorization');
  return header && header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/**
 * Resolves the session into `c.get('user')` for every route. The web sends an
 * HttpOnly cookie; native clients (the mobile app) send `Authorization: Bearer`.
 */
export const withUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE) ?? bearerToken(c);
  c.set('user', token ? await resolveSession(c.env.DB, token) : null);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) fail(401, 'auth_required', 'Sign in to continue.');
  await next();
});

/**
 * The gate for /media. The catalog is browsable signed-out, so poster/cover/hero
 * IMAGES are public; only video (source files, HLS playlists and segments) and
 * captions require a signed-in account — watching is the gated action. The check
 * is a single indexed session lookup (no full user JOIN — video pulls many
 * segments). The transcoder service is allowed through with its Bearer token.
 */
const PUBLIC_MEDIA_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

export const requireContentAccess = createMiddleware<AppEnv>(async (c, next) => {
  // Images (posters, cover art, the hero) are public so browsing works signed-out.
  if (PUBLIC_MEDIA_RE.test(c.req.path)) {
    await next();
    return;
  }
  // The transcoder service pulls source files for encoding with its token.
  const auth = c.req.header('authorization');
  if (auth && c.env.TRANSCODER_TOKEN && auth === `Bearer ${c.env.TRANSCODER_TOKEN}`) {
    await next();
    return;
  }
  // Video and captions require a signed-in account (cookie or bearer token).
  const token = getCookie(c, SESSION_COOKIE) ?? bearerToken(c);
  if (!token) fail(401, 'auth_required', 'Create a free account to watch on Sweam.');
  const row = await c.env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first<{ expires_at: string }>();
  if (!row || row.expires_at <= nowIso()) {
    fail(401, 'auth_required', 'Create a free account to watch on Sweam.');
  }
  await next();
});

export const requireCreator = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) fail(401, 'auth_required', 'Sign in to continue.');
  if (!user.handle) fail(403, 'creator_required', 'Create a creator profile to use the Studio.');
  await next();
});

export const requireScout = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) fail(401, 'auth_required', 'Sign in to continue.');
  if (!user.scout) fail(403, 'scout_required', 'Apply for scout access to use the scout portal.');
  if (user.scout.status === 'rejected') {
    fail(403, 'scout_rejected', 'Your scout application was not approved.');
  }
  if (user.scout.status !== 'approved') {
    // 'pending' now means the application has no active card on file (never added, or lapsed).
    fail(403, 'scout_pending', 'Add a card to your scout application to activate access.');
  }
  if (!(await isActiveScout(c.env.DB, user.id))) {
    // Approved, but the membership lapsed: free period over without a card, a failed
    // payment, or a cancellation. The portal and Blu all-access pause together.
    fail(
      403,
      'scout_membership_required',
      'Your Scout membership is not active. Start or renew it to use the scout portal.',
    );
  }
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) fail(401, 'auth_required', 'Sign in to continue.');
  if (!user.isAdmin) fail(403, 'admin_required', 'This area is for Sweam administrators.');
  await next();
});

/** Narrowing helper for routes behind requireUser / requireCreator. */
export function currentUser(c: Context<AppEnv>): SessionUser {
  const user = c.get('user');
  if (!user) fail(401, 'auth_required', 'Sign in to continue.');
  return user;
}
