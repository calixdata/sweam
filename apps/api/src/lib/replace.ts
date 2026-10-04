import type { Env } from '../env';
import { enqueueTranscode } from '../routes/transcode';

/**
 * Swap an episode's live video in place. The episode is pointed at a new uploaded
 * source (it plays raw immediately, then upgrades to adaptive HLS when the
 * transcoder next runs), optional captions are replaced, and the episode re-enters
 * the transcode pipeline. The episode id, its title, its /watch URL, and all watch
 * history stay the same — nobody has to make a fresh submission.
 */
export async function applyVideoReplacement(
  env: Env,
  episodeId: string,
  sourceUrl: string,
  captionsUrl?: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE episodes SET
       source_url = ?,
       video_url = ?,
       duration_s = 0,
       captions_url = COALESCE(?, captions_url)
     WHERE id = ?`,
  )
    .bind(sourceUrl, sourceUrl, captionsUrl ?? null, episodeId)
    .run();
  await enqueueTranscode(env.DB, episodeId, sourceUrl);
}
