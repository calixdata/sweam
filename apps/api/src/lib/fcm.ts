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

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
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
  const data = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!res.ok || !data?.access_token) throw new Error('fcm_oauth_failed');
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

/** Send one message; returns the HTTP status so callers can prune dead tokens. */
async function sendMessage(
  sa: ServiceAccount,
  token: string,
  bearer: string,
  title: string,
  body: string,
  link: string | null,
): Promise<number> {
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
  return res.status;
}

async function fanOut(
  db: D1Database,
  tokens: string[],
  title: string,
  body: string,
  link: string | null,
): Promise<void> {
  const sa = serviceAccount();
  if (!sa || tokens.length === 0) return;
  const bearer = await accessToken(sa);
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const status = await sendMessage(sa, token, bearer, title, body, link);
        // 404 = token no longer registered, 400 = invalid/unregistered; prune it.
        if (status === 404 || status === 400) {
          await db.prepare('DELETE FROM push_tokens WHERE token = ?').bind(token).run();
        }
      } catch {
        // best-effort per token
      }
    }),
  );
}

/** Push a notification to every device a single user has registered. */
export async function sendPushToUser(
  db: D1Database,
  userId: string,
  title: string,
  body: string,
  link: string | null,
): Promise<void> {
  if (!serviceAccount()) return;
  const { results } = await db
    .prepare('SELECT token FROM push_tokens WHERE user_id = ?')
    .bind(userId)
    .all<{ token: string }>();
  await fanOut(db, results.map((r) => r.token), title, body, link);
}

/** Push to everyone following a creator (used by the follower fan-out). */
export async function sendPushToFollowers(
  db: D1Database,
  creatorId: string,
  title: string,
  body: string,
  link: string | null,
): Promise<void> {
  if (!serviceAccount()) return;
  const { results } = await db
    .prepare(
      `SELECT pt.token
       FROM push_tokens pt
       JOIN follows f ON f.follower_id = pt.user_id
       WHERE f.creator_id = ?`,
    )
    .bind(creatorId)
    .all<{ token: string }>();
  await fanOut(db, results.map((r) => r.token), title, body, link);
}
