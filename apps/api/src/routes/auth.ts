import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { SessionUser } from '@sweam/shared';
import { USERNAME_RE } from '@sweam/shared';
import type { AppEnv } from '../env';
import { generateToken, hashPassword, sha256Hex, verifyPassword } from '../lib/auth';
import { EmailError, emailConfigured, sendEmail, verificationEmail } from '../lib/email';
import { fail, nowIso, parseBody } from '../lib/http';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '../lib/ratelimit';
import { SESSION_COOKIE, createSession, destroySession } from '../lib/session';
import {
  resendVerificationSchema,
  signInSchema,
  signUpSchema,
  verifyTokenSchema,
} from '../lib/validate';

export const authRoutes = new Hono<AppEnv>();

/** Verification links are good for 24 hours. */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Burned when a sign-in hits an unknown email, so the request still performs a
 * PBKDF2 derivation and response timing does not reveal which emails exist.
 */
const DUMMY_HASH_PROMISE: { current: Promise<string> | null } = { current: null };

/**
 * Native clients can't use the HttpOnly cookie, so they ask for the raw session
 * token (stored in the device keystore, sent as a Bearer). The web never sets
 * this header, so its responses never expose the token to page JS.
 */
function wantsToken(c: Context<AppEnv>): boolean {
  return c.req.header('x-sweam-client') === 'mobile';
}

function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: c.env.ENVIRONMENT === 'production',
    maxAge: 30 * 86_400,
  });
}

/** Emails the verification link (built from the current origin) for a token. */
async function sendVerification(
  c: Context<AppEnv>,
  email: string,
  displayName: string,
  token: string,
): Promise<void> {
  const link = `${new URL(c.req.url).origin}/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(c.env, { to: email, ...verificationEmail(link, displayName) });
}

authRoutes.post('/signup', async (c) => {
  await enforceRateLimit(c.env.DB, RATE_LIMITS.signupIp, clientIp(c.req.raw));
  const body = await parseBody(c, signUpSchema);

  // Every sign-up must be verifiable, so refuse to create accounts we cannot
  // email. Existing accounts are unaffected (they are grandfathered verified).
  if (!emailConfigured(c.env)) {
    fail(503, 'email_unavailable', 'Sign-ups are paused while email verification is being set up. Please try again soon.');
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email)
    .first<{ id: string }>();
  if (existing) {
    fail(409, 'email_taken', 'An account with that email already exists. If it is unverified, use "Resend" on the sign-in page.');
  }

  const usernameTaken = await c.env.DB.prepare('SELECT 1 AS x FROM users WHERE username = ? COLLATE NOCASE')
    .bind(body.username)
    .first();
  if (usernameTaken) {
    fail(409, 'username_taken', 'That username is taken. Please choose another.');
  }

  const id = crypto.randomUUID();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO users
       (id, email, display_name, username, age_confirmed, password_hash, email_verified, verify_token_hash, verify_expires_at, created_at)
     VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?, ?)`,
  )
    .bind(id, body.email, body.displayName, body.username, await hashPassword(body.password), await sha256Hex(token), expiresAt, nowIso())
    .run();

  try {
    await sendVerification(c, body.email, body.displayName, token);
  } catch (err) {
    // Don't leave an orphan account behind a failed send; let them retry cleanly.
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    if (err instanceof EmailError) {
      fail(502, 'email_send_failed', 'We could not send your verification email. Please try again in a minute.');
    }
    throw err;
  }

  return c.json({ pending: true, email: body.email }, 201);
});

/** Public: is this @username free and valid? Powers the sign-up picker. */
authRoutes.get('/username-available', async (c) => {
  const raw = (c.req.query('u') ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(raw)) {
    return c.json({ available: false, valid: false, username: raw });
  }
  const taken = await c.env.DB.prepare('SELECT 1 AS x FROM users WHERE username = ? COLLATE NOCASE')
    .bind(raw)
    .first();
  return c.json({ available: !taken, valid: true, username: raw });
});

/** Confirm a sign-up from the emailed link, then sign the new account in. */
authRoutes.post('/verify', async (c) => {
  const body = await parseBody(c, verifyTokenSchema);
  const tokenHash = await sha256Hex(body.token);
  const row = await c.env.DB.prepare(
    'SELECT id, email, display_name, username, verify_expires_at FROM users WHERE verify_token_hash = ? AND email_verified = 0',
  )
    .bind(tokenHash)
    .first<{ id: string; email: string; display_name: string; username: string | null; verify_expires_at: string | null }>();
  if (!row || !row.verify_expires_at || row.verify_expires_at < nowIso()) {
    fail(400, 'invalid_token', 'This verification link is invalid or has expired. Request a new one from the sign-in page.');
  }

  await c.env.DB.prepare(
    'UPDATE users SET email_verified = 1, verify_token_hash = NULL, verify_expires_at = NULL WHERE id = ?',
  )
    .bind(row.id)
    .run();

  const session = await createSession(c.env.DB, row.id);
  setSessionCookie(c, session.token);
  const user: SessionUser = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    handle: null,
    scout: null,
    isAdmin: false,
  };
  return c.json({ user, ...(wantsToken(c) ? { token: session.token } : {}) });
});

/** Send a fresh verification email. Always returns ok, to not leak account state. */
authRoutes.post('/resend-verification', async (c) => {
  await enforceRateLimit(c.env.DB, RATE_LIMITS.signupIp, clientIp(c.req.raw));
  const body = await parseBody(c, resendVerificationSchema);
  const row = await c.env.DB.prepare(
    'SELECT id, email, display_name FROM users WHERE email = ? AND email_verified = 0',
  )
    .bind(body.email)
    .first<{ id: string; email: string; display_name: string }>();
  if (row && emailConfigured(c.env)) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
    await c.env.DB.prepare('UPDATE users SET verify_token_hash = ?, verify_expires_at = ? WHERE id = ?')
      .bind(await sha256Hex(token), expiresAt, row.id)
      .run();
    await sendVerification(c, row.email, row.display_name, token).catch(() => undefined);
  }
  return c.json({ ok: true });
});

authRoutes.post('/signin', async (c) => {
  const body = await parseBody(c, signInSchema);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.signinIp, clientIp(c.req.raw));
  await enforceRateLimit(c.env.DB, RATE_LIMITS.signinEmail, body.email);

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.username, u.password_hash, u.email_verified, cp.handle,
       sp.status AS scout_status, sp.org_name AS scout_org,
       (a.user_id IS NOT NULL) AS is_admin
     FROM users u
     LEFT JOIN creator_profiles cp ON cp.user_id = u.id
     LEFT JOIN scout_profiles sp ON sp.user_id = u.id
     LEFT JOIN admins a ON a.user_id = u.id
     WHERE u.email = ?`,
  )
    .bind(body.email)
    .first<{
      id: string;
      email: string;
      display_name: string;
      username: string | null;
      password_hash: string;
      email_verified: number;
      handle: string | null;
      scout_status: 'pending' | 'approved' | 'rejected' | null;
      scout_org: string | null;
      is_admin: number | null;
    }>();

  if (!row) {
    DUMMY_HASH_PROMISE.current ??= hashPassword('sweam-timing-equalizer');
    await verifyPassword(body.password, await DUMMY_HASH_PROMISE.current);
    fail(401, 'invalid_credentials', 'Invalid email or password.');
  }
  if (!(await verifyPassword(body.password, row.password_hash))) {
    fail(401, 'invalid_credentials', 'Invalid email or password.');
  }
  // Only reveal verification state to someone who has the correct password.
  if (row.email_verified === 0) {
    fail(403, 'email_unverified', 'Please verify your email before signing in. Check your inbox for the verification link, or resend it below.');
  }

  const session = await createSession(c.env.DB, row.id);
  setSessionCookie(c, session.token);
  const user: SessionUser = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    handle: row.handle,
    scout:
      row.scout_status && row.scout_org ? { status: row.scout_status, orgName: row.scout_org } : null,
    isAdmin: row.is_admin === 1,
  };
  return c.json({ user, ...(wantsToken(c) ? { token: session.token } : {}) });
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
