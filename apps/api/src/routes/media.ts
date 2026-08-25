import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { contentRange, parseRange } from '../lib/range';

/**
 * Byte-range media serving from R2. This is the part that makes <video> seek,
 * resume, and stream instead of downloading: browsers ask for windows of the
 * file with Range headers and expect 206 responses with exact Content-Range
 * bookkeeping.
 */
export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.get('/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''));
  if (!key) return c.notFound();

  const head = await c.env.MEDIA.head(key);
  if (!head) return c.notFound();

  const baseHeaders: Record<string, string> = {
    'Content-Type': head.httpMetadata?.contentType ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    ETag: head.httpEtag,
  };

  const range = parseRange(c.req.header('range') ?? null, head.size);

  if (range === 'invalid') {
    return c.body(null, 416, {
      'Content-Range': `bytes */${head.size}`,
      'Accept-Ranges': 'bytes',
    });
  }

  if (range === null) {
    const object = await c.env.MEDIA.get(key);
    if (!object) return c.notFound();
    return c.body(object.body, 200, {
      ...baseHeaders,
      'Content-Length': String(head.size),
    });
  }

  const object = await c.env.MEDIA.get(key, {
    range: { offset: range.offset, length: range.length },
  });
  if (!object) return c.notFound();
  return c.body(object.body, 206, {
    ...baseHeaders,
    'Content-Length': String(range.length),
    'Content-Range': contentRange(range, head.size),
  });
});
