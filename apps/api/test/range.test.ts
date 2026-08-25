import { describe, expect, it } from 'vitest';
import { contentRange, parseRange } from '../src/lib/range';

const SIZE = 1_000;

describe('parseRange', () => {
  it('returns null (serve whole object) when no header is present', () => {
    expect(parseRange(null, SIZE)).toBeNull();
    expect(parseRange('', SIZE)).toBeNull();
  });

  it('parses a bounded range inclusively', () => {
    expect(parseRange('bytes=0-499', SIZE)).toEqual({ offset: 0, length: 500 });
    expect(parseRange('bytes=500-999', SIZE)).toEqual({ offset: 500, length: 500 });
    expect(parseRange('bytes=10-10', SIZE)).toEqual({ offset: 10, length: 1 });
  });

  it('clamps an end beyond the object to the last byte', () => {
    expect(parseRange('bytes=900-5000', SIZE)).toEqual({ offset: 900, length: 100 });
  });

  it('parses an open-ended range to end of file', () => {
    expect(parseRange('bytes=250-', SIZE)).toEqual({ offset: 250, length: 750 });
    expect(parseRange('bytes=999-', SIZE)).toEqual({ offset: 999, length: 1 });
  });

  it('parses a suffix range as the final n bytes', () => {
    expect(parseRange('bytes=-100', SIZE)).toEqual({ offset: 900, length: 100 });
    expect(parseRange('bytes=-5000', SIZE)).toEqual({ offset: 0, length: SIZE });
  });

  it('rejects a start at or past the end of the object', () => {
    expect(parseRange('bytes=1000-', SIZE)).toBe('invalid');
    expect(parseRange('bytes=1000-1200', SIZE)).toBe('invalid');
  });

  it('rejects inverted, empty, and malformed ranges', () => {
    expect(parseRange('bytes=500-100', SIZE)).toBe('invalid');
    expect(parseRange('bytes=-', SIZE)).toBe('invalid');
    expect(parseRange('bytes=-0', SIZE)).toBe('invalid');
    expect(parseRange('bytes=abc-def', SIZE)).toBe('invalid');
    expect(parseRange('items=0-10', SIZE)).toBe('invalid');
  });

  it('treats multi-range requests as unsatisfiable rather than serving the first range', () => {
    expect(parseRange('bytes=0-100,200-300', SIZE)).toBe('invalid');
  });

  it('rejects any range against an empty object', () => {
    expect(parseRange('bytes=0-10', 0)).toBe('invalid');
    expect(parseRange('bytes=-10', 0)).toBe('invalid');
  });
});

describe('contentRange', () => {
  it('formats the RFC 9110 Content-Range value', () => {
    expect(contentRange({ offset: 0, length: 500 }, SIZE)).toBe('bytes 0-499/1000');
    expect(contentRange({ offset: 900, length: 100 }, SIZE)).toBe('bytes 900-999/1000');
  });
});
