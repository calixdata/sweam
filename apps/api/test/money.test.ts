import { describe, expect, it } from 'vitest';
import {
  CREATOR_REVENUE_SHARE,
  MIN_PAYOUT_MILLICENTS,
  MONETIZATION_THRESHOLDS,
  creatorShareMillicents,
  evaluateMonetizationEligibility,
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

describe('evaluateMonetizationEligibility', () => {
  const qualifying = {
    followers: MONETIZATION_THRESHOLDS.minFollowers,
    watchSeconds: MONETIZATION_THRESHOLDS.minWatchSeconds,
    publishedTitles: MONETIZATION_THRESHOLDS.minPublishedTitles,
    suspended: false,
  };

  it('grants eligibility exactly at the published thresholds', () => {
    const result = evaluateMonetizationEligibility(qualifying);
    expect(result.eligible).toBe(true);
    expect(result.followers.met && result.watchSeconds.met && result.publishedTitles.met).toBe(true);
  });

  it('fails when any single dimension is short', () => {
    expect(evaluateMonetizationEligibility({ ...qualifying, followers: qualifying.followers - 1 }).eligible).toBe(false);
    expect(evaluateMonetizationEligibility({ ...qualifying, watchSeconds: qualifying.watchSeconds - 1 }).eligible).toBe(false);
    expect(evaluateMonetizationEligibility({ ...qualifying, publishedTitles: 0 }).eligible).toBe(false);
  });

  it('suspension pauses monetization regardless of the other numbers', () => {
    const result = evaluateMonetizationEligibility({
      ...qualifying,
      followers: 1_000_000,
      suspended: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.goodStanding).toBe(false);
  });

  it('reports per-check progress for the earnings page', () => {
    const result = evaluateMonetizationEligibility({
      followers: 2,
      watchSeconds: 30_000,
      publishedTitles: 1,
      suspended: false,
    });
    expect(result.followers).toEqual({
      required: MONETIZATION_THRESHOLDS.minFollowers,
      actual: 2,
      met: false,
    });
    expect(result.watchSeconds.actual).toBe(30_000);
    expect(result.publishedTitles.met).toBe(true);
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
