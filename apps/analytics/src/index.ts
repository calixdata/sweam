/**
 * Sweam analytics worker (analytics.sweam.co).
 *
 * A first-party, cookieless page-view collector with a private dashboard. It is
 * deliberately dependency-free and privacy-first:
 *
 *  - POST /collect ingests a beacon from the app. It stores the page path, the
 *    referring host, and a coarse viewport bucket. It never stores an IP address
 *    or user agent; instead it derives a salted, one-way `visitor_hash` that only
 *    counts distinct visits within a single UTC day.
 *  - Do-Not-Track and Global-Privacy-Control signals are honored server-side too.
 *  - GET / renders a private dashboard; GET /api/stats returns the same numbers
 *    as JSON. Both require HTTP Basic auth, and on the production deploy the
 *    dashboard refuses to open until a DASH_PASS secret is configured.
 *  - A daily cron folds days older than the 90-day raw window into a permanent,
 *    identifier-free rollup and deletes the raw hits (and their hashes).
 */

export interface Env {
  DB: D1Database;
  ENVIRONMENT: 'development' | 'production';
  /** Basic-auth username for the dashboard (defaults to "sweam"). */
  DASH_USER?: string;
  /** Basic-auth password. Required in production; set it as a secret. */
  DASH_PASS?: string;
  /** Secret salt for the daily visitor hash. Set as a secret in production. */
  ANALYTICS_SALT?: string;
}

/** How long raw, per-hit rows (with hashes) are retained before rollup + prune. */
const RAW_RETENTION_DAYS = 90;
const WIDTH_BUCKETS = new Set(['sm', 'md', 'lg', 'xl']);
const ALLOWED_WINDOWS = [7, 30, 90];
const MAX_BODY_BYTES = 2048;

// --------------------------------------------------------------------- utils

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);
const dayNDaysAgo = (n: number): string => utcDay(new Date(Date.now() - n * 86_400_000));

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Constant-time string comparison to avoid leaking the password by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && /(^|\.)sweam\.co$/.test(new URL(origin).hostname)
    ? origin
    : 'https://www.sweam.co';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// ------------------------------------------------------------------ collect

async function collect(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request.headers.get('Origin'));

  // Honor browser-level opt-outs even if the client sent a beacon anyway.
  if (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: cors });

    const payload = JSON.parse(body) as { p?: unknown; r?: unknown; w?: unknown };
    const path = normalizePath(payload.p);
    if (!path) return new Response(null, { status: 204, headers: cors });

    const refHost = typeof payload.r === 'string' ? payload.r.slice(0, 120) : '';
    const width = typeof payload.w === 'string' && WIDTH_BUCKETS.has(payload.w) ? payload.w : '';

    const day = utcDay(new Date());
    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const ua = request.headers.get('user-agent') ?? '';
    const salt = env.ANALYTICS_SALT || 'sweam-unsalted';
    // Truncated to 32 hex chars: ample to separate visitors within one day,
    // and the full value is never stored anywhere.
    const visitorHash = (await sha256Hex(`${salt}|${day}|${ip}|${ua}`)).slice(0, 32);

    await env.DB.prepare(
      `INSERT INTO analytics_hits (day, ts, path, ref_host, width_bucket, visitor_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(day, new Date().toISOString(), path, refHost, width, visitorHash)
      .run();

    return new Response(null, { status: 204, headers: cors });
  } catch {
    // Never surface storage or parse errors to a fire-and-forget beacon.
    return new Response(null, { status: 204, headers: cors });
  }
}

/** Keep only a clean same-app path: leading slash, no query or fragment. */
function normalizePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = (raw.split(/[?#]/)[0] ?? '').trim();
  if (!path.startsWith('/')) return null;
  return path.slice(0, 512);
}

// -------------------------------------------------------------------- stats

interface Stats {
  days: number;
  startDay: string;
  views: number;
  visitors: number;
  allTimeViews: number;
  daily: { day: string; views: number; visitors: number }[];
  topPaths: { path: string; views: number }[];
  topRefs: { ref: string; views: number }[];
}

async function readStats(env: Env, days: number): Promise<Stats> {
  const startDay = dayNDaysAgo(days - 1);
  const db = env.DB;

  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
       FROM analytics_hits WHERE day >= ?`,
    )
    .bind(startDay)
    .first<{ views: number; visitors: number }>();

  const allTime = await db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(views), 0) FROM analytics_daily)
              + (SELECT COUNT(*) FROM analytics_hits) AS total`,
    )
    .first<{ total: number }>();

  const daily = await db
    .prepare(
      `SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
       FROM analytics_hits WHERE day >= ? GROUP BY day ORDER BY day DESC`,
    )
    .bind(startDay)
    .all<{ day: string; views: number; visitors: number }>();

  const paths = await db
    .prepare(
      `SELECT path, COUNT(*) AS views FROM analytics_hits WHERE day >= ?
       GROUP BY path ORDER BY views DESC LIMIT 20`,
    )
    .bind(startDay)
    .all<{ path: string; views: number }>();

  const refs = await db
    .prepare(
      `SELECT ref_host AS ref, COUNT(*) AS views FROM analytics_hits
       WHERE day >= ? AND ref_host <> '' GROUP BY ref_host ORDER BY views DESC LIMIT 20`,
    )
    .bind(startDay)
    .all<{ ref: string; views: number }>();

  return {
    days,
    startDay,
    views: totals?.views ?? 0,
    visitors: totals?.visitors ?? 0,
    allTimeViews: allTime?.total ?? 0,
    daily: daily.results ?? [],
    topPaths: paths.results ?? [],
    topRefs: refs.results ?? [],
  };
}

// ---------------------------------------------------------------------- auth

/** Returns a Response when access should be denied, or null when authorized. */
function requireAuth(request: Request, env: Env): Response | null {
  const pass = env.DASH_PASS;
  if (env.ENVIRONMENT === 'production' && !pass) {
    return new Response(
      'Analytics dashboard is not configured yet. Set the DASH_PASS secret (and ANALYTICS_SALT) to enable it.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
  const expectedUser = env.DASH_USER || 'sweam';
  const header = request.headers.get('Authorization') ?? '';
  const challenge = {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Sweam analytics", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  } as const;

  if (!header.startsWith('Basic ')) return new Response('Authentication required.', challenge);
  let decoded = '';
  try {
    decoded = atob(header.slice(6));
  } catch {
    return new Response('Authentication required.', challenge);
  }
  const sep = decoded.indexOf(':');
  const user = sep >= 0 ? decoded.slice(0, sep) : '';
  const supplied = sep >= 0 ? decoded.slice(sep + 1) : '';
  const ok = timingSafeEqual(user, expectedUser) && timingSafeEqual(supplied, pass ?? '');
  if (!ok) return new Response('Invalid credentials.', challenge);
  return null;
}

// ----------------------------------------------------------------- dashboard

function statRows(rows: { label: string; views: number }[], emptyLabel: string): string {
  if (rows.length === 0) return `<tr><td colspan="2">${emptyLabel}</td></tr>`;
  return rows
    .map((r) => `<tr><td>${escapeHtml(r.label)}</td><td class="num">${r.views.toLocaleString()}</td></tr>`)
    .join('');
}

function renderDashboard(stats: Stats): string {
  const windowLinks = ALLOWED_WINDOWS.map((d) => {
    const active = d === stats.days;
    return `<a href="?days=${d}"${active ? ' aria-current="page" class="active"' : ''}>${d} days</a>`;
  }).join('');

  const daily = stats.daily
    .map(
      (d) =>
        `<tr><td>${d.day}</td><td class="num">${d.views.toLocaleString()}</td><td class="num">${d.visitors.toLocaleString()}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sweam analytics</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #080e19; color: #f4f7ff; font: 16px/1.55 'Segoe UI', Arial, sans-serif; }
  main { max-width: 1000px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  p.sub { color: #a5b5cd; margin: 0 0 1.5rem; }
  nav { display: flex; gap: 0.5rem; margin: 0 0 1.5rem; flex-wrap: wrap; }
  nav a { color: #a5b5cd; text-decoration: none; border: 1px solid #293a52; border-radius: 8px; padding: 0.35rem 0.85rem; }
  nav a.active { color: #061827; background: #4de0f3; border-color: #4de0f3; font-weight: 600; }
  .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #111c2d; border: 1px solid #293a52; border-radius: 14px; padding: 1.1rem 1.25rem; }
  .card .value { font-size: 1.9rem; font-weight: 650; }
  .card .label { color: #a5b5cd; font-size: 0.85rem; }
  section { margin-top: 2rem; }
  h2 { font-size: 1.15rem; margin: 0 0 0.6rem; }
  table { width: 100%; border-collapse: collapse; background: #111c2d; border: 1px solid #293a52; border-radius: 14px; overflow: hidden; }
  caption { text-align: left; color: #a5b5cd; padding: 0.5rem 0.75rem; }
  th, td { text-align: left; padding: 0.55rem 0.85rem; border-bottom: 1px solid #22314799; }
  th { color: #a5b5cd; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <h1>Sweam analytics</h1>
  <p class="sub">First-party and cookieless. No IP addresses, user agents, or cross-site tracking are stored.</p>
  <nav aria-label="Date range">${windowLinks}</nav>

  <div class="cards">
    <div class="card"><div class="value">${stats.views.toLocaleString()}</div><div class="label">Page views (last ${stats.days} days)</div></div>
    <div class="card"><div class="value">${stats.visitors.toLocaleString()}</div><div class="label">Unique visitors (last ${stats.days} days)</div></div>
    <div class="card"><div class="value">${stats.allTimeViews.toLocaleString()}</div><div class="label">Page views (all time)</div></div>
  </div>

  <section>
    <h2>Top pages</h2>
    <table>
      <caption>Most-viewed paths in the last ${stats.days} days</caption>
      <thead><tr><th scope="col">Path</th><th scope="col" class="num">Views</th></tr></thead>
      <tbody>${statRows(stats.topPaths.map((p) => ({ label: p.path, views: p.views })), 'No page views yet.')}</tbody>
    </table>
  </section>

  <section>
    <h2>Top referrers</h2>
    <table>
      <caption>External sites sending traffic in the last ${stats.days} days (direct visits are not listed)</caption>
      <thead><tr><th scope="col">Referrer</th><th scope="col" class="num">Views</th></tr></thead>
      <tbody>${statRows(stats.topRefs.map((r) => ({ label: r.ref, views: r.views })), 'No referred traffic yet.')}</tbody>
    </table>
  </section>

  <section>
    <h2>By day</h2>
    <table>
      <caption>Views and unique visitors per day, last ${stats.days} days</caption>
      <thead><tr><th scope="col">Day (UTC)</th><th scope="col" class="num">Views</th><th scope="col" class="num">Visitors</th></tr></thead>
      <tbody>${daily || '<tr><td colspan="3">No data in this range yet.</td></tr>'}</tbody>
    </table>
  </section>
</main>
</body>
</html>`;
}

function dashboardHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  };
}

function parseWindow(url: URL): number {
  const raw = Number(url.searchParams.get('days'));
  return ALLOWED_WINDOWS.includes(raw) ? raw : 30;
}

// --------------------------------------------------------------------- cron

/** Fold days older than the raw window into the permanent rollup, then prune. */
async function rollupAndPrune(env: Env): Promise<void> {
  const cutoff = dayNDaysAgo(RAW_RETENTION_DAYS);
  const stale = await env.DB.prepare(
    `SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
     FROM analytics_hits WHERE day < ? GROUP BY day`,
  )
    .bind(cutoff)
    .all<{ day: string; views: number; visitors: number }>();

  const rows = stale.results ?? [];
  if (rows.length === 0) return;

  const statements = rows.map((r) =>
    env.DB.prepare(
      `INSERT INTO analytics_daily (day, views, visitors) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET views = excluded.views, visitors = excluded.visitors`,
    ).bind(r.day, r.views, r.visitors),
  );
  statements.push(env.DB.prepare(`DELETE FROM analytics_hits WHERE day < ?`).bind(cutoff));
  await env.DB.batch(statements);
}

// ------------------------------------------------------------------- router

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin')) });
    }
    if (pathname === '/collect' && request.method === 'POST') {
      return collect(request, env);
    }
    if (pathname === '/health') {
      return Response.json({ ok: true, service: 'sweam-analytics' });
    }
    if (pathname === '/api/stats' && request.method === 'GET') {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      const stats = await readStats(env, parseWindow(url));
      return Response.json(stats, { headers: { 'Cache-Control': 'no-store' } });
    }
    if ((pathname === '/' || pathname === '/dashboard') && request.method === 'GET') {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      const stats = await readStats(env, parseWindow(url));
      return new Response(renderDashboard(stats), { headers: dashboardHeaders() });
    }
    return new Response('Not found.', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await rollupAndPrune(env);
  },
};
