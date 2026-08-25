import { describe, expect, it } from 'vitest';
import { breakoutScore, buildRetentionCurve, growthRatio, RETENTION_POINTS } from '../src/lib/momentum';

describe('growthRatio', () => {
  it('is above 1 for growth and below 1 for decline', () => {
    expect(growthRatio(60, 30)).toBeGreaterThan(1);
    expect(growthRatio(196, 224)).toBeLessThan(1);
  });

  it('smooths a cold start into a finite, meaningful ratio', () => {
    expect(growthRatio(12, 0)).toBe(7);
    expect(Number.isFinite(growthRatio(1000, 0))).toBe(true);
  });

  it('does not let tiny samples look like breakouts', () => {
    // 1 play then 2 plays is not a doubling story.
    expect(growthRatio(2, 1)).toBeLessThan(1.5);
  });

  it('clamps negative inputs instead of producing nonsense', () => {
    expect(growthRatio(-5, -5)).toBe(1);
  });
});

describe('breakoutScore', () => {
  it('ranks a strong launch above steady volume and steady volume above a tiny spike', () => {
    const launch = breakoutScore(12, 0); // new title, first week
    const accelerating = breakoutScore(60, 30); // established, doubling
    const flat = breakoutScore(196, 224); // big but declining
    const tinySpike = breakoutScore(2, 0);

    expect(launch).toBeGreaterThan(accelerating);
    expect(accelerating).toBeGreaterThan(flat);
    expect(flat).toBeGreaterThan(tinySpike);
  });

  it('grows with volume when growth is equal', () => {
    expect(breakoutScore(100, 50)).toBeGreaterThan(breakoutScore(10, 5));
  });
});

describe('buildRetentionCurve', () => {
  it('returns an empty curve with no usable viewers', () => {
    expect(buildRetentionCurve([])).toEqual([]);
    expect(buildRetentionCurve([{ maxPositionS: 10, durationS: 0 }])).toEqual([]);
  });

  it('is all ones when every viewer finished', () => {
    const curve = buildRetentionCurve([
      { maxPositionS: 600, durationS: 600 },
      { maxPositionS: 650, durationS: 600 },
    ]);
    expect(curve).toHaveLength(RETENTION_POINTS);
    expect(curve.every((point) => point === 1)).toBe(true);
  });

  it('starts at 1, never increases, and reflects drop-off', () => {
    const curve = buildRetentionCurve([
      { maxPositionS: 600, durationS: 600 }, // finished
      { maxPositionS: 300, durationS: 600 }, // halfway
      { maxPositionS: 60, durationS: 600 }, // bailed early
      { maxPositionS: 0, durationS: 600 }, // never really started
    ]);
    expect(curve[0]).toBe(1);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeLessThanOrEqual(curve[i - 1] ?? 1);
    }
    expect(curve[5]).toBe(0.5); // two of four reached 50%
    expect(curve[10]).toBe(0.25); // one of four finished
  });

  it('ignores zero-duration rows but keeps the rest', () => {
    const curve = buildRetentionCurve([
      { maxPositionS: 600, durationS: 600 },
      { maxPositionS: 100, durationS: 0 },
    ]);
    expect(curve.every((point) => point === 1)).toBe(true);
  });
});
