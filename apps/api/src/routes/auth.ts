import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { SessionUser } from '@sweam/shared';
import type { AppEnv } from '../env';
import { hashPassword, verifyPassword } from '../lib/auth';
import { fail, nowIso, parseBody } from '../lib/http';
import { SESSION_COOKIE, createSession, destroySession } from '../lib/session';
import { signInSchema, signUpSchema } from '../lib/validate';

export const authRoutes = new Hono<AppEnv>();

/**
 * Burned when a sign-in hits an unknown email, so the request still performs a
 * PBKDF2 derivation and response timing does not reveal which emails exist.
 */
const DUMMY_HASH_PROMISE: { current: Promise<string> | null } = { current: null };

function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: c.env.ENVIRONMENT === 'production',
    maxAge: 30 * 86_400,
  });
}

authRoutes.post('/signup', async (c) => {
  const body = await parseBody(c, signUpSchema);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email)
    .first<{ id: string }>();
  if (existing) fail(409, 'email_taken', 'An account with that email already exists.');

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, body.email, body.displayName, await hashPassword(body.password), nowIso())
    .run();

  const session = await createSession(c.env.DB, id);
  setSessionCookie(c, session.token);
  const user: SessionUser = {
    id,
    email: body.email,
    displayName: body.displayName,
    handle: null,
    scout: null,
  };
  return c.json({ user }, 201);
});

authRoutes.post('/signin', async (c) => {
  const body = await parseBody(c, signInSchema);

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.password_hash, cp.handle,
       sp.status AS scout_status, sp.org_name AS scout_org
     FROM users u
     LEFT JOIN creator_profiles cp ON cp.user_id = u.id
     LEFT JOIN scout_profiles sp ON sp.user_id = u.id
     WHERE u.email = ?`,
  )
    .bind(body.email)
    .first<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string;
      handle: string | null;
      scout_status: 'pending' | 'approved' | null;
      scout_org: string | null;
    }>();

  if (!row) {
    DUMMY_HASH_PROMISE.current ??= hashPassword('sweam-timing-equalizer');
    await verifyPassword(body.password, await DUMMY_HASH_PROMISE.current);
    fail(401, 'invalid_credentials', 'Invalid email or password.');
  }
  if (!(await verifyPassword(body.password, row.password_hash))) {
    fail(401, 'invalid_credentials', 'Invalid email or password.');
  }

  const session = await createSession(c.env.DB, row.id);
  setSessionCookie(c, session.token);
  const user: SessionUser = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    handle: row.handle,
    scout:
      row.scout_status && row.scout_org ? { status: row.scout_status, orgName: row.scout_org } : null,
  };
  return c.json({ user });
});

authRoutes.post('/signout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env.DB, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', (c) => {
  return c.json({ user: c.get('user') });
});
