import type { Env } from '../env';

/**
 * Firebase Cloud Messaging (HTTP v1) push sender for the mobile app.
 *
 * The Worker mints a short-lived Google OAuth token from the service account
 * key (RS256 JWT signed with Web Crypto), then POSTs to the FCM v1 endpoint for
 * each device token. Everything here is best-effort: push is a nicety layered on
 * top of the durable in-app notification, so any failure is swallowed and never
 * breaks the request that triggered it. Push is skipped entirely when the
 * FCM_SERVICE_ACCOUNT secret is not set.
 *
 * The env is stashed per request by a tiny middleware (setPushEnv). The bindings
 * are identical for every request to a given deployment, so a module-level value
 * is safe under the Workers concurrency model (no per-request data leaks here).
 */

let pushEnv: Env | null = null;

/** Called by middleware on every /api request so notify() can reach the secret. */
export function setPushEnv(env: Env): void {
  pushEnv = env;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = pushEnv?.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
    return sa;
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlString(value: string): string {
  return base64url(new TextEncoder().encode(value));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Raised when Google refuses the service account; carries Google's own words. */
export class PushAuthError extends Error {}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64urlString(JSON.stringify(header))}.${base64urlString(JSON.stringify(claims))}`;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(sa.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new PushAuthError('The FCM service account private key could not be read.');
  }
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      encodeURIComponent(jwt),
  });
  const text = await res.text().catch(() => '');
  let data: { access_token?: string; expires_in?: number } | null = null;
  try {
    data = JSON.parse(text) as { access_token?: string; expires_in?: number };
  } catch {
    data = null;
  }
  if (!res.ok || !data?.access_token) {
    throw new PushAuthError(`Google OAuth refused the service account (${res.status}): ${text.slice(0, 300)}`);
  }
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

/** One device's outcome, as recorded in delivery_log and shown by the test button. */
export interface PushResult {
  platform: string;
  /** Last 8 characters of the device token, enough to tell devices apart. */
  device: string;
  ok: boolean;
  status: number;
  error: string | null;
}

interface DeviceRow {
  token: string;
  user_id: string;
  platform: string;
}

/** Send one message; returns FCM's status and, on failure, its error text. */
async function sendMessage(
  sa: ServiceAccount,
  token: string,
  bearer: string,
  title: string,
  body: string,
  link: string | null,
): Promise<{ status: number; error: string | null }> {
  const message: Record<string, unknown> = {
    token,
    notification: { title, body },
    android: {
      priority: 'HIGH',
      notification: { sound: 'default', channel_id: 'default' },
    },
  };
  if (link) message.data = { link };
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  );
  if (res.ok) return { status: res.status, error: null };
  const text = await res.text().catch(() => '');
  return { status: res.status, error: text.slice(0, 500) || `HTTP ${res.status}` };
}

/** True only when FCM says this specific device token is gone, never for a bad request. */
function tokenIsDead(status: number, error: string | null): boolean {
  if (status === 404) return true;
  return /UNREGISTERED|registration token is not a valid FCM registration token/i.test(error ?? '');
}

export async function logDelivery(
  db: D1Database,
  entry: { channel: 'push' | 'email'; source: string; userId: string | null; target: string | null; ok: boolean; status: number; error: string | null },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO delivery_log (channel, source, user_id, target, ok, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(entry.channel, entry.source, entry.userId, entry.target, entry.ok ? 1 : 0, entry.status, entry.error, new Date().toISOString())
      .run();
  } catch {
    /* the log is diagnostic; never let it break a delivery */
  }
}

type DeliveryEntry = Parameters<typeof logDelivery>[1];

/** Write many delivery log rows with batched statements. */
async function logDeliveries(db: D1Database, entries: DeliveryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  try {
    for (let i = 0; i < entries.length; i += 50) {
      await db.batch(
        entries.slice(i, i + 50).map((e) =>
          db
            .prepare(
              `INSERT INTO delivery_log (channel, source, user_id, target, ok, status, error, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(e.channel, e.source, e.userId, e.target, e.ok ? 1 : 0, e.status, e.error, now),
        ),
      );
    }
  } catch {
    /* the log is diagnostic; never let it break a delivery */
  }
}

async function fanOut(
  db: D1Database,
  devices: DeviceRow[],
  title: string,
  body: string,
  link: string | null,
  source: string,
): Promise<PushResult[]> {
  if (devices.length === 0) return [];
  const sa = serviceAccount();
  if (!sa) {
    const error = pushEnv?.FCM_SERVICE_ACCOUNT
      ? 'FCM_SERVICE_ACCOUNT is set but is not valid service account JSON.'
      : 'FCM_SERVICE_ACCOUNT is not set on this deployment.';
    const results = devices.map((d) => ({ platform: d.platform, device: d.token.slice(-8), ok: false, status: 0, error }));
    await logDeliveries(db, devices.map((d) => ({ channel: 'push' as const, source, userId: d.user_id, target: d.token.slice(-8), ok: false, status: 0, error })));
    console.error('push_not_configured', error);
    return results;
  }
  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Google OAuth failed.';
    console.error('push_oauth_failed', error);
    await logDeliveries(db, devices.map((d) => ({ channel: 'push' as const, source, userId: d.user_id, target: d.token.slice(-8), ok: false, status: 0, error })));
    return devices.map((d) => ({ platform: d.platform, device: d.token.slice(-8), ok: false, status: 0, error }));
  }
  const results = await Promise.all(
    devices.map(async (d) => {
      let status = 0;
      let error: string | null = null;
      try {
        ({ status, error } = await sendMessage(sa, d.token, bearer, title, body, link));
      } catch (err) {
        error = err instanceof Error ? err.message : 'Could not reach FCM.';
      }
      const ok = status >= 200 && status < 300;
      if (!ok) console.error('push_failed', status, error);
      return { platform: d.platform, device: d.token.slice(-8), ok, status, error, token: d.token, userId: d.user_id };
    }),
  );
  // One batched write for the log and one for dead tokens, not a query per device.
  await logDeliveries(db, results.map((r) => ({ channel: 'push' as const, source, userId: r.userId, target: r.device, ok: r.ok, status: r.status, error: r.error })));
  const dead = results.filter((r) => !r.ok && tokenIsDead(r.status, r.error)).map((r) => r.token);
  if (dead.length) {
    await db.prepare('DELETE FROM push_tokens WHERE token IN (SELECT value FROM json_each(?))').bind(JSON.stringify(dead)).run();
  }
  return results.map(({ platform, device, ok, status, error }) => ({ platform, device, ok, status, error }));
}

/** Push a notification to every device a single user has registered. */
export async function sendPushToUser(
  db: D1Database,
  userId: string,
  title: string,
  body: string,
  link: string | null,
  source = 'notify',
): Promise<PushResult[]> {
  const { results } = await db
    .prepare('SELECT token, user_id, platform FROM push_tokens WHERE user_id = ?')
    .bind(userId)
    .all<DeviceRow>();
  return fanOut(db, results, title, body, link, source);
}

/** Push to everyone following a creator (used by the follower fan-out). */
export async function sendPushToFollowers(
  db: D1Database,
  creatorId: string,
  title: string,
  body: string,
  link: string | null,
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT pt.token, pt.user_id, pt.platform
       FROM push_tokens pt
       JOIN follows f ON f.follower_id = pt.user_id
       WHERE f.creator_id = ?`,
    )
    .bind(creatorId)
    .all<DeviceRow>();
  await fanOut(db, results, title, body, link, 'follow');
}

/**
 * Check the whole push path without showing anything on a phone: sign in to
 * Google with the service account, then send a validate_only message to the
 * most recently registered device. FCM runs every check (credentials, project,
 * token) but delivers nothing. The answer lands in delivery_log as "selfcheck".
 */
export async function pushSelfCheck(db: D1Database): Promise<{ ok: boolean; status: number; error: string | null }> {
  const sa = serviceAccount();
  const record = async (ok: boolean, status: number, error: string | null, target: string | null) => {
    await logDelivery(db, { channel: 'push', source: 'selfcheck', userId: null, target, ok, status, error });
    console.log('push_selfcheck', ok, status, error);
    return { ok, status, error };
  };
  if (!sa) return record(false, 0, pushEnv?.FCM_SERVICE_ACCOUNT ? 'FCM_SERVICE_ACCOUNT is not valid JSON.' : 'FCM_SERVICE_ACCOUNT is not set.', null);
  const who = `project=${sa.project_id} account=${sa.client_email}`;
  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (err) {
    return record(false, 0, `${err instanceof Error ? err.message : 'OAuth failed'} [${who}]`, null);
  }
  const device = await db
    .prepare('SELECT token FROM push_tokens ORDER BY created_at DESC LIMIT 1')
    .first<{ token: string }>();
  if (!device) return record(true, 0, `Signed in to Google; no device registered to test. [${who}]`, null);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      validate_only: true,
      message: { token: device.token, notification: { title: 'Sweam', body: 'Self-check' } },
    }),
  });
  const text = res.ok ? null : (await res.text().catch(() => '')).slice(0, 500);
  return record(res.ok, res.status, res.ok ? `Validated. [${who}]` : `${text} [${who}]`, device.token.slice(-8));
}

/** Push one notification to every device registered by any of these users. */
export async function sendPushToUserIds(
  db: D1Database,
  userIds: string[],
  title: string,
  body: string,
  link: string | null,
  source: string,
): Promise<void> {
  for (let i = 0; i < userIds.length; i += 90) {
    const { results } = await db
      .prepare('SELECT token, user_id, platform FROM push_tokens WHERE user_id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(userIds.slice(i, i + 90)))
      .all<DeviceRow>();
    await fanOut(db, results, title, body, link, source);
  }
}
