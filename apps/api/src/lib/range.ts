/**
 * HTTP Range header parsing for media serving (RFC 9110 section 14).
 *
 * We support the single-range forms browsers actually send for video:
 *   bytes=a-b   a through b inclusive
 *   bytes=a-    a through end of file
 *   bytes=-n    final n bytes
 *
 * Multi-range requests are treated as unsatisfiable rather than silently
 * serving the first range, which keeps responses unambiguous.
 */

export interface ByteRange {
  offset: number;
  length: number;
}

export type RangeResult = ByteRange | 'invalid' | null;

/**
 * @param header The raw Range header, or null when absent.
 * @param size   Total object size in bytes.
 * @returns null for "serve the whole object", 'invalid' for a 416, or the
 *          satisfiable byte window.
 */
export function parseRange(header: string | null, size: number): RangeResult {
  if (header === null || header === '') return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';

  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';
  if (startRaw === '' && endRaw === '') return 'invalid';
  if (size <= 0) return 'invalid';

  // Suffix form: bytes=-n, the final n bytes.
  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }

  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start >= size) return 'invalid';

  // Open-ended form: bytes=a-.
  if (endRaw === '') {
    return { offset: start, length: size - start };
  }

  const end = Number(endRaw);
  if (!Number.isSafeInteger(end) || end < start) return 'invalid';
  const clampedEnd = Math.min(end, size - 1);
  return { offset: start, length: clampedEnd - start + 1 };
}

/** Content-Range header value for a 206 response. */
export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
}
