import { Hono } from 'hono';
import type { MusicTrack } from '@sweam/shared';
import type { AppEnv } from '../env';
import { requireUser } from '../lib/session';

/**
 * The licensed music library. Every track is a public-domain recording of a
 * public-domain composition, trimmed to 60 seconds, with its provenance on the
 * row so an admin can re-check it. Creators pick one of these for an in-app
 * recording; nothing else can be laid under a clip by Sweam.
 */
export const musicRoutes = new Hono<AppEnv>();

musicRoutes.use('*', requireUser);

interface TrackRow {
  id: string;
  title: string;
  composer: string;
  performer: string;
  url: string;
  duration_s: number;
  mood: string;
  license: 'public-domain';
  license_note: string;
  source_url: string;
}

export function mapTrack(row: TrackRow): MusicTrack {
  return {
    id: row.id,
    title: row.title,
    composer: row.composer,
    performer: row.performer,
    url: row.url,
    durationS: row.duration_s,
    mood: row.mood,
    license: row.license,
    licenseNote: row.license_note,
    sourceUrl: row.source_url,
  };
}

export const TRACK_SELECT =
  'id, title, composer, performer, url, duration_s, mood, license, license_note, source_url';

musicRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${TRACK_SELECT} FROM music_tracks WHERE active = 1 ORDER BY sort_order, title`,
  ).all<TrackRow>();
  return c.json({ tracks: results.map(mapTrack) });
});

/** Resolve an active library track by id, or null. */
export async function findActiveTrack(db: D1Database, id: string): Promise<MusicTrack | null> {
  const row = await db
    .prepare(`SELECT ${TRACK_SELECT} FROM music_tracks WHERE id = ? AND active = 1`)
    .bind(id)
    .first<TrackRow>();
  return row ? mapTrack(row) : null;
}
