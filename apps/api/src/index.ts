import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiErrorBody } from '@sweam/shared';
import type { AppEnv } from './env';
import { withUser } from './lib/session';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { discoverRoutes } from './routes/discover';
import { mediaRoutes } from './routes/media';
import { meRoutes } from './routes/me';
import { scoutRoutes } from './routes/scout';
import { studioRoutes } from './routes/studio';
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
app.route('/api/watch', watchRoutes);
app.route('/api/me', meRoutes);
app.route('/api/studio', studioRoutes);
app.route('/api/scout', scoutRoutes);
app.route('/api/transcode', transcodeRoutes);
app.route('/api/admin', adminRoutes);
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

export default app;
