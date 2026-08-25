import { describe, expect, it } from 'vitest';
import {
  creatorProfileSchema,
  episodeCreateSchema,
  progressSchema,
  signUpSchema,
  titleCreateSchema,
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

describe('progressSchema', () => {
  it('accepts a normal beacon and rejects nonsense', () => {
    expect(progressSchema.safeParse({ positionS: 120, durationS: 596 }).success).toBe(true);
    expect(progressSchema.safeParse({ positionS: -1, durationS: 596 }).success).toBe(false);
    expect(progressSchema.safeParse({ positionS: 10, durationS: 0 }).success).toBe(false);
  });
});
