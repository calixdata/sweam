import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiErrorBody } from '@sweam/shared';
import type { AppEnv, Env } from './env';
import { withUser } from './lib/session';
import { adminRoutes } from './routes/admin';
import { adRoutes } from './routes/ads';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { commentRoutes } from './routes/comments';
import { creatorRoutes } from './routes/creators';
import { discoverRoutes } from './routes/discover';
import { mediaRoutes } from './routes/media';
import { meRoutes } from './routes/me';
import { scoutRoutes } from './routes/scout';
import { studioRoutes } from './routes/studio';
import { submissionRoutes } from './routes/submissions';
import { transcodeRoutes } from './routes/transcode';
import { titleRoutes } from './routes/titles';
import { watchRoutes } from './routes/watch';

const app = new Hono<AppEnv>();

// Session resolution runs for API routes only; /media stays a cold path with
// no database work per segment request.
app.use('/api/*', withUser);

app.get('/api/health', (c) => c.json({ ok: true, service: 'sweam-api' }));

app.route('/api/auth', authRoutes);
app.route('/api/catalog', catalogRoutes);
app.route('/api/discover', discoverRoutes);
app.route('/api/titles', titleRoutes);
app.route('/api/comments', commentRoutes);
app.route('/api/creators', creatorRoutes);
app.route('/api/watch', watchRoutes);
app.route('/api/me', meRoutes);
app.route('/api/studio', studioRoutes);
app.route('/api/scout', scoutRoutes);
app.route('/api/transcode', transcodeRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/ads', adRoutes);
app.route('/api/submissions', submissionRoutes);
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
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api') || pathname.startsWith('/media')) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : app.fetch(request, env, ctx);
  },
};

