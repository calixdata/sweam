import { describe, expect, it } from 'vitest';
import type { TitleSignals } from '../src/lib/ranking';
import { DEFAULT_WEIGHTS, rankTitles, scoreTitle, smoothedFinishRate } from '../src/lib/ranking';

const NOW = Date.parse('2026-08-25T00:00:00.000Z');
const DAY = 86_400_000;

function signals(overrides: Partial<TitleSignals>): TitleSignals {
  return {
    publishedAtMs: NOW - 5 * DAY,
    impressions: 0,
    plays: 0,
    completes: 0,
    likes: 0,
    ...overrides,
  };
}

describe('scoreTitle', () => {
  it('is finite and bounded for a brand-new title with zero signals everywhere', () => {
    const result = scoreTitle(signals({ publishedAtMs: NOW }), {
      nowMs: NOW,
      catalogImpressions: 0,
    });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    for (const part of Object.values(result.parts)) {
      expect(Number.isFinite(part)).toBe(true);
      expect(part).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic: same inputs produce identical output', () => {
    const input = signals({ impressions: 40, plays: 30, completes: 20, likes: 5 });
    const opts = { nowMs: NOW, catalogImpressions: 10_000 };
    expect(scoreTitle(input, opts)).toEqual(scoreTitle(input, opts));
  });

  it('equal visibility: a small creator with a devoted audience outranks a big account with an indifferent one', () => {
    // 30 plays, 90% finish, heavily liked, barely surfaced so far.
    const smallCreator = signals({ impressions: 40, plays: 30, completes: 27, likes: 9 });
    // 3,000 plays, 30% finish, already surfaced five thousand times.
    const bigAccount = signals({ impressions: 5_000, plays: 3_000, completes: 900, likes: 300 });
    const opts = { nowMs: NOW, catalogImpressions: 10_000 };

    const small = scoreTitle(smallCreator, opts);
    const big = scoreTitle(bigAccount, opts);
    expect(small.score).toBeGreaterThan(big.score);
  });

  it('exploration bonus decays as a title accumulates impressions', () => {
    const opts = { nowMs: NOW, catalogImpressions: 50_000 };
    const atImpressions = (impressions: number) =>
      scoreTitle(signals({ impressions }), opts).parts.exploration;

    expect(atImpressions(0)).toBeGreaterThan(atImpressions(10));
    expect(atImpressions(10)).toBeGreaterThan(atImpressions(100));
    expect(atImpressions(100)).toBeGreaterThan(atImpressions(10_000));
  });

  it('exploration bonus grows with total catalog activity, so dormant titles resurface', () => {
    const dormant = signals({ impressions: 200 });
    const quietCatalog = scoreTitle(dormant, { nowMs: NOW, catalogImpressions: 1_000 });
    const busyCatalog = scoreTitle(dormant, { nowMs: NOW, catalogImpressions: 1_000_000 });
    expect(busyCatalog.parts.exploration).toBeGreaterThan(quietCatalog.parts.exploration);
  });

  it('freshness decays with age and never goes negative', () => {
    const opts = { nowMs: NOW, catalogImpressions: 10_000 };
    const at = (days: number) =>
      scoreTitle(signals({ publishedAtMs: NOW - days * DAY }), opts).parts.freshness;

    expect(at(0)).toBeGreaterThan(at(10));
    expect(at(10)).toBeGreaterThan(at(60));
    expect(at(365)).toBeGreaterThanOrEqual(0);
  });

  it('small samples are pulled toward the prior instead of dominating', () => {
    // 2-for-2 completions must not look like a guaranteed finish.
    const tiny = smoothedFinishRate({ plays: 2, completes: 2 });
    expect(tiny).toBeLessThan(0.6);
    // A large sample converges to its true rate.
    const large = smoothedFinishRate({ plays: 10_000, completes: 9_000 });
    expect(large).toBeGreaterThan(0.85);
    expect(large).toBeLessThan(0.95);
  });

  it('labels the dominant component with a viewer-facing reason', () => {
    const opts = { nowMs: NOW, catalogImpressions: 100_000 };
    const finisher = scoreTitle(
      signals({ publishedAtMs: NOW - 90 * DAY, impressions: 90_000, plays: 5_000, completes: 4_500, likes: 900 }),
      opts,
    );
    expect(finisher.reason).toBe('Viewers finish this one');

    const newcomer = scoreTitle(
      signals({ publishedAtMs: NOW - 60 * DAY, impressions: 0 }),
      opts,
    );
    expect(newcomer.reason).toBe('New voice getting its first audience');

    const fresh = scoreTitle(
      signals({ publishedAtMs: NOW, impressions: 60_000, plays: 40, completes: 10, likes: 0 }),
      opts,
    );
    expect(fresh.reason).toBe('Fresh on Sweam');
  });
});

describe('rankTitles', () => {
  it('sorts highest score first and preserves the items', () => {
    const items = [
      { id: 'stale', s: signals({ publishedAtMs: NOW - 200 * DAY, impressions: 9_000, plays: 400, completes: 40 }) },
      { id: 'beloved', s: signals({ impressions: 100, plays: 80, completes: 72, likes: 30 }) },
      { id: 'new', s: signals({ publishedAtMs: NOW - DAY, impressions: 2 }) },
    ];
    const ranked = rankTitles(items, (item) => item.s, { nowMs: NOW, catalogImpressions: 10_000 });

    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.item.id).toBe('beloved');
    const scores = ranked.map((entry) => entry.ranked.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('uses the documented default weights', () => {
    expect(DEFAULT_WEIGHTS.quality + DEFAULT_WEIGHTS.exploration + DEFAULT_WEIGHTS.freshness).toBeCloseTo(1);
  });
});
