import type { UcastRoleConsensus, UcastWorkKind } from '@sweam/shared';
import { UCAST_MIN_WORK_AGE_YEARS } from '@sweam/shared';
import { slugify } from './slug';

/**
 * UCast helpers that have no database in them, so they can be unit tested:
 * the deterministic work slug (which is how two members opening the same
 * title land on the same page), the role consensus math, and the pick-list
 * checks that zod shapes cannot express.
 */

/**
 * One slug per (title, year, kind): the slugified title, the year, and the
 * kind unless it is a film. Deterministic on purpose, so "Grease (1978),
 * musical" opened twice is the same work, not two boards.
 */
export function ucastWorkSlug(kind: UcastWorkKind, title: string, year: number): string {
  const base = slugify(title) || 'work';
  const kindPart = kind === 'film' ? '' : `-${kind.replace(/_/g, '-')}`;
  return `${base}-${year}${kindPart}`;
}

/** Roles are grouped case- and whitespace-insensitively ("Audrey" and "audrey " agree). */
export function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The latest year a work may carry to count as a classic worth recasting. */
export function latestRecastableYear(now: Date = new Date()): number {
  return now.getUTCFullYear() - UCAST_MIN_WORK_AGE_YEARS;
}

/**
 * The first role that appears twice in a pick list (after normalization), or
 * null. One recast names each role once; a second opinion on the same role is
 * a second recast.
 */
export function duplicateRole(picks: readonly { role: string }[]): string | null {
  const seen = new Set<string>();
  for (const pick of picks) {
    const key = normalizeKey(pick.role);
    if (seen.has(key)) return pick.role.trim();
    seen.add(key);
  }
  return null;
}

export interface ConsensusRow {
  role: string;
  pick: string;
  votes: number;
}

/**
 * Who the room would cast, per role. Picks for the same role are merged
 * across recasts by performer name; a performer's standing is the votes they
 * gathered plus the number of recasts that named them (so a pick nobody has
 * voted on yet still shows up with its support counted). Roles are ordered by
 * how much attention they drew, performers within a role by standing.
 */
export function buildRoleConsensus(rows: readonly ConsensusRow[]): UcastRoleConsensus[] {
  const roles = new Map<string, { role: string; picks: Map<string, { pick: string; votes: number; recasts: number }> }>();
  for (const row of rows) {
    const roleKey = normalizeKey(row.role);
    let role = roles.get(roleKey);
    if (!role) {
      role = { role: row.role.trim(), picks: new Map() };
      roles.set(roleKey, role);
    }
    const pickKey = normalizeKey(row.pick);
    const pick = role.picks.get(pickKey);
    if (pick) {
      pick.votes += row.votes;
      pick.recasts += 1;
    } else {
      role.picks.set(pickKey, { pick: row.pick.trim(), votes: row.votes, recasts: 1 });
    }
  }
  const standing = (p: { votes: number; recasts: number }) => p.votes + p.recasts;
  return [...roles.values()]
    .map((role) => ({
      role: role.role,
      picks: [...role.picks.values()].sort(
        (a, b) => standing(b) - standing(a) || b.votes - a.votes || a.pick.localeCompare(b.pick),
      ),
    }))
    .sort((a, b) => {
      const total = (r: UcastRoleConsensus) => r.picks.reduce((sum, p) => sum + standing(p), 0);
      return total(b) - total(a) || a.role.localeCompare(b.role);
    });
}
