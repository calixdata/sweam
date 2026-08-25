import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscodeJobClaim } from '@sweam/shared';
import { SweamApi, outputContentType } from './api';
import { MASTER_PLAYLIST, POSTER_FILE, buildHlsArgs, buildPosterArgs, posterTimestamp } from './ffmpeg';
import { renditionsFor } from './ladder';
import { probeFile } from './probe';
import { runCommand } from './run';

/**
 * The Sweam transcoder worker: the pipeline's data plane. Runs anywhere Node
 * 22 and ffmpeg exist; the Worker API is the only thing it talks to. Safe to
 * run several in parallel: claiming is atomic on the API side, and each job's
 * outputs live under their own prefix.
 *
 * Configuration (environment variables):
 *   SWEAM_API_URL      API origin        (default http://127.0.0.1:8787)
 *   TRANSCODER_TOKEN   shared secret     (default dev-transcoder-token)
 *   POLL_MS            idle poll delay   (default 5000)
 *
 * Pass --once to process at most one job and exit (useful for CI and smoke
 * tests).
 */

const API_URL = process.env.SWEAM_API_URL ?? 'http://127.0.0.1:8787';
const TOKEN = process.env.TRANSCODER_TOKEN ?? 'dev-transcoder-token';
const POLL_MS = Number(process.env.POLL_MS ?? '5000');
const WORKER_ID = `${hostname()}-${process.pid}`;
const ONCE = process.argv.includes('--once');

const api = new SweamApi(API_URL, TOKEN, WORKER_ID);

async function assertToolchain(): Promise<void> {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      await runCommand(tool, ['-version']);
    } catch {
      throw new Error(
        `${tool} was not found on PATH. Install ffmpeg (Windows: winget install Gyan.FFmpeg) and try again.`,
      );
    }
  }
}

async function processJob(job: TranscodeJobClaim): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'sweam-transcode-'));
  try {
    console.log(`[${job.id}] downloading source ${job.sourceUrl}`);
    const source = await api.fetchSource(job.sourceUrl);
    const inputPath = join(workDir, 'source.bin');
    await writeFile(inputPath, new Uint8Array(source));

    const probe = await probeFile(inputPath);
    const renditions = renditionsFor(probe.height);
    console.log(
      `[${job.id}] ${probe.height}p source, ${probe.durationS}s, audio: ${probe.hasAudio}; ` +
        `renditions: ${renditions.map((r) => r.name).join(', ')}`,
    );

    // ffmpeg runs inside outDir so every path in the playlists is relative.
    const outDir = join(workDir, 'out');
    await mkdir(outDir);
    await runCommand(
      'ffmpeg',
      ['-hide_banner', ...buildHlsArgs({ inputPath, renditions, hasAudio: probe.hasAudio })],
      { cwd: outDir },
    );
    await runCommand(
      'ffmpeg',
      ['-hide_banner', ...buildPosterArgs({ inputPath, atSeconds: posterTimestamp(probe.durationS) })],
      { cwd: outDir },
    );

    const files = await readdir(outDir);
    console.log(`[${job.id}] uploading ${files.length} output files`);
    for (const filename of files) {
      const contentType = outputContentType(filename);
      if (!contentType) {
        console.warn(`[${job.id}] skipping unexpected output ${filename}`);
        continue;
      }
      const data = await readFile(join(outDir, filename));
      await api.uploadOutput(job.id, filename, data, contentType);
    }

    await api.complete(job.id, {
      durationS: probe.durationS,
      master: MASTER_PLAYLIST,
      poster: files.includes(POSTER_FILE) ? POSTER_FILE : null,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await assertToolchain();
  console.log(`Sweam transcoder ${WORKER_ID} polling ${API_URL}${ONCE ? ' (once)' : ''}`);

  for (;;) {
    let job: TranscodeJobClaim | null = null;
    try {
      job = await api.claim();
    } catch (err) {
      console.error(`claim failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (job) {
      try {
        await processJob(job);
        console.log(`[${job.id}] done`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${job.id}] failed: ${message}`);
        await api.fail(job.id, message).catch((reportErr: unknown) => {
          console.error(`[${job.id}] could not report failure: ${String(reportErr)}`);
        });
      }
      if (ONCE) return;
      continue;
    }

    if (ONCE) {
      console.log('No queued jobs.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
