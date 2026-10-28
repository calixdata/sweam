import { describe, expect, it } from 'vitest';
import type { TitleSummary } from '@sweam/shared';
import { TV_PAIR_CODE_ALPHABET, TV_PAIR_CODE_LENGTH } from '@sweam/shared';
import type { TvCatalogEntry } from '../src/lib/tv';
import { buildTvRows, generatePairCode } from '../src/lib/tv';

function title(overrides: Partial<TitleSummary> = {}): TitleSummary {
  return {
    id: 'ttl_1',
    slug: 'test-title',
    name: 'Test Title',
    kind: 'series',
    genre: 'Sci-Fi',
    audiences: ['Young Adult'],
    heroUrl: null,
    synopsis: 'A test title.',
    advisory: 'TV-PG',
    posterUrl: null,
    publishedAt: '2026-10-01T00:00:00.000Z',
    episodeCount: 5,
    creator: { handle: 'maker', displayName: 'Maker', avatarUrl: null, verified: false },
    isBlu: false,
    bluPriceCents: null,
    promotedBy: null,
    releasedEpisodeCount: 5,
    nextReleaseAt: null,
    aiOriginal: true,
    ...overrides,
  };
}

function entry(overrides: Partial<TvCatalogEntry> = {}): TvCatalogEntry {
  return { title: title(), featured: false, latestReleaseAt: null, ...overrides };
}

describe('generatePairCode', () => {
  it('draws codes of the right length from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generatePairCode();
      expect(code).toHaveLength(TV_PAIR_CODE_LENGTH);
      for (const ch of code) expect(TV_PAIR_CODE_ALPHABET).toContain(ch);
    }
  });

  it('never contains lookalike characters', () => {
    for (const ch of ['I', 'O', '0', '1']) {
      expect(TV_PAIR_CODE_ALPHABET).not.toContain(ch);
    }
    // 256 % 32 === 0, so the byte-to-character mapping has no modulo bias.
    expect(TV_PAIR_CODE_ALPHABET).toHaveLength(32);
  });

  it('varies between draws', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePairCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('buildTvRows', () => {
  const now = Date.parse('2026-10-27T12:00:00.000Z');

  it('returns nothing for an empty catalog', () => {
    expect(buildTvRows([], now)).toEqual([]);
  });

  it('drops empty rails and buckets kinds into series, films and more', () => {
    const rows = buildTvRows(
      [
        entry({ title: title({ id: 's1', kind: 'series' }) }),
        entry({ title: title({ id: 'f1', kind: 'film' }) }),
        entry({ title: title({ id: 'd1', kind: 'documentary' }) }),
        entry({ title: title({ id: 'x1', kind: 'short' as TitleSummary['kind'] }) }),
      ],
      now,
    );
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    expect(byKey.series?.titles.map((t) => t.id)).toEqual(['s1']);
    expect(byKey.films?.titles.map((t) => t.id)).toEqual(['f1', 'd1']);
    expect(byKey.more?.titles.map((t) => t.id)).toEqual(['x1']);
    expect(byKey.new).toBeUndefined();
    expect(byKey.coming).toBeUndefined();
  });

  it('prefers flagged titles for Featured and falls back to the catalog', () => {
    const flagged = buildTvRows(
      [entry({ title: title({ id: 'a' }) }), entry({ title: title({ id: 'b' }), featured: true })],
      now,
    );
    expect(flagged.find((r) => r.key === 'featured')?.titles.map((t) => t.id)).toEqual(['b']);

    const fallback = buildTvRows([entry({ title: title({ id: 'a' }) })], now);
    expect(fallback.find((r) => r.key === 'featured')?.titles.map((t) => t.id)).toEqual(['a']);
  });

  it('puts recent releases in New on SweamTV, newest first, and skips unreleased titles', () => {
    const rows = buildTvRows(
      [
        entry({ title: title({ id: 'old' }), latestReleaseAt: '2026-09-01T00:00:00.000Z' }),
        entry({ title: title({ id: 'newer' }), latestReleaseAt: '2026-10-26T00:00:00.000Z' }),
        entry({ title: title({ id: 'newest' }), latestReleaseAt: '2026-10-27T00:00:00.000Z' }),
        entry({
          title: title({ id: 'none-released', releasedEpisodeCount: 0 }),
          latestReleaseAt: '2026-10-27T00:00:00.000Z',
        }),
      ],
      now,
    );
    const fresh = rows.find((r) => r.key === 'new');
    expect(fresh?.titles.map((t) => t.id)).toEqual(['newest', 'newer']);
  });

  it('sorts Coming soon by the next release date', () => {
    const rows = buildTvRows(
      [
        entry({ title: title({ id: 'later', nextReleaseAt: '2026-11-10T05:00:00.000Z' }) }),
        entry({ title: title({ id: 'sooner', nextReleaseAt: '2026-11-03T05:00:00.000Z' }) }),
      ],
      now,
    );
    const coming = rows.find((r) => r.key === 'coming');
    expect(coming?.titles.map((t) => t.id)).toEqual(['sooner', 'later']);
  });

  it('caps every rail at twenty titles', () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry({ title: title({ id: `t${i}`, kind: 'series' }) }),
    );
    const rows = buildTvRows(entries, now);
    for (const row of rows) expect(row.titles.length).toBeLessThanOrEqual(20);
  });
});
