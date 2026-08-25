import { describe, expect, it } from 'vitest';
import { LADDER, renditionsFor } from '../src/ladder';

describe('renditionsFor', () => {
  it('gives a 1080p source the full ladder', () => {
    expect(renditionsFor(1080).map((r) => r.name)).toEqual(['1080p', '720p', '480p', '360p']);
  });

  it('never upscales: a 720p source starts at 720p', () => {
    expect(renditionsFor(720).map((r) => r.name)).toEqual(['720p', '480p', '360p']);
    expect(renditionsFor(1079).map((r) => r.name)).toEqual(['720p', '480p', '360p']);
  });

  it('gives a tiny source a single smallest rung instead of nothing', () => {
    expect(renditionsFor(240).map((r) => r.name)).toEqual(['360p']);
  });

  it('keeps the ladder ordered highest to lowest with descending bitrates', () => {
    for (let i = 1; i < LADDER.length; i++) {
      expect(LADDER[i]!.height).toBeLessThan(LADDER[i - 1]!.height);
      expect(LADDER[i]!.videoBitrateK).toBeLessThan(LADDER[i - 1]!.videoBitrateK);
    }
  });
});
