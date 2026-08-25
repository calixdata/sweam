import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { SessionUser } from '@sweam/shared';
import type { AppEnv } from '../env';
import { generateToken, sha256Hex } from './auth';
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
  handle: string | null;
}

export async function resolveSession(db: D1Database, token: string): Promise<SessionUser | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.expires_at, s.token_hash, u.id, u.email, u.display_name, cp.handle
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN creator_profiles cp ON cp.user_id = u.id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return { id: row.id, email: row.email, displayName: row.display_name, handle: row.handle };
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

/** Resolves the session cookie (if any) into `c.get('user')` for every route. */
export const withUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  c.set('user', token ? await resolveSession(c.env.DB, token) : null);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) fail(401, 'auth_required', 'Sign in to continue.');
  await next();
});

export const requireCreator = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) fail(401, 'auth_required', 'Sign in to continue.');
  if (!user.handle) fail(403, 'creator_required', 'Create a creator profile to use the Studio.');
  await next();
});

/** Narrowing helper for routes behind requireUser / requireCreator. */
export function currentUser(c: Context<AppEnv>): SessionUser {
  const user = c.get('user');
  if (!user) fail(401, 'auth_required', 'Sign in to continue.');
  return user;
}
