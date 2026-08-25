import { describe, expect, it } from 'vitest';
import { RATE_LIMITS, windowStartS } from '../src/lib/ratelimit';

describe('windowStartS', () => {
  it('floors a timestamp to its fixed window', () => {
    // 1000-second windows: 12:16:40 UTC epoch 44200 -> window 44000.
    expect(windowStartS(44_200_000, 1000)).toBe(44_000);
  });

  it('is stable within a window and advances exactly at the boundary', () => {
    const windowS = 900;
    const start = windowStartS(1_000_000_000_000, windowS);
    // Anchor at the window start itself so the in-window and boundary
    // assertions are exact.
    expect(windowStartS(start * 1000, windowS)).toBe(start);
    expect(windowStartS(start * 1000 + (windowS - 1) * 1000, windowS)).toBe(start);
    expect(windowStartS((start + windowS) * 1000, windowS)).toBe(start + windowS);
  });

  it('produces aligned windows for every configured rule', () => {
    const nowMs = 1_756_000_000_000;
    for (const rule of Object.values(RATE_LIMITS)) {
      const window = windowStartS(nowMs, rule.windowS);
      expect(window % rule.windowS).toBe(0);
      expect(window * 1000).toBeLessThanOrEqual(nowMs);
      expect((window + rule.windowS) * 1000).toBeGreaterThan(nowMs);
    }
  });

  it('keeps every rule budget positive and windowed', () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowS).toBeGreaterThanOrEqual(60);
    }
  });
});
