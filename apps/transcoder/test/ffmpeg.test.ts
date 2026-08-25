import { describe, expect, it } from 'vitest';
import { MASTER_PLAYLIST, POSTER_FILE, buildHlsArgs, buildPosterArgs, posterTimestamp } from '../src/ffmpeg';
import { renditionsFor } from '../src/ladder';

describe('buildHlsArgs', () => {
  const renditions = renditionsFor(720);

  it('scales each rendition without upscaling and maps audio per variant', () => {
    const args = buildHlsArgs({ inputPath: 'source.bin', renditions, hasAudio: true });
    const filter = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(filter).toContain('[0:v]split=3');
    expect(filter).toContain('scale=-2:720');
    expect(filter).toContain('scale=-2:480');
    expect(filter).toContain('scale=-2:360');
    expect(args.filter((a) => a === '0:a:0')).toHaveLength(3);
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('v:0,a:0 v:1,a:1 v:2,a:2');
  });

  it('omits audio mapping entirely for silent sources', () => {
    const args = buildHlsArgs({ inputPath: 'source.bin', renditions, hasAudio: false });
    expect(args).not.toContain('0:a:0');
    expect(args.join(' ')).not.toContain('aac');
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('v:0 v:1 v:2');
  });

  it('emits VOD HLS with relative output names so playlists stay portable', () => {
    const args = buildHlsArgs({ inputPath: 'source.bin', renditions, hasAudio: true });
    expect(args[args.indexOf('-master_pl_name') + 1]).toBe(MASTER_PLAYLIST);
    expect(args[args.indexOf('-hls_segment_filename') + 1]).toBe('s_%v_%05d.ts');
    expect(args[args.length - 1]).toBe('r_%v.m3u8');
    expect(args[args.indexOf('-hls_playlist_type') + 1]).toBe('vod');
    // No absolute paths anywhere in the outputs.
    expect(args.some((a) => a.includes('/') && a.endsWith('.m3u8'))).toBe(false);
  });

  it('sets per-variant bitrate controls', () => {
    const args = buildHlsArgs({ inputPath: 'source.bin', renditions, hasAudio: true });
    expect(args[args.indexOf('-b:v:0') + 1]).toBe('2800k');
    expect(args[args.indexOf('-b:v:2') + 1]).toBe('800k');
    expect(args).toContain('-maxrate:v:0');
    expect(args).toContain('-bufsize:v:0');
  });

  it('refuses an empty rendition list', () => {
    expect(() => buildHlsArgs({ inputPath: 'x', renditions: [], hasAudio: true })).toThrow();
  });
});

describe('buildPosterArgs / posterTimestamp', () => {
  it('captures one scaled frame at the poster timestamp', () => {
    const args = buildPosterArgs({ inputPath: 'source.bin', atSeconds: 4 });
    expect(args[args.indexOf('-ss') + 1]).toBe('4');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(args[args.length - 1]).toBe(POSTER_FILE);
  });

  it('clamps the poster timestamp to the 1-5 second window', () => {
    expect(posterTimestamp(600)).toBe(5); // 25% would be 150s
    expect(posterTimestamp(12)).toBe(3);
    expect(posterTimestamp(2)).toBe(1);
  });
});
