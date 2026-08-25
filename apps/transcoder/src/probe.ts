import { runCommand } from './run';

export interface ProbeResult {
  durationS: number;
  height: number;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  height?: number;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

/** Pure parser for ffprobe's JSON output, testable without ffprobe installed. */
export function parseProbe(raw: unknown): ProbeResult {
  const data = raw as FfprobeOutput;
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video || typeof video.height !== 'number' || video.height <= 0) {
    throw new Error('Source has no usable video stream.');
  }
  const durationS = Math.round(Number(data.format?.duration ?? 0));
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error('Source has no usable duration.');
  }
  return {
    durationS,
    height: video.height,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

export async function probeFile(path: string): Promise<ProbeResult> {
  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path,
  ]);
  return parseProbe(JSON.parse(stdout));
}
