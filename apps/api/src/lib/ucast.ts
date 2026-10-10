import type {
  UcastDuplicateCandidate,
  UcastPhase,
  UcastRole,
  UcastRoleResult,
  UcastWorkKind,
} from '@sweam/shared';
import { UCAST_MIN_WORK_AGE_YEARS, UCAST_RESULTS_WITHIN_HOURS } from '@sweam/shared';
import { slugify } from './slug';

/**
 * UCast helpers with no database in them, so they are unit tested: the
 * deterministic poll slug, the poll phase, the per-role results math, and the
 * fuzzy duplicate matcher that runs before (and without) the AI check.
 */

/**
 * One slug per (title, year, kind): the slugified title, the year, and the
 * kind unless it is a film. Deterministic on purpose, so the same work
 * requested twice collides instead of becoming two polls.
 */
export function ucastWorkSlug(kind: UcastWorkKind, title: string, year: number): string {
  const base = slugify(title) || 'work';
  const kindPart = kind === 'film' ? '' : `-${kind.replace(/_/g, '-')}`;
  return `${base}-${year}${kindPart}`;
}

/** Names are grouped case- and whitespace-insensitively ("Coco Jones" and "coco  jones" agree). */
export function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The latest year a work may carry to count as a classic worth polling. */
export function latestRecastableYear(now: Date = new Date()): number {
  return now.getUTCFullYear() - UCAST_MIN_WORK_AGE_YEARS;
}

/** ISO instant by which results must be public: the posting time, else closes + 48 h. */
export function resultsDueAt(closesAt: string | null, resultsAt: string | null): string | null {
  if (resultsAt) return resultsAt;
  if (!closesAt) return null;
  return new Date(new Date(closesAt).getTime() + UCAST_RESULTS_WITHIN_HOURS * 3_600_000).toISOString();
}

export interface PhaseInput {
  status: 'pending' | 'open' | 'closed' | 'rejected';
  opens_at: string | null;
  closes_at: string | null;
  results_at: string | null;
}

/**
 * Where a poll is right now. An 'open' row before its opens_at is scheduled;
 * past its closes_at it is closed; once results are posted, or 48 hours have
 * passed since closing (the deadline the room promises), results are public.
 */
export function pollPhase(row: PhaseInput, nowIso: string = new Date().toISOString()): UcastPhase {
  if (row.status === 'pending') return 'pending';
  if (row.status === 'rejected') return 'rejected';
  if (row.status === 'open' && row.opens_at && row.opens_at > nowIso) return 'scheduled';
  const closed = row.status === 'closed' || (row.closes_at !== null && row.closes_at <= nowIso);
  if (!closed) return 'open';
  if (row.results_at && row.results_at <= nowIso) return 'results';
  const due = resultsDueAt(row.closes_at, null);
  if (due && due <= nowIso) return 'results';
  return 'closed';
}

export interface StandingRow {
  role_id: string;
  pick: string;
  votes: number;
}

/**
 * Results per role. Picks naming the same performer are merged by name; a
 * performer's share is the fraction of ballots that cast the role and chose
 * them. Standings sort by ballots, then votes, then name, so the order is the
 * poll's answer and the agreements break ties.
 */
export function buildResults(roles: readonly UcastRole[], rows: readonly StandingRow[]): UcastRoleResult[] {
  const byRole = new Map<string, Map<string, { pick: string; ballots: number; votes: number }>>();
  for (const row of rows) {
    let picks = byRole.get(row.role_id);
    if (!picks) {
      picks = new Map();
      byRole.set(row.role_id, picks);
    }
    const key = normalizeKey(row.pick);
    const entry = picks.get(key);
    if (entry) {
      entry.ballots += 1;
      entry.votes += row.votes;
    } else {
      picks.set(key, { pick: row.pick.trim(), ballots: 1, votes: row.votes });
    }
  }
  return roles.map((role) => {
    const picks = [...(byRole.get(role.id)?.values() ?? [])];
    const ballots = picks.reduce((sum, p) => sum + p.ballots, 0);
    const standings = picks
      .sort((a, b) => b.ballots - a.ballots || b.votes - a.votes || a.pick.localeCompare(b.pick))
      .map((p) => ({ ...p, share: ballots === 0 ? 0 : p.ballots / ballots }));
    return { role, ballots, standings };
  });
}

/** Title words that carry no identity ("the", "a", "of") are ignored when comparing titles. */
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', '&', 'in', 'on', 'to', 'at', 'for']);

/** The identifying tokens of a title: lowercase ASCII words, stop words and punctuation dropped. */
export function titleTokens(title: string): string[] {
  return slugify(title)
    .split('-')
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

/** Two title tokens match when equal, or when one is a 3+ letter prefix of the other ("horror"/"horrors", "lil"/"little"). */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

/** Dice coefficient over title tokens with prefix-tolerant matching, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = [...new Set(titleTokens(a))];
  const tb = [...new Set(titleTokens(b))];
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Set<number>();
  let shared = 0;
  for (const t of ta) {
    const j = tb.findIndex((u, i) => !used.has(i) && tokensMatch(t, u));
    if (j !== -1) {
      used.add(j);
      shared += 1;
    }
  }
  return (2 * shared) / (ta.length + tb.length);
}

export interface ExistingWork {
  slug: string;
  title: string;
  year: number;
  kind: UcastWorkKind;
  phase: UcastPhase;
}

/**
 * Deterministic duplicate matching: the same slug is the same work; otherwise
 * a title that shares most of its words with an existing poll within a year
 * or two (remakes aside) is a likely duplicate. Returns the best candidates,
 * most confident first. Runs before the AI check and stands in for it when
 * no key is configured.
 */
export function findDuplicates(
  request: { kind: UcastWorkKind; title: string; year: number },
  existing: readonly ExistingWork[],
  limit = 5,
): UcastDuplicateCandidate[] {
  const slug = ucastWorkSlug(request.kind, request.title, request.year);
  const out: UcastDuplicateCandidate[] = [];
  for (const work of existing) {
    if (work.slug === slug) {
      out.push({ ...work, reason: 'The same work is already in UCast.', confidence: 1 });
      continue;
    }
    const sim = titleSimilarity(request.title, work.title);
    if (sim < 0.5) continue;
    const yearGap = Math.abs(work.year - request.year);
    let confidence = sim * (yearGap === 0 ? 0.9 : yearGap <= 2 ? 0.75 : 0.45);
    if (work.kind !== request.kind) confidence *= 0.8;
    if (confidence < 0.35) continue;
    out.push({
      ...work,
      reason:
        yearGap === 0
          ? 'A poll with a very similar title and the same year exists.'
          : `A poll with a similar title exists (${work.year}).`,
      confidence: Math.round(confidence * 100) / 100,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

/** Lines of a "one role per line" textarea into role drafts, trimmed and de-duplicated. */
export function parseRoleLines(text: string, max: number): { name: string; originalPerformer: string }[] {
  const seen = new Set<string>();
  const roles: { name: string; originalPerformer: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // "Role name - Original performer" or "Role name (Original performer)".
    const match = /^(.*?)\s*(?:[-–—:]\s*|\()\s*([^()]*?)\)?\s*$/.exec(line);
    const name = (match && match[2] ? (match[1] ?? line) : line).trim().slice(0, 80);
    const originalPerformer = (match && match[2] ? match[2] : '').trim().slice(0, 80);
    const key = normalizeKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    roles.push({ name, originalPerformer });
    if (roles.length >= max) break;
  }
  return roles;
}
