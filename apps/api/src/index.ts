import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiErrorBody } from '@sweam/shared';
import type { AppEnv, Env } from './env';
import { requireContentAccess, withUser } from './lib/session';
import { setPushEnv } from './lib/fcm';
import { runBluFund } from './lib/fund';
import { announceReleasedEpisodes } from './lib/release';
import { previousMonthPeriod, runScoutRoyalty } from './lib/royalty';
import { adminRoutes } from './routes/admin';
import { adRoutes } from './routes/ads';
import { authRoutes } from './routes/auth';
import { bluRoutes } from './routes/blu';
import { catalogRoutes } from './routes/catalog';
import { clipRoutes } from './routes/clips';
import { commentRoutes } from './routes/comments';
import { creatorRoutes } from './routes/creators';
import { discoverRoutes } from './routes/discover';
import { feedRoutes } from './routes/feed';
import { mediaRoutes } from './routes/media';
import { meRoutes } from './routes/me';
import { royaltyRoutes } from './routes/royalty';
import { scoutRoutes } from './routes/scout';
import { studioRoutes } from './routes/studio';
import { stripeRoutes } from './routes/stripe';
import { submissionRoutes } from './routes/submissions';
import { transcodeRoutes } from './routes/transcode';
import { titleRoutes } from './routes/titles';
import { verbatiimStudioRoutes, verbatiimWebhookRoutes } from './routes/verbatiim';
import { watchRoutes } from './routes/watch';

/** The frequent cron trigger (must match wrangler.toml) that announces scheduled releases. */
const RELEASE_CRON = '*/10 * * * *';

const app = new Hono<AppEnv>();

// Session resolution runs for API routes only; /media stays a cold path with
// no database work per segment request.
app.use('/api/*', withUser);
// Stash the env so notify() can reach the FCM secret to send device pushes.
app.use('/api/*', (c, next) => {
  setPushEnv(c.env);
  return next();
});

app.get('/api/health', (c) => c.json({ ok: true, service: 'sweam-api' }));

app.route('/api/auth', authRoutes);
app.route('/api/catalog', catalogRoutes);
app.route('/api/discover', discoverRoutes);
app.route('/api/feed', feedRoutes);
app.route('/api/titles', titleRoutes);
app.route('/api/comments', commentRoutes);
app.route('/api/creators', creatorRoutes);
app.route('/api/watch', watchRoutes);
app.route('/api/me', meRoutes);
app.route('/api/studio/verbatiim', verbatiimStudioRoutes);
app.route('/api/studio', studioRoutes);
app.route('/api/integrations/verbatiim', verbatiimWebhookRoutes);
app.route('/api/scout', scoutRoutes);
app.route('/api/transcode', transcodeRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/admin/blu', royaltyRoutes);
app.route('/api/ads', adRoutes);
app.route('/api/submissions', submissionRoutes);
app.route('/api/clips', clipRoutes);
app.route('/api/blu', bluRoutes);
app.route('/api/stripe', stripeRoutes);
// Media (posters, video, HLS) is content: gated to signed-in accounts, with the
// transcoder service allowed through by its Bearer token.
app.use('/media/*', requireContentAccess);
app.route('/media', mediaRoutes);

app.notFound((c) => {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'No such route.' } };
  return c.json(body, 404);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error('unhandled_error', err);
  const body: ApiErrorBody = {
    error: { code: 'internal', message: 'Something went wrong on our side.' },
  };
  return c.json(body, 500);
});

/**
 * Entry point. On the deployed Worker (which runs before static assets),
 * /api and /media are handled by the Hono app and everything else is served
 * from the built web app via the ASSETS binding, with unknown paths falling
 * back to index.html for the client router. In local dev there is no ASSETS
 * binding — Vite serves the app and proxies only /api and /media here.
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    // One canonical host. The session cookie is host-only, so a sign-in on
    // sweam.co is invisible on www.sweam.co (and vice versa); sending www to
    // the apex keeps every visitor on the host that holds their cookie.
    if (url.hostname === 'www.sweam.co') {
      url.hostname = 'sweam.co';
      return Response.redirect(url.toString(), 301);
    }
    if (pathname.startsWith('/api') || pathname.startsWith('/media')) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : app.fetch(request, env, ctx);
  },

  /**
   * Monthly cron (see wrangler.toml triggers): distribute the previous calendar
   * month's Blu Fund (ad-revenue creator payouts) and scout royalty pool. Both
   * are idempotent per period, so a retry is safe; when Stripe is not yet
   * configured they record pending allocations as a ledger.
   */
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    // The frequent trigger announces scheduled releases that have just unlocked;
    // the monthly one runs the payout distributions.
    if (event.cron === RELEASE_CRON) {
      setPushEnv(env);
      ctx.waitUntil(
        announceReleasedEpisodes(env.DB).catch((err) => console.error('release_announce_failed', err)),
      );
      return;
    }
    const { periodStart, periodEnd } = previousMonthPeriod(new Date(event.scheduledTime));
    ctx.waitUntil(
      Promise.allSettled([
        runBluFund(env.DB, env, periodStart, periodEnd),
        runScoutRoyalty(env.DB, env, periodStart, periodEnd),
      ]).then((results) => {
        for (const r of results) {
          if (r.status === 'rejected') console.error('monthly_payout_run_failed', r.reason);
        }
      }),
    );
  },
};


