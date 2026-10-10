import { UCAST_PHASE_LABELS } from './types';
import type { UcastPhase, UcastPollSummary } from './types';

/** "Oct 12, 2026" in the viewer's own zone. */
export function ucastDay(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Whole days from now until the instant, never negative. */
export function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
}

export function phaseLabel(phase: UcastPhase): string {
  return UCAST_PHASE_LABELS[phase];
}

/** One line a screen reader can read for a poll card: title, year, kind, phase and timing. */
export function pollStatusLine(poll: UcastPollSummary): string {
  switch (poll.phase) {
    case 'open': {
      const d = daysUntil(poll.closesAt);
      return `Closes ${ucastDay(poll.closesAt)}, ${d} ${d === 1 ? 'day' : 'days'} left`;
    }
    case 'scheduled':
      return `Opens ${ucastDay(poll.opensAt)}`;
    case 'closed':
      return `Results by ${ucastDay(poll.resultsDueAt)}`;
    case 'results':
      return `Results posted ${ucastDay(poll.resultsDueAt)}`;
    default:
      return phaseLabel(poll.phase);
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
