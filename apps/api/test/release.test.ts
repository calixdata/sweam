import { describe, expect, it } from 'vitest';
import { easternMidnightUtc, formatReleaseDate, isReleased } from '@sweam/shared';

describe('easternMidnightUtc', () => {
  it('is 04:00Z during daylight saving time', () => {
    expect(easternMidnightUtc('2026-10-10')).toBe('2026-10-10T04:00:00.000Z');
  });

  it('is 05:00Z during standard time', () => {
    expect(easternMidnightUtc('2026-12-25')).toBe('2026-12-25T05:00:00.000Z');
  });

  it('handles the days around the DST change', () => {
    // 2026: DST ends November 1.
    expect(easternMidnightUtc('2026-10-31')).toBe('2026-10-31T04:00:00.000Z');
    expect(easternMidnightUtc('2026-11-02')).toBe('2026-11-02T05:00:00.000Z');
  });

  it('rejects malformed dates', () => {
    expect(() => easternMidnightUtc('10/10/2026')).toThrow();
    expect(() => easternMidnightUtc('2026-13-45')).toThrow();
  });
});

describe('isReleased', () => {
  const now = '2026-10-05T23:00:00.000Z';
  it('treats no schedule as released', () => {
    expect(isReleased(null, now)).toBe(true);
  });
  it('locks until the instant passes', () => {
    expect(isReleased('2026-10-10T04:00:00.000Z', now)).toBe(false);
    expect(isReleased('2026-10-05T04:00:00.000Z', now)).toBe(true);
    expect(isReleased(now, now)).toBe(true);
  });
});

describe('formatReleaseDate', () => {
  it('shows the Eastern calendar day, not the UTC one', () => {
    expect(formatReleaseDate('2026-10-10T04:00:00.000Z')).toBe('October 10, 2026');
    expect(formatReleaseDate('2026-12-25T05:00:00.000Z')).toBe('December 25, 2026');
  });
});
