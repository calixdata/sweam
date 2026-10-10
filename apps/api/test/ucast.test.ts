import { describe, expect, it } from 'vitest';
import {
  buildResults,
  findDuplicates,
  latestRecastableYear,
  normalizeKey,
  parseRoleLines,
  pollPhase,
  resultsDueAt,
  titleSimilarity,
  ucastWorkSlug,
} from '../src/lib/ucast';
import { adminUcastDecideSchema, ucastBallotSchema, ucastRequestSchema } from '../src/lib/validate';

describe('ucastWorkSlug', () => {
  it('is title, year, and the kind unless it is a film', () => {
    expect(ucastWorkSlug('film', 'Little Shop of Horrors', 1986)).toBe('little-shop-of-horrors-1986');
    expect(ucastWorkSlug('musical', 'The Wiz', 1978)).toBe('the-wiz-1978-musical');
    expect(ucastWorkSlug('music_video', 'Remember the Time', 1992)).toBe('remember-the-time-1992-music-video');
    expect(ucastWorkSlug('tv', 'Sister, Sister', 1994)).toBe('sister-sister-1994-tv');
  });
  it('is deterministic across case and punctuation', () => {
    expect(ucastWorkSlug('film', 'Moulin Rouge!', 2001)).toBe(ucastWorkSlug('film', 'moulin rouge', 2001));
  });
  it('matches the seeded launch polls in migration 0039', () => {
    const seeded: [Parameters<typeof ucastWorkSlug>[0], string, number, string][] = [
      ['film', 'The Bodyguard', 1992, 'the-bodyguard-1992'],
      ['musical', 'Moulin Rouge!', 2001, 'moulin-rouge-2001-musical'],
      ['song', "Ain't No Mountain High Enough", 1967, 'ain-t-no-mountain-high-enough-1967-song'],
      ['music_video', 'Telephone', 2010, 'telephone-2010-music-video'],
      ['tv', 'A Different World', 1987, 'a-different-world-1987-tv'],
    ];
    for (const [kind, title, year, slug] of seeded) expect(ucastWorkSlug(kind, title, year)).toBe(slug);
  });
});

describe('pollPhase', () => {
  const now = '2026-10-20T12:00:00.000Z';
  const base = { status: 'open' as const, opens_at: '2026-10-10T00:00:00.000Z', closes_at: '2026-11-09T00:00:00.000Z', results_at: null };
  it('reads pending and rejected from status', () => {
    expect(pollPhase({ ...base, status: 'pending' }, now)).toBe('pending');
    expect(pollPhase({ ...base, status: 'rejected' }, now)).toBe('rejected');
  });
  it('is scheduled before opens_at, open inside the window, closed after it', () => {
    expect(pollPhase({ ...base, opens_at: '2026-10-21T00:00:00.000Z' }, now)).toBe('scheduled');
    expect(pollPhase(base, now)).toBe('open');
    expect(pollPhase({ ...base, closes_at: '2026-10-20T11:59:59.000Z' }, now)).toBe('closed');
  });
  it('shows results once posted, or 48 hours after closing at the latest', () => {
    const closed = { ...base, closes_at: '2026-10-19T12:00:00.000Z' };
    expect(pollPhase(closed, now)).toBe('closed');
    expect(pollPhase({ ...closed, results_at: '2026-10-19T20:00:00.000Z' }, now)).toBe('results');
    expect(pollPhase(closed, '2026-10-21T12:00:00.000Z')).toBe('results');
    expect(pollPhase({ ...closed, status: 'closed' }, '2026-10-21T11:59:59.000Z')).toBe('closed');
  });
  it('computes the results deadline from the close', () => {
    expect(resultsDueAt('2026-10-19T12:00:00.000Z', null)).toBe('2026-10-21T12:00:00.000Z');
    expect(resultsDueAt('2026-10-19T12:00:00.000Z', '2026-10-19T13:00:00.000Z')).toBe('2026-10-19T13:00:00.000Z');
    expect(resultsDueAt(null, null)).toBeNull();
  });
});

describe('latestRecastableYear', () => {
  it('is five years before the current year', () => {
    expect(latestRecastableYear(new Date('2026-10-09T00:00:00Z'))).toBe(2021);
  });
});

describe('buildResults', () => {
  const roles = [
    { id: 'r1', name: 'Audrey', originalPerformer: 'Ellen Greene' },
    { id: 'r2', name: 'Seymour', originalPerformer: 'Rick Moranis' },
    { id: 'r3', name: 'Mushnik', originalPerformer: '' },
  ];
  it('merges a performer across ballots, ranks by ballots then votes, and computes share', () => {
    const results = buildResults(roles, [
      { role_id: 'r1', pick: 'Ariana Grande', votes: 2 },
      { role_id: 'r1', pick: 'ariana  grande', votes: 1 },
      { role_id: 'r1', pick: 'Chappell Roan', votes: 5 },
      { role_id: 'r1', pick: 'Raye', votes: 0 },
      { role_id: 'r2', pick: 'Justin Bieber', votes: 0 },
    ]);
    expect(results.map((r) => r.role.name)).toEqual(['Audrey', 'Seymour', 'Mushnik']);
    expect(results[0]!.ballots).toBe(4);
    expect(results[0]!.standings).toEqual([
      { pick: 'Ariana Grande', ballots: 2, votes: 3, share: 0.5 },
      { pick: 'Chappell Roan', ballots: 1, votes: 5, share: 0.25 },
      { pick: 'Raye', ballots: 1, votes: 0, share: 0.25 },
    ]);
    expect(results[2]).toEqual({ role: roles[2], ballots: 0, standings: [] });
  });
  it('normalizes keys the same way everywhere', () => {
    expect(normalizeKey('  Coco  Jones ')).toBe('coco jones');
  });
});

describe('findDuplicates', () => {
  const existing = [
    { slug: 'little-shop-of-horrors-1986', title: 'Little Shop of Horrors', year: 1986, kind: 'film' as const, phase: 'open' as const },
    { slug: 'the-wiz-1978-musical', title: 'The Wiz', year: 1978, kind: 'musical' as const, phase: 'open' as const },
    { slug: 'grease-1978-musical', title: 'Grease', year: 1978, kind: 'musical' as const, phase: 'open' as const },
  ];
  it('flags the same slug with full confidence', () => {
    const [top] = findDuplicates({ kind: 'film', title: 'little shop of horrors!', year: 1986 }, existing);
    expect(top?.slug).toBe('little-shop-of-horrors-1986');
    expect(top?.confidence).toBe(1);
  });
  it('flags a near title with a year off by one, lower when the kind differs', () => {
    const same = findDuplicates({ kind: 'film', title: 'Little Shop of Horror', year: 1987 }, existing);
    expect(same[0]?.slug).toBe('little-shop-of-horrors-1986');
    expect(same[0]!.confidence).toBeGreaterThan(0.4);
    const otherKind = findDuplicates({ kind: 'song', title: 'Little Shop of Horror', year: 1987 }, existing);
    expect(otherKind[0]!.confidence).toBeLessThan(same[0]!.confidence);
  });
  it('tolerates nicknames and plurals through prefix matching', () => {
    const [top] = findDuplicates({ kind: 'film', title: 'Lil Shop of Horror', year: 1987 }, existing);
    expect(top?.slug).toBe('little-shop-of-horrors-1986');
    expect(top!.confidence).toBeGreaterThanOrEqual(0.5);
  });
  it('ignores unrelated titles and stop words', () => {
    expect(findDuplicates({ kind: 'film', title: 'The Bodyguard', year: 1992 }, existing)).toEqual([]);
    expect(titleSimilarity('The Wiz', 'Wiz')).toBe(1);
  });
});

describe('parseRoleLines', () => {
  it('reads "Role - Original" and "Role (Original)" lines, drops blanks and repeats, caps the count', () => {
    const roles = parseRoleLines('Audrey - Ellen Greene\n\nSeymour (Rick Moranis)\naudrey\nMushnik\n', 3);
    expect(roles).toEqual([
      { name: 'Audrey', originalPerformer: 'Ellen Greene' },
      { name: 'Seymour', originalPerformer: 'Rick Moranis' },
      { name: 'Mushnik', originalPerformer: '' },
    ]);
  });
});

describe('UCast schemas', () => {
  it('accepts a request with defaults', () => {
    const parsed = ucastRequestSchema.parse({ kind: 'film', title: ' Grease ', year: 1978 });
    expect(parsed).toEqual({ kind: 'film', title: 'Grease', year: 1978, hook: '', note: '', roles: [], confirmDifferent: false });
  });
  it('refuses an unknown kind, an empty ballot, and a repeated role on an approval', () => {
    expect(ucastRequestSchema.safeParse({ kind: 'podcast', title: 'x', year: 1990 }).success).toBe(false);
    expect(ucastBallotSchema.safeParse({ picks: [] }).success).toBe(false);
    expect(adminUcastDecideSchema.safeParse({ approve: true, roles: [], closesAt: '2026-11-01' }).success).toBe(false);
  });
  it('normalizes the closing instant to ISO on approval', () => {
    const parsed = adminUcastDecideSchema.parse({ approve: true, roles: [{ name: 'Audrey' }], closesAt: '2026-11-01T00:00:00Z' });
    expect(parsed.approve && parsed.closesAt).toBe('2026-11-01T00:00:00.000Z');
  });
});
