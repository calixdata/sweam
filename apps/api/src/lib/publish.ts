import type { ContentKind, Rating } from '@sweam/shared';
import { RATING_TO_ADVISORY } from '@sweam/shared';
import type { Env } from '../env';
import { nowIso } from './http';
import { makeSlug } from './slug';
import { enqueueTranscode } from '../routes/transcode';

/**
 * Publishing an accepted submission straight onto the catalog. The title is
 * admin-locked: the creator cannot unpublish or delete it, only request
 * removal. Series parts add episodes to the one title for their series.
 */

export class PublishError extends Error {}

export interface PublishableSubmission {
  id: string;
  user_id: string;
  title_name: string;
  kind: ContentKind;
  genre: string;
  rating: Rating | null;
  synopsis: string;
  source_url: string | null;
  captions_url: string | null;
  series_id: string | null;
  poster_url: string | null;
}

/** Derive a valid creator handle from a display name, falling back to random. */
function handleFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : `creator_${Math.random().toString(36).slice(2, 8)}`;
}

/** Give the submitter a creator profile if they lack one, so they can own the title. */
async function ensureCreator(db: D1Database, userId: string, displayName: string): Promise<void> {
  const existing = await db
    .prepare('SELECT handle FROM creator_profiles WHERE user_id = ?')
    .bind(userId)
    .first<{ handle: string }>();
  if (existing) return;

  let handle = handleFromName(displayName);
  for (let attempt = 2; attempt <= 20; attempt++) {
    const taken = await db.prepare('SELECT 1 AS x FROM creator_profiles WHERE handle = ?').bind(handle).first();
    if (!taken) break;
    handle = `${handleFromName(displayName).slice(0, 20)}_${attempt}`;
  }
  await db
    .prepare('INSERT INTO creator_profiles (user_id, handle, bio, verified, created_at) VALUES (?, ?, ?, 0, ?)')
    .bind(userId, handle, '', nowIso())
    .run();
}

async function uniqueSlug(db: D1Database, name: string): Promise<string> {
  const base = makeSlug(name) || 'title';
  let slug = base;
  for (let attempt = 0; attempt < 10; attempt++) {
    const taken = await db.prepare('SELECT 1 AS x FROM titles WHERE slug = ?').bind(slug).first();
    if (!taken) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Publish an accepted submission: find or create its title (grouping series
 * parts), add the film as the next episode, and queue it for transcoding.
 * Returns the title slug and the episode number that was added.
 */
export async function publishSubmission(
  env: Env,
  submission: PublishableSubmission,
  displayName: string,
): Promise<{ titleId: string; slug: string; episode: number }> {
  if (!submission.source_url) {
    throw new PublishError(
      'This submission has no Sweam-hosted video to publish. It was linked externally; ask the creator to upload the film.',
    );
  }
  await ensureCreator(env.DB, submission.user_id, displayName);
  const advisory = submission.rating ? RATING_TO_ADVISORY[submission.rating] : 'TV-MA';
  const now = nowIso();

  let titleId: string;
  let slug: string;

  if (submission.series_id) {
    const existing = await env.DB.prepare(
      'SELECT id, slug FROM titles WHERE creator_id = ? AND series_id = ?',
    )
      .bind(submission.user_id, submission.series_id)
      .first<{ id: string; slug: string }>();
    if (existing) {
      titleId = existing.id;
      slug = existing.slug;
    } else {
      const series = await env.DB.prepare('SELECT name FROM series WHERE id = ?')
        .bind(submission.series_id)
        .first<{ name: string }>();
      const seriesName = series?.name ?? submission.title_name;
      titleId = crypto.randomUUID();
      slug = await uniqueSlug(env.DB, seriesName);
      await env.DB.batch([
        env.DB
          .prepare(
            `INSERT INTO titles
               (id, creator_id, kind, name, slug, synopsis, genre, advisory, poster_url,
                published, published_at, admin_locked, series_id, created_at)
             VALUES (?, ?, 'series', ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`,
          )
          .bind(titleId, submission.user_id, seriesName, slug, submission.synopsis, submission.genre, advisory, submission.poster_url, now, submission.series_id, now),
        env.DB.prepare('INSERT INTO title_stats (title_id) VALUES (?)').bind(titleId),
      ]);
    }
  } else {
    titleId = crypto.randomUUID();
    slug = await uniqueSlug(env.DB, submission.title_name);
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO titles
             (id, creator_id, kind, name, slug, synopsis, genre, advisory, poster_url,
              published, published_at, admin_locked, series_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, NULL, ?)`,
        )
        .bind(titleId, submission.user_id, submission.kind, submission.title_name, slug, submission.synopsis, submission.genre, advisory, submission.poster_url, now, now),
      env.DB.prepare('INSERT INTO title_stats (title_id) VALUES (?)').bind(titleId),
    ]);
  }

  const maxRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(episode), 0) AS m FROM episodes WHERE title_id = ? AND season = 1',
  )
    .bind(titleId)
    .first<{ m: number }>();
  const episode = (maxRow?.m ?? 0) + 1;
  const episodeId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO episodes
       (id, title_id, season, episode, name, synopsis, video_url, captions_url, duration_s, source_url, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(episodeId, titleId, episode, submission.title_name, submission.synopsis, submission.source_url, submission.captions_url, submission.source_url, now)
    .run();
  await enqueueTranscode(env.DB, episodeId, submission.source_url);

  return { titleId, slug, episode };
}
