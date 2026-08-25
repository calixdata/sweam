import { describe, expect, it } from 'vitest';
import { outputContentType } from '../src/api';
import { parseProbe } from '../src/probe';

const PROBE_WITH_AUDIO = {
  format: { duration: '596.474000' },
  streams: [
    { codec_type: 'video', height: 720, width: 1280 },
    { codec_type: 'audio', channels: 2 },
  ],
};

describe('parseProbe', () => {
  it('extracts duration, height, and audio presence', () => {
    expect(parseProbe(PROBE_WITH_AUDIO)).toEqual({ durationS: 596, height: 720, hasAudio: true });
  });

  it('detects silent sources', () => {
    const silent = { ...PROBE_WITH_AUDIO, streams: [{ codec_type: 'video', height: 480 }] };
    expect(parseProbe(silent).hasAudio).toBe(false);
  });

  it('rejects sources without a video stream', () => {
    expect(() =>
      parseProbe({ format: { duration: '10' }, streams: [{ codec_type: 'audio' }] }),
    ).toThrow('no usable video stream');
  });

  it('rejects sources without a usable duration', () => {
    expect(() =>
      parseProbe({ format: {}, streams: [{ codec_type: 'video', height: 720 }] }),
    ).toThrow('no usable duration');
  });
});

describe('outputContentType', () => {
  it('maps every pipeline output type and rejects the rest', () => {
    expect(outputContentType('master.m3u8')).toBe('application/vnd.apple.mpegurl');
    expect(outputContentType('s_0_00001.ts')).toBe('video/mp2t');
    expect(outputContentType('poster.jpg')).toBe('image/jpeg');
    expect(outputContentType('init.mp4')).toBe('video/mp4');
    expect(outputContentType('seg.m4s')).toBe('video/iso.segment');
    expect(outputContentType('notes.txt')).toBeNull();
  });
});
