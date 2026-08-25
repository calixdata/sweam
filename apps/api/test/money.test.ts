import { describe, expect, it } from 'vitest';
import {
  CREATOR_REVENUE_SHARE,
  MIN_PAYOUT_MILLICENTS,
  creatorShareMillicents,
  formatMillicents,
  impressionRevenueMillicents,
} from '@sweam/shared';

describe('impressionRevenueMillicents', () => {
  it('is exactly the CPM in millicents: cents-per-thousand equals millicents-per-one', () => {
    expect(impressionRevenueMillicents(1200)).toBe(1200);
    expect(impressionRevenueMillicents(1500)).toBe(1500);
  });

  it('never goes negative', () => {
    expect(impressionRevenueMillicents(-500)).toBe(0);
  });

  it('adds up without float drift: 1000 impressions at a $12 CPM is exactly $12', () => {
    const total = Array.from({ length: 1000 }, () => impressionRevenueMillicents(1200)).reduce(
      (sum, v) => sum + v,
      0,
    );
    expect(total).toBe(1_200_000);
    expect(formatMillicents(total)).toBe('$12.00');
  });
});

describe('creatorShareMillicents', () => {
  it('applies the published 55% split', () => {
    expect(CREATOR_REVENUE_SHARE).toBe(0.55);
    expect(creatorShareMillicents(1200)).toBe(660);
    expect(creatorShareMillicents(1500)).toBe(825);
  });

  it('rounds to whole millicents on odd CPMs', () => {
    expect(creatorShareMillicents(1)).toBe(1); // 0.55 rounds up
    expect(creatorShareMillicents(999)).toBe(549); // 549.45 rounds down
  });

  it('never exceeds gross revenue', () => {
    for (const cpm of [1, 7, 999, 1200, 100_000]) {
      expect(creatorShareMillicents(cpm)).toBeLessThanOrEqual(impressionRevenueMillicents(cpm));
    }
  });
});

describe('formatMillicents', () => {
  it('formats dollars and cents', () => {
    expect(formatMillicents(1_650_000)).toBe('$16.50');
    expect(formatMillicents(0)).toBe('$0.00');
    expect(formatMillicents(MIN_PAYOUT_MILLICENTS)).toBe('$10.00');
  });

  it('clamps negatives to zero for display', () => {
    expect(formatMillicents(-5)).toBe('$0.00');
  });
});
