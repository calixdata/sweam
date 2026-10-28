import type { TitleSummary, TvFeedRow } from '@sweam/shared';
import { TV_PAIR_CODE_ALPHABET, TV_PAIR_CODE_LENGTH } from '@sweam/shared';

/**
 * SweamTV helpers: pairing codes and the shape of the TV home screen.
 * Pure functions; the routes own all database work.
 */

/** One catalog title as the TV feed query loads it. */
export interface TvCatalogEntry {
  title: TitleSummary;
  /** Home-hero pick (titles.featured). */
  featured: boolean;
  /** When the most recent already-released episode unlocked (ISO), or null. */
  latestReleaseAt: string | null;
}

/**
 * A pairing code from webcrypto randomness. The 32-character alphabet (no
 * I, O, 0 or 1) divides 256 evenly, so there is no modulo bias.
 */
export function generatePairCode(length = TV_PAIR_CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += TV_PAIR_CODE_ALPHABET[byte % TV_PAIR_CODE_ALPHABET.length];
  return code;
}

const ROW_SIZE = 20;
/** "New on SweamTV" looks back this far. */
const NEW_WINDOW_DAYS = 14;

const SERIES_KINDS = new Set<string>(['series', 'reality']);
const FILM_KINDS = new Set<string>(['film', 'documentary']);

/**
 * Shape the flat AI-originals catalog into the TV home rails. Empty rails
 * are dropped, and a title may appear in more than one rail (Featured plus
 * its shelf), which is how every streaming home screen behaves.
 */
export function buildTvRows(entries: TvCatalogEntry[], nowMs = Date.now()): TvFeedRow[] {
  const titles = (list: TvCatalogEntry[]): TitleSummary[] =>
    list.slice(0, ROW_SIZE).map((e) => e.title);
  const featured = entries.filter((e) => e.featured);
  const newCutoff = new Date(nowMs - NEW_WINDOW_DAYS * 86_400_000).toISOString();
  const fresh = entries
    .filter(
      (e) =>
        e.latestReleaseAt && e.latestReleaseAt >= newCutoff && e.title.releasedEpisodeCount > 0,
    )
    .sort((a, b) => (b.latestReleaseAt ?? '').localeCompare(a.latestReleaseAt ?? ''));
  const comingSoon = entries
    .filter((e) => e.title.nextReleaseAt)
    .sort((a, b) => (a.title.nextReleaseAt ?? '').localeCompare(b.title.nextReleaseAt ?? ''));
  const series = entries.filter((e) => SERIES_KINDS.has(e.title.kind));
  const films = entries.filter((e) => FILM_KINDS.has(e.title.kind));
  const more = entries.filter(
    (e) => !SERIES_KINDS.has(e.title.kind) && !FILM_KINDS.has(e.title.kind),
  );

  const rows: TvFeedRow[] = [
    { key: 'featured', name: 'Featured', titles: titles(featured.length > 0 ? featured : entries) },
    { key: 'new', name: 'New on SweamTV', titles: titles(fresh) },
    { key: 'series', name: 'Binge series', titles: titles(series) },
    { key: 'films', name: 'Films', titles: titles(films) },
    { key: 'more', name: 'More AI originals', titles: titles(more) },
    { key: 'coming', name: 'Coming soon', titles: titles(comingSoon) },
  ];
  return rows.filter((row) => row.titles.length > 0);
}
