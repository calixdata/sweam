import { describe, expect, it } from 'vitest';
import {
  creatorProfileSchema,
  episodeCreateSchema,
  progressSchema,
  reportCreateSchema,
  reportResolveSchema,
  scoutApplySchema,
  signUpSchema,
  titleCreateSchema,
  titleUpdateSchema,
} from '../src/lib/validate';

describe('signUpSchema', () => {
  it('normalizes email casing and whitespace', () => {
    const parsed = signUpSchema.parse({
      email: '  Casey@Example.COM ',
      displayName: 'Casey',
      password: 'longenough',
    });
    expect(parsed.email).toBe('casey@example.com');
  });

  it('rejects short passwords and empty names', () => {
    expect(
      signUpSchema.safeParse({ email: 'a@b.co', displayName: 'A', password: 'short' }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({ email: 'a@b.co', displayName: '   ', password: 'longenough' }).success,
    ).toBe(false);
  });
});

describe('creatorProfileSchema', () => {
  it('lowercases handles before validating', () => {
    expect(creatorProfileSchema.parse({ handle: 'NovaReyes' }).handle).toBe('novareyes');
  });

  it('rejects handles with spaces, symbols, or bad lengths', () => {
    for (const handle of ['no', 'has space', 'sem;colon', 'x'.repeat(25), 'émoji']) {
      expect(creatorProfileSchema.safeParse({ handle }).success).toBe(false);
    }
  });
});

describe('titleCreateSchema', () => {
  it('accepts a minimal valid title and applies defaults', () => {
    const parsed = titleCreateSchema.parse({ name: 'My Film', kind: 'film', genre: 'Drama' });
    expect(parsed.advisory).toBe('TV-PG');
    expect(parsed.synopsis).toBe('');
    expect(parsed.posterUrl).toBeNull();
  });

  it('rejects unknown kinds and genres', () => {
    expect(titleCreateSchema.safeParse({ name: 'X', kind: 'podcast', genre: 'Drama' }).success).toBe(false);
    expect(titleCreateSchema.safeParse({ name: 'X', kind: 'film', genre: 'Cooking' }).success).toBe(false);
  });
});

describe('episodeCreateSchema', () => {
  it('accepts https URLs and Sweam /media/ paths for video', () => {
    expect(
      episodeCreateSchema.safeParse({ name: 'Pilot', videoUrl: 'https://cdn.example.com/v.mp4' }).success,
    ).toBe(true);
    expect(
      episodeCreateSchema.safeParse({ name: 'Pilot', videoUrl: '/media/u/abc/def/v.mp4' }).success,
    ).toBe(true);
  });

  it('rejects javascript:, relative, and empty video URLs', () => {
    for (const videoUrl of ['javascript:alert(1)', 'v.mp4', '', 'ftp://x/y.mp4', '/etc/passwd']) {
      expect(episodeCreateSchema.safeParse({ name: 'Pilot', videoUrl }).success).toBe(false);
    }
  });

  it('bounds season and episode numbers', () => {
    const base = { name: 'Pilot', videoUrl: 'https://cdn.example.com/v.mp4' };
    expect(episodeCreateSchema.safeParse({ ...base, season: 0 }).success).toBe(false);
    expect(episodeCreateSchema.safeParse({ ...base, episode: 501 }).success).toBe(false);
    expect(episodeCreateSchema.safeParse({ ...base, season: 1, episode: 1 }).success).toBe(true);
  });
});

describe('titleUpdateSchema', () => {
  it('accepts a scoutable-only update', () => {
    const parsed = titleUpdateSchema.safeParse({ scoutable: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.scoutable).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(titleUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('scoutApplySchema', () => {
  it('accepts a full application and normalizes the contact email', () => {
    const parsed = scoutApplySchema.parse({
      orgName: 'Northlight Studios',
      orgUrl: 'https://northlight.example',
      contactEmail: 'Scouting@Northlight.example',
    });
    expect(parsed.contactEmail).toBe('scouting@northlight.example');
  });

  it('defaults a missing website to null but rejects a malformed one', () => {
    expect(
      scoutApplySchema.parse({ orgName: 'Northlight', contactEmail: 'a@b.co' }).orgUrl,
    ).toBeNull();
    expect(
      scoutApplySchema.safeParse({ orgName: 'Northlight', orgUrl: 'not a url', contactEmail: 'a@b.co' })
        .success,
    ).toBe(false);
  });

  it('rejects one-character organization names', () => {
    expect(scoutApplySchema.safeParse({ orgName: 'X', contactEmail: 'a@b.co' }).success).toBe(false);
  });
});

describe('reportCreateSchema', () => {
  it('accepts a report with a known reason and defaults the note', () => {
    const parsed = reportCreateSchema.parse({ titleId: 'ttl_x', reason: 'copyright' });
    expect(parsed.note).toBe('');
  });

  it('rejects unknown reasons', () => {
    expect(reportCreateSchema.safeParse({ titleId: 'ttl_x', reason: 'ugly' }).success).toBe(false);
  });
});

describe('reportResolveSchema', () => {
  it('requires a takedown kind for takedown actions', () => {
    expect(reportResolveSchema.safeParse({ action: 'takedown' }).success).toBe(false);
    expect(reportResolveSchema.safeParse({ action: 'takedown_and_strike' }).success).toBe(false);
    expect(reportResolveSchema.safeParse({ action: 'takedown', kind: 'dmca' }).success).toBe(true);
  });

  it('allows dismiss and strike without a kind', () => {
    expect(reportResolveSchema.safeParse({ action: 'dismiss' }).success).toBe(true);
    expect(reportResolveSchema.safeParse({ action: 'strike' }).success).toBe(true);
  });
});

describe('progressSchema', () => {
  it('accepts a normal beacon and rejects nonsense', () => {
    expect(progressSchema.safeParse({ positionS: 120, durationS: 596 }).success).toBe(true);
    expect(progressSchema.safeParse({ positionS: -1, durationS: 596 }).success).toBe(false);
    expect(progressSchema.safeParse({ positionS: 10, durationS: 0 }).success).toBe(false);
  });
});
