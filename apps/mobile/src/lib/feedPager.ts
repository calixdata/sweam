import type { FeedItem } from './types';

/**
 * The endless feed. Pages run from the newest content to the oldest; after the
 * oldest, an "all caught up" card and then the feed again from the newest, so
 * scrolling never dead-ends. Pull to refresh starts over from the newest.
 */

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

export type FeedEntry =
  | { kind: 'item'; key: string; item: FeedItem }
  | { kind: 'end'; key: string };

export interface Pager {
  entries: FeedEntry[];
  /** Cursor for the next older page; null once the oldest page is in. */
  cursor: string | null;
  /** How many times the feed has wrapped around to the newest again. */
  cycle: number;
  /** Item keys already shown in this cycle (a page may overlap the last). */
  seen: Set<string>;
  /** A wrap found nothing to show: stop asking. */
  exhausted: boolean;
}

export const itemKey = (i: FeedItem): string => `${i.titleId}:${i.episodeId}`;

function addItems(p: Pager, items: FeedItem[]): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const item of items) {
    const k = itemKey(item);
    if (p.seen.has(k)) continue;
    p.seen.add(k);
    out.push({ kind: 'item', key: `${k}#${p.cycle}`, item });
  }
  return out;
}

/** A fresh feed from its first page. */
export function startPager(page: FeedPage): Pager {
  const p: Pager = { entries: [], cursor: page.nextCursor, cycle: 0, seen: new Set(), exhausted: false };
  p.entries = addItems(p, page.items);
  return p;
}

/** The next older page of the current pass. */
export function appendPage(prev: Pager, page: FeedPage): Pager {
  const p: Pager = { ...prev, seen: new Set(prev.seen) };
  p.entries = [...prev.entries, ...addItems(p, page.items)];
  p.cursor = page.nextCursor;
  return p;
}

/** Past the oldest: an "all caught up" card, then the newest page again. */
export function wrapAround(prev: Pager, firstPage: FeedPage): Pager {
  const cycle = prev.cycle + 1;
  const p: Pager = { ...prev, cycle, seen: new Set(), cursor: firstPage.nextCursor };
  const again = addItems(p, firstPage.items);
  if (again.length === 0) return { ...prev, exhausted: true };
  p.entries = [...prev.entries, { kind: 'end', key: `end#${cycle}` }, ...again];
  return p;
}

/** What the next scroll-to-the-end request should fetch. */
export function nextRequest(p: Pager): { before: string } | 'wrap' | null {
  if (p.exhausted) return null;
  if (p.cursor) return { before: p.cursor };
  return p.entries.length ? 'wrap' : null;
}

export function itemCount(p: Pager | null): number {
  return p ? p.entries.reduce((n, e) => n + (e.kind === 'item' ? 1 : 0), 0) : 0;
}
