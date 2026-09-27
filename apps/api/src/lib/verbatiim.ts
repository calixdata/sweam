import type { VerbatiimClip, VerbatiimJob, VerbatiimJobMode, VerbatiimJobStatus, VerbatiimMode } from '@sweam/shared';
import { VERBATIIM_NAME } from '@sweam/shared';
import type { Env } from '../env';
import { nowIso } from './http';
import { notify, notifyFollowers } from './notify';
import { enqueueTranscode } from '../routes/transcode';

/**
 * Verbatiim client. Sweam never trusts URLs or file lists from a webhook body:
 * the webhook only says "look again", and Sweam re-reads the job from the
 * Verbatiim API with its own key and builds every file URL itself.
 */

export function verbatiimConfigured(env: Env): boolean {
  return Boolean(env.VERBATIIM_API_URL && env.VERBATIIM_API_KEY && env.VERBATIIM_WEBHOOK_SECRET);
}

function base(env: Env): string {
  return env.VERBATIIM_API_URL!.replace(/\/+$/, '');
}

function auth(env: Env): HeadersInit {
  return { authorization: `Bearer ${env.VERBATIIM_API_KEY}` };
}

/** The subset of Verbatiim's public job shape Sweam relies on. */
export interface RemoteJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  runtimeSec: number | null;
  stages: { name: string; label: string; status: string; detail: string | null; error: string | null }[];
  outputs: { name: string }[];
  clips: { id: string; score: number; durationSec: number; title: string; reasons: string[] }[];
}

export class VerbatiimError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base(env)}${path}`, { ...init, headers: { ...auth(env), ...(init?.headers ?? {}) } });
  } catch {
    throw new VerbatiimError(`${VERBATIIM_NAME} did not respond. Try again in a minute.`, 502);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new VerbatiimError(data?.error ?? `${VERBATIIM_NAME} returned ${res.status}.`, res.status >= 500 ? 502 : res.status);
  return data as T;
}

export function createRemoteJob(
  env: Env,
  input: { mode: VerbatiimMode; text: string; name: string; clipCount: number; webhookUrl: string },
): Promise<RemoteJob> {
  return call<RemoteJob>(env, '/v1/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: input.mode,
      text: input.text,
      title: input.name,
      recipe: 'storyboard',
      video: 'auto',
      clips: { count: input.clipCount },
      webhookUrl: input.webhookUrl,
    }),
  });
}

export function getRemoteJob(env: Env, remoteId: string): Promise<RemoteJob> {
  return call<RemoteJob>(env, `/v1/jobs/${encodeURIComponent(remoteId)}`);
}

/** Plain-language progress: the running stage, or the last one that finished. */
export function progressLine(job: RemoteJob): string | null {
  const running = job.stages.find((s) => s.status === 'running');
  if (running) return running.detail ? `${running.label}: ${running.detail}` : running.label;
  const failed = job.stages.find((s) => s.status === 'failed');
  if (failed) return `${failed.label} failed`;
  const done = [...job.stages].reverse().find((s) => s.status === 'done');
  return done ? `${done.label}: ${done.detail ?? 'done'}` : null;
}

// ---------------------------------------------------------------------------
// Webhook signatures: "Verbatiim-Signature: t=<unix>,v1=<hex HMAC-SHA256 of '<t>.<body>'>"
// ---------------------------------------------------------------------------

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | undefined,
  nowS = Date.now() / 1000,
  toleranceS = 300,
): Promise<boolean> {
  const t = Number(header?.match(/t=(\d+)/)?.[1]);
  const v1 = header?.match(/v1=([a-f0-9]{64})/)?.[1];
  if (!t || !v1 || Math.abs(nowS - t) > toleranceS) return false;
  return constantTimeEqual(await hmacHex(secret, `${t}.${body}`), v1);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface VerbatiimJobRow {
  id: string;
  remote_id: string;
  creator_id: string;
  title_id: string;
  episode_id: string | null;
  mode: VerbatiimJobMode;
  season: number;
  episode: number;
  name: string;
  synopsis: string;
  status: VerbatiimJobStatus;
  progress: string | null;
  error: string | null;
  clips_json: string;
  credits: string | null;
  created_at: string;
  updated_at: string;
}

export function mapJob(row: VerbatiimJobRow): VerbatiimJob {
  return {
    id: row.id,
    titleId: row.title_id,
    episodeId: row.episode_id,
    mode: row.mode,
    season: row.season,
    episode: row.episode,
    name: row.name,
    status: row.status,
    progress: row.progress,
    error: row.error,
    clips: JSON.parse(row.clips_json) as VerbatiimClip[],
    credits: row.credits,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Sync and import
// ---------------------------------------------------------------------------

/** R2 takes a single PUT up to 5 GB; stay under it. */
const MAX_IMPORT_BYTES = 4.5 * 1024 * 1024 * 1024;

/** Stream a Verbatiim deliverable straight into R2 without buffering it in the Worker. */
export async function copyToR2(env: Env, remoteId: string, name: string, key: string, contentType: string): Promise<void> {
  const res = await fetch(`${base(env)}/v1/jobs/${encodeURIComponent(remoteId)}/files/${encodeURIComponent(name)}`, {
    headers: auth(env),
  });
  if (!res.ok || !res.body) throw new Error(`Could not fetch ${name} from ${VERBATIIM_NAME} (${res.status}).`);
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_IMPORT_BYTES) throw new Error(`${name} is larger than 4.5 GB.`);
  let body: ReadableStream | ArrayBuffer;
  if (Number.isFinite(length) && length > 0) {
    const fixed = new FixedLengthStream(length);
    void res.body.pipeTo(fixed.writable);
    body = fixed.readable;
  } else {
    body = await res.arrayBuffer();
  }
  await env.MEDIA.put(key, body, { httpMetadata: { contentType } });
}

async function fetchText(env: Env, remoteId: string, name: string): Promise<string | null> {
  const res = await fetch(`${base(env)}/v1/jobs/${encodeURIComponent(remoteId)}/files/${encodeURIComponent(name)}`, { headers: auth(env) });
  return res.ok ? res.text() : null;
}

/** Update status and progress from Verbatiim; import when the film is finished. */
export async function syncJob(env: Env, row: VerbatiimJobRow, remote?: RemoteJob): Promise<void> {
  if (row.status === 'done' || row.status === 'failed') return;
  const job = remote ?? (await getRemoteJob(env, row.remote_id));
  if (job.status === 'failed') {
    const failed = job.stages.find((s) => s.status === 'failed');
    await env.DB.prepare(`UPDATE verbatiim_jobs SET status = 'failed', progress = ?, error = ?, updated_at = ? WHERE id = ?`)
      .bind(progressLine(job), failed?.error ?? `${VERBATIIM_NAME} could not finish this film.`, nowIso(), row.id)
      .run();
    await notify(env.DB, row.creator_id, 'verbatiim', `${VERBATIIM_NAME} could not finish "${row.name}".`, `/studio/t/${row.title_id}`);
    return;
  }
  if (job.status === 'done') {
    await importJob(env, row, job);
    return;
  }
  if (row.status !== 'importing') {
    await env.DB.prepare('UPDATE verbatiim_jobs SET status = ?, progress = ?, updated_at = ? WHERE id = ?')
      .bind(job.status, progressLine(job), nowIso(), row.id)
      .run();
  }
}

/**
 * Copy the finished film, captions, clips, and credits into Sweam, then create
 * the episode and queue it for transcoding. Exactly-once: the status flip to
 * "importing" is a conditional UPDATE, so a webhook and a "Check now" click
 * arriving together cannot import twice. An import stuck for ten minutes (a
 * Worker that died mid-copy) may be claimed again.
 */
export async function importJob(env: Env, row: VerbatiimJobRow, job: RemoteJob): Promise<void> {
  const now = nowIso();
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE verbatiim_jobs SET status = 'importing', progress = 'Copying the film into Sweam', updated_at = ?
     WHERE id = ? AND (status IN ('queued', 'running') OR (status = 'importing' AND updated_at < ?))`,
  )
    .bind(now, row.id, stale)
    .run();
  if (!claim.meta.changes) return;

  try {
    const folder = `u/${row.creator_id}/${crypto.randomUUID()}`;
    const names = new Set(job.outputs.map((o) => o.name));
    if (!names.has('episode.mp4')) throw new Error(`${VERBATIIM_NAME} finished without a film file.`);
    const videoKey = `${folder}/verbatiim-episode.mp4`;
    await copyToR2(env, job.id, 'episode.mp4', videoKey, 'video/mp4');
    let captionsUrl: string | null = null;
    if (names.has('captions.vtt')) {
      await copyToR2(env, job.id, 'captions.vtt', `${folder}/captions.vtt`, 'text/vtt');
      captionsUrl = `/media/${folder}/captions.vtt`;
    }
    const clips: VerbatiimClip[] = [];
    for (const clip of job.clips) {
      if (!names.has(`${clip.id}.mp4`)) continue;
      await copyToR2(env, job.id, `${clip.id}.mp4`, `${folder}/${clip.id}.mp4`, 'video/mp4');
      let clipCaptions: string | null = null;
      if (names.has(`${clip.id}.vtt`)) {
        await copyToR2(env, job.id, `${clip.id}.vtt`, `${folder}/${clip.id}.vtt`, 'text/vtt');
        clipCaptions = `/media/${folder}/${clip.id}.vtt`;
      }
      clips.push({
        id: clip.id,
        score: clip.score,
        durationS: Math.round(clip.durationSec),
        title: clip.title,
        reasons: clip.reasons,
        videoUrl: `/media/${folder}/${clip.id}.mp4`,
        captionsUrl: clipCaptions,
      });
    }
    const credits = names.has('credits.txt') ? await fetchText(env, job.id, 'credits.txt') : null;

    // The episode number was checked when the job started; if the creator has
    // since used it, take the next free number in that season rather than fail.
    const taken = await env.DB.prepare('SELECT episode FROM episodes WHERE title_id = ? AND season = ?')
      .bind(row.title_id, row.season)
      .all<{ episode: number }>();
    const used = new Set(taken.results.map((r) => r.episode));
    let episodeNumber = row.episode;
    while (used.has(episodeNumber)) episodeNumber++;

    const episodeId = crypto.randomUUID();
    const videoUrl = `/media/${videoKey}`;
    await env.DB.prepare(
      `INSERT INTO episodes (id, title_id, season, episode, name, synopsis, video_url, captions_url, duration_s, source_url, ai_credits, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(episodeId, row.title_id, row.season, episodeNumber, row.name, row.synopsis, videoUrl, captionsUrl, Math.round(job.runtimeSec ?? 0), videoUrl, credits, nowIso())
      .run();
    await enqueueTranscode(env.DB, episodeId, videoUrl);

    const moved = episodeNumber !== row.episode ? ` Saved as episode ${episodeNumber} because ${row.episode} was taken.` : '';
    await env.DB.prepare(
      `UPDATE verbatiim_jobs SET status = 'done', episode_id = ?, episode = ?, progress = ?, error = NULL, clips_json = ?, credits = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(episodeId, episodeNumber, `Preparing it for streaming now.${moved}`, JSON.stringify(clips), credits, nowIso(), row.id)
      .run();

    await notify(env.DB, row.creator_id, 'verbatiim', `"${row.name}" is ready: ${VERBATIIM_NAME} added it as S${row.season} E${episodeNumber}${clips.length ? ` with ${clips.length} clip${clips.length === 1 ? '' : 's'}` : ''}.`, `/studio/t/${row.title_id}`);
    const title = await env.DB.prepare('SELECT name, published FROM titles WHERE id = ?').bind(row.title_id).first<{ name: string; published: number }>();
    if (title?.published === 1) {
      await notifyFollowers(env.DB, row.creator_id, 'new_episode', `New episode of ${title.name}: S${row.season} E${episodeNumber}, ${row.name}.`, `/watch/${episodeId}`);
    }
  } catch (err) {
    await env.DB.prepare(`UPDATE verbatiim_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
      .bind(err instanceof Error ? err.message : 'Import failed.', nowIso(), row.id)
      .run();
  }
}
