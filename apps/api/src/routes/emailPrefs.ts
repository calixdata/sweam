import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { nowIso } from '../lib/http';

/**
 * One-click unsubscribe from release emails, no sign-in needed. The link in
 * each email carries the user id and a random per-user token. GET shows a
 * confirmation page (mail scanners prefetch links, so GET never changes
 * anything); POST turns release emails off. Mail apps that support RFC 8058
 * one-click unsubscribe POST straight to this URL.
 */
export const emailPrefsRoutes = new Hono<AppEnv>();

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Sweam</title>
<style>body{margin:0;background:#080e19;color:#f4f7ff;font-family:system-ui,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:48px 16px}
h1{font-size:24px}p{color:#a5b5cd;line-height:1.5}button{background:#4de0f3;color:#04121a;border:0;border-radius:999px;padding:12px 24px;font-size:16px;font-weight:700;cursor:pointer}
a{color:#4de0f3}</style></head><body><main><p style="letter-spacing:3px;font-weight:800;color:#f4f7ff">SWEAM</p>${body}</main></body></html>`;
}

async function check(db: D1Database, userId: string, token: string): Promise<boolean> {
  if (!userId || !/^[0-9a-f]{48}$/.test(token)) return false;
  const row = await db
    .prepare('SELECT email_unsub_token FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email_unsub_token: string | null }>();
  if (!row?.email_unsub_token || row.email_unsub_token.length !== token.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= row.email_unsub_token.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

emailPrefsRoutes.get('/unsubscribe', async (c) => {
  const userId = c.req.query('u') ?? '';
  const token = c.req.query('t') ?? '';
  if (!(await check(c.env.DB, userId, token))) {
    return c.html(page('Link not valid', '<h1>That link is not valid</h1><p>Turn release emails off in <a href="/settings#notifications">Settings</a> instead.</p>'), 400);
  }
  const action = `/api/email/unsubscribe?u=${encodeURIComponent(userId)}&amp;t=${token}`;
  return c.html(
    page(
      'Stop release emails',
      `<h1>Stop release emails?</h1><p>You will no longer get an email when something new releases on Sweam: films, shows and new episodes. In-app and phone notifications are not affected.</p>
<form method="post" action="${action}"><button type="submit">Stop release emails</button></form>`,
    ),
  );
});

emailPrefsRoutes.post('/unsubscribe', async (c) => {
  const userId = c.req.query('u') ?? '';
  const token = c.req.query('t') ?? '';
  if (!(await check(c.env.DB, userId, token))) {
    return c.html(page('Link not valid', '<h1>That link is not valid</h1><p>Turn release emails off in <a href="/settings#notifications">Settings</a> instead.</p>'), 400);
  }
  await c.env.DB.prepare('UPDATE users SET release_emails = 0 WHERE id = ?').bind(userId).run();
  console.log('release_emails_unsubscribed', userId, nowIso());
  return c.html(
    page(
      'Release emails stopped',
      '<h1>Release emails stopped</h1><p>You will not get emails about new releases on Sweam any more. You can turn them back on any time in <a href="/settings#notifications">Settings</a>.</p>',
    ),
  );
});
