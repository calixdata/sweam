import { describe, expect, it } from 'vitest';
import {
  buildRoleConsensus,
  duplicateRole,
  latestRecastableYear,
  normalizeKey,
  ucastWorkSlug,
} from '../src/lib/ucast';
import { ucastRecastCreateSchema, ucastWorkCreateSchema } from '../src/lib/validate';

describe('ucastWorkSlug', () => {
  it('is title, year, and the kind unless it is a film', () => {
    expect(ucastWorkSlug('film', 'Little Shop of Horrors', 1986)).toBe('little-shop-of-horrors-1986');
    expect(ucastWorkSlug('musical', 'The Wiz', 1978)).toBe('the-wiz-1978-musical');
    expect(ucastWorkSlug('music_video', 'Remember the Time', 1992)).toBe('remember-the-time-1992-music-video');
    expect(ucastWorkSlug('tv', 'Sister, Sister', 1994)).toBe('sister-sister-1994-tv');
  });

  it('is deterministic across spelling noise so two members land on one board', () => {
    expect(ucastWorkSlug('song', "Ain't No Mountain High Enough", 1967)).toBe(
      ucastWorkSlug('song', 'AIN’T no mountain  high enough', 1967),
    );
    expect(ucastWorkSlug('film', 'Moulin Rouge!', 2001)).toBe('moulin-rouge-2001');
  });

  it('matches every seeded open call in migration 0039', () => {
    const seeded: [Parameters<typeof ucastWorkSlug>[0], string, number, string][] = [
      ['film', 'The Bodyguard', 1992, 'the-bodyguard-1992'],
      ['musical', 'Moulin Rouge!', 2001, 'moulin-rouge-2001-musical'],
      ['song', 'The Closer I Get to You', 1978, 'the-closer-i-get-to-you-1978-song'],
      ['music_video', 'Telephone', 2010, 'telephone-2010-music-video'],
      ['tv', 'A Different World', 1987, 'a-different-world-1987-tv'],
    ];
    for (const [kind, title, year, slug] of seeded) expect(ucastWorkSlug(kind, title, year)).toBe(slug);
  });
});

describe('duplicateRole', () => {
  it('finds a role named twice regardless of case and spacing', () => {
    expect(duplicateRole([{ role: 'Audrey' }, { role: 'Seymour' }, { role: ' audrey ' }])).toBe('audrey');
  });
  it('is null when every role is distinct', () => {
    expect(duplicateRole([{ role: 'Audrey' }, { role: 'Audrey II' }])).toBeNull();
  });
  it('normalizes keys the same way consensus does', () => {
    expect(normalizeKey('  Voice  of Audrey II ')).toBe('voice of audrey ii');
  });
});

describe('latestRecastableYear', () => {
  it('is five years before the current year', () => {
    expect(latestRecastableYear(new Date('2026-10-09T00:00:00Z'))).toBe(2021);
  });
});

describe('buildRoleConsensus', () => {
  it('merges the same performer across recasts and ranks by votes plus mentions', () => {
    const roles = buildRoleConsensus([
      { role: 'Audrey', pick: 'Ariana Grande', votes: 2 },
      { role: 'audrey', pick: 'ariana grande', votes: 1 },
      { role: 'Audrey', pick: 'Chappell Roan', votes: 5 },
      { role: 'Seymour', pick: 'Justin Bieber', votes: 0 },
    ]);
    expect(roles.map((r) => r.role)).toEqual(['Audrey', 'Seymour']);
    const audrey = roles[0]!;
    // Roan: 5 votes + 1 recast = 6. Grande: 3 votes + 2 recasts = 5.
    expect(audrey.picks).toEqual([
      { pick: 'Chappell Roan', votes: 5, recasts: 1 },
      { pick: 'Ariana Grande', votes: 3, recasts: 2 },
    ]);
    expect(roles[1]!.picks).toEqual([{ pick: 'Justin Bieber', votes: 0, recasts: 1 }]);
  });

  it('keeps the first spelling seen for display and is empty for no picks', () => {
    expect(buildRoleConsensus([])).toEqual([]);
    const roles = buildRoleConsensus([
      { role: 'Voice of Audrey II', pick: 'Charlie Wilson', votes: 0 },
      { role: 'voice of audrey ii', pick: 'Keith David', votes: 0 },
    ]);
    expect(roles[0]!.role).toBe('Voice of Audrey II');
    expect(roles[0]!.picks.map((p) => p.pick)).toEqual(['Charlie Wilson', 'Keith David']);
  });
});

describe('UCast schemas', () => {
  it('accepts a work and trims it', () => {
    const parsed = ucastWorkCreateSchema.parse({ kind: 'film', title: '  Grease ', year: 1978 });
    expect(parsed).toEqual({ kind: 'film', title: 'Grease', year: 1978, hook: '' });
  });
  it('rejects an unknown kind and an empty pick list', () => {
    expect(ucastWorkCreateSchema.safeParse({ kind: 'podcast', title: 'x', year: 1990 }).success).toBe(false);
    expect(ucastRecastCreateSchema.safeParse({ picks: [] }).success).toBe(false);
  });
  it('caps the cast at twelve roles', () => {
    const picks = Array.from({ length: 13 }, (_, i) => ({ role: `Role ${i}`, pick: 'Someone' }));
    expect(ucastRecastCreateSchema.safeParse({ picks }).success).toBe(false);
    expect(ucastRecastCreateSchema.safeParse({ picks: picks.slice(0, 12) }).success).toBe(true);
  });
  it('defaults optional fields on a pick', () => {
    const parsed = ucastRecastCreateSchema.parse({ picks: [{ role: 'Audrey', pick: 'Ariana Grande' }] });
    expect(parsed.picks[0]).toEqual({ role: 'Audrey', pick: 'Ariana Grande', originalPerformer: '', note: '' });
  });
});
