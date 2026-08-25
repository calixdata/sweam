import type { Rendition } from './ladder';

/**
 * ffmpeg argument builders. Pure functions so the exact invocation is
 * unit-tested; the only untested part is ffmpeg itself.
 *
 * All output filenames are relative: ffmpeg must run with its working
 * directory set to the job's output directory, so the playlists reference
 * variants and segments by bare name and stay portable once uploaded.
 */

export const MASTER_PLAYLIST = 'master.m3u8';
export const POSTER_FILE = 'poster.jpg';
const SEGMENT_SECONDS = 6;

/**
 * One ffmpeg run producing the whole adaptive ladder: the source video is
 * split and scaled once per rendition, muxed as VOD HLS with independent
 * segments, and ffmpeg writes the master playlist itself.
 */
export function buildHlsArgs(opts: {
  inputPath: string;
  renditions: Rendition[];
  hasAudio: boolean;
}): string[] {
  const { inputPath, renditions, hasAudio } = opts;
  if (renditions.length === 0) throw new Error('At least one rendition is required.');

  const splitLabels = renditions.map((_, i) => `[v${i}]`).join('');
  const filters = [
    `[0:v]split=${renditions.length}${splitLabels}`,
    ...renditions.map(
      // -2 keeps width even (required by H.264) while preserving aspect ratio.
      (rendition, i) => `[v${i}]scale=-2:${rendition.height}[v${i}o]`,
    ),
  ].join(';');

  const args = ['-y', '-i', inputPath, '-filter_complex', filters];

  for (let i = 0; i < renditions.length; i++) {
    args.push('-map', `[v${i}o]`);
    if (hasAudio) args.push('-map', '0:a:0');
  }

  renditions.forEach((rendition, i) => {
    args.push(
      `-c:v:${i}`,
      'libx264',
      '-preset',
      'veryfast',
      `-b:v:${i}`,
      `${rendition.videoBitrateK}k`,
      `-maxrate:v:${i}`,
      `${Math.round(rendition.videoBitrateK * 1.1)}k`,
      `-bufsize:v:${i}`,
      `${rendition.videoBitrateK * 2}k`,
    );
    if (hasAudio) {
      args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, `${rendition.audioBitrateK}k`);
    }
  });

  const streamMap = renditions
    .map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`))
    .join(' ');

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    's_%v_%05d.ts',
    '-master_pl_name',
    MASTER_PLAYLIST,
    '-var_stream_map',
    streamMap,
    'r_%v.m3u8',
  );
  return args;
}

/** A single representative frame, scaled to poster width. */
export function buildPosterArgs(opts: { inputPath: string; atSeconds: number }): string[] {
  return [
    '-y',
    '-ss',
    String(opts.atSeconds),
    '-i',
    opts.inputPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-2',
    POSTER_FILE,
  ];
}

/** Poster frame at 25% of the runtime, clamped to the 1-5 second window. */
export function posterTimestamp(durationS: number): number {
  return Math.min(5, Math.max(1, Math.floor(durationS * 0.25)));
}
