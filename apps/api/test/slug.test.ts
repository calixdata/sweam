import { describe, expect, it } from 'vitest';
import { makeSlug, slugify } from '../src/lib/slug';

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Big Buck Bunny')).toBe('big-buck-bunny');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify("Nova's  Late-Night!! Special")).toBe('nova-s-late-night-special');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Métro')).toBe('cafe-metro');
  });

  it('never starts or ends with a hyphen, even after truncation', () => {
    const slug = slugify('x'.repeat(59) + ' tail words beyond the limit');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.startsWith('-')).toBe(false);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('returns an empty string for fully non-ascii input (caller falls back)', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('makeSlug', () => {
  it('appends a 6-character suffix to the base slug', () => {
    expect(makeSlug('Big Buck Bunny')).toMatch(/^big-buck-bunny-[a-z0-9]{6}$/);
  });

  it('falls back to "title" when the name has no sluggable characters', () => {
    expect(makeSlug('???')).toMatch(/^title-[a-z0-9]{6}$/);
  });

  it('produces distinct slugs for identical names', () => {
    expect(makeSlug('Same Name')).not.toBe(makeSlug('Same Name'));
  });
});
