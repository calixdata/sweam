/** URL-safe slug from a display name: lowercase ASCII words joined by hyphens. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics left by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Slug plus a 6-character random suffix. Suffixing every generated slug (rather
 * than only on collision) keeps creation a single INSERT and avoids leaking
 * which names already exist.
 */
export function makeSlug(name: string): string {
  const base = slugify(name) || 'title';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let suffix = '';
  for (const byte of bytes) suffix += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length];
  return `${base}-${suffix}`;
}
