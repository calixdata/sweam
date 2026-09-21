# @sweam/analytics

First-party, cookieless analytics for Sweam, served at **analytics.sweam.co**.

It is a standalone Cloudflare Worker that collects page views and serves a
private dashboard. It is intentionally dependency-free.

## Why it exists

Sweam does not embed Google Analytics or any third-party tracker. This service
measures traffic on our own infrastructure, with privacy designed in rather than
bolted on.

## What it stores

One row per page view in `analytics_hits`:

- the app **path** (never query strings),
- the **referring host** (or empty for direct visits),
- a coarse **viewport bucket** (`sm`/`md`/`lg`/`xl`),
- a salted, one-way **visitor hash**.

It never stores an IP address or user agent. The visitor hash is
`SHA-256(secret salt + UTC day + IP + user agent)`, truncated, and is used only
to count distinct visits **within a single day**. Because the day is part of the
input and raw rows are pruned after 90 days, the hash cannot link a visitor
across days or be reversed. Do-Not-Track and Global-Privacy-Control signals are
honored server-side, and the browser client only sends a beacon after the
visitor has consented (see `apps/web/src/analytics.ts` and the Cookie Policy).

A daily cron folds days older than the 90-day raw window into `analytics_daily`,
a permanent rollup that holds only counts (no hashes), then deletes the raw
rows.

## Database

This Worker binds the same D1 database as the API (`sweam-db`). It does **not**
own the schema: the `analytics_*` tables are created by the API's migrations
(`apps/api/migrations/0008_analytics.sql`). Apply them with:

```
npm run db:migrate:remote -w @sweam/api
```

## Routes

| Route         | Auth        | Purpose                                    |
| ------------- | ----------- | ------------------------------------------ |
| `POST /collect` | none      | Ingest a page-view beacon.                 |
| `GET /health`   | none      | Liveness check.                            |
| `GET /`         | Basic auth | The dashboard (HTML).                      |
| `GET /api/stats?days=7\|30\|90` | Basic auth | The same numbers as JSON.  |

## Deploy

```
npx wrangler deploy --env preview
```

Then set the two secrets (the committed config leaves them unset so no real
password lives in git; until `DASH_PASS` is set, the dashboard returns 503):

```
npx wrangler secret put DASH_PASS --env preview
npx wrangler secret put ANALYTICS_SALT --env preview
```

The dashboard is then at `https://analytics.sweam.co/` (Basic auth user
`sweam`, or override with a `DASH_USER` secret).
