import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import type { UcastPhase, UcastPollSummary } from '@sweam/shared';
import { UCAST_HANDLE, UCAST_NAME, UCAST_PHASE_LABELS, UCAST_WORK_KIND_LABELS } from '@sweam/shared';
import { useAuth } from '../auth';
import { VerifiedBadge } from './VerifiedBadge';

/** "Nov 9, 2026" from an ISO instant. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "Nov 9, 2026, 11:59 PM" from an ISO instant. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "5 days left", "closes today", or "" once past. */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return '';
  const hours = Math.ceil(ms / 3_600_000);
  if (hours < 24) return hours <= 1 ? 'closes within the hour' : `closes in ${hours} hours`;
  const days = Math.ceil(ms / 86_400_000);
  return days === 1 ? 'closes tomorrow' : `${days} days left`;
}

/** Swap the tab icon for the UCast mark while a UCast page is open. */
export function useUcastFavicon(): void {
  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
    const previous = links.map((link) => link.href);
    for (const link of links) link.href = '/brand/ucast-favicon.svg';
    return () => {
      links.forEach((link, i) => {
        link.href = previous[i] ?? link.href;
      });
    };
  }, []);
}

export function PhasePill({ phase }: { phase: UcastPhase }) {
  return <span className={`ucast-pill ucast-pill-${phase}`}>{UCAST_PHASE_LABELS[phase]}</span>;
}

/** The one-line status of a poll, the same words everywhere it appears. */
export function pollStatusLine(poll: UcastPollSummary): string {
  switch (poll.phase) {
    case 'open':
      return poll.closesAt ? `Closes ${formatDay(poll.closesAt)}${timeLeft(poll.closesAt) ? ` · ${timeLeft(poll.closesAt)}` : ''}` : 'Open';
    case 'scheduled':
      return poll.opensAt ? `Opens ${formatDay(poll.opensAt)}` : 'Opens soon';
    case 'closed':
      return poll.resultsDueAt ? `Closed · results by ${formatDay(poll.resultsDueAt)}` : 'Closed';
    case 'results':
      return poll.closesAt ? `Closed ${formatDay(poll.closesAt)} · results posted` : 'Results posted';
    case 'pending':
      return 'Awaiting admin review';
    case 'rejected':
      return 'Not opened';
  }
}

/** A poll card: cover (or a typographic stand-in), kind, title, status, counts, and one clear action. */
export function PollCard({ poll }: { poll: UcastPollSummary }) {
  const action =
    poll.phase === 'open' ? 'Cast your picks' : poll.phase === 'results' ? 'See the results' : poll.phase === 'closed' ? 'Results coming' : 'Preview';
  return (
    <li className="ucast-card">
      <Link to={`/ucast/p/${poll.slug}`} className="ucast-card-link" aria-label={`${poll.title} (${poll.year}), ${UCAST_WORK_KIND_LABELS[poll.kind]}: ${pollStatusLine(poll)}. ${action}.`}>
        {poll.coverUrl ? (
          <img className="ucast-cover" src={poll.coverUrl} alt="" />
        ) : (
          <div className={`ucast-cover ucast-cover-blank ucast-kind-${poll.kind}`} aria-hidden="true">
            <span>{UCAST_WORK_KIND_LABELS[poll.kind]}</span>
          </div>
        )}
        <div className="ucast-card-body">
          <div className="ucast-card-top">
            <span className="ucast-card-kind">{UCAST_WORK_KIND_LABELS[poll.kind]}</span>
            <PhasePill phase={poll.phase} />
          </div>
          <span className="ucast-card-title">
            {poll.title} <span className="ucast-card-year">({poll.year})</span>
          </span>
          <span className="ucast-card-status">{pollStatusLine(poll)}</span>
          <span className="ucast-card-meta">
            {poll.roleCount} {poll.roleCount === 1 ? 'role' : 'roles'} · {poll.ballotCount} {poll.ballotCount === 1 ? 'ballot' : 'ballots'}
          </span>
          <span className="ucast-card-action">{action}</span>
        </div>
      </Link>
    </li>
  );
}

/**
 * The frame every UCast page sits in: the mark and name, the room's
 * sub-navigation, and the disclaimer. Keeps the room feeling like one place
 * inside Sweam rather than scattered pages.
 */
export function UcastShell({ children, title }: { children: ReactNode; title?: string }) {
  useUcastFavicon();
  const { user } = useAuth();
  return (
    <div className="page ucast-page">
      <header className="ucast-masthead">
        <Link to="/ucast" className="ucast-brand" aria-label={`${UCAST_NAME} home`}>
          <img src="/brand/ucast-mark.svg" alt="" width={44} height={44} />
          <span>
            <span className="ucast-brand-name">{UCAST_NAME}</span>
            <span className="ucast-brand-tag">Recast the classics. Vote. See who the room would cast.</span>
          </span>
        </Link>
        <nav aria-label="UCast sections" className="ucast-nav">
          <ul>
            <li>
              <NavLink to="/ucast" end>
                Polls
              </NavLink>
            </li>
            <li>
              <NavLink to="/ucast/results">Results</NavLink>
            </li>
            <li>
              <NavLink to="/ucast/request">{user ? 'Request a poll' : 'Request a poll'}</NavLink>
            </li>
            {user?.scout?.status === 'approved' && (
              <li>
                <NavLink to="/scout/ucast">Scout data</NavLink>
              </li>
            )}
            {user?.isAdmin && (
              <li>
                <NavLink to="/admin/ucast">Admin</NavLink>
              </li>
            )}
          </ul>
        </nav>
      </header>
      {title && <h1 className="visually-hidden">{title}</h1>}
      {children}
      <p className="ucast-disclaimer" role="note">
        Hosted by{' '}
        <Link to={`/c/${UCAST_HANDLE}`}>
          @{UCAST_HANDLE} <VerifiedBadge />
        </Link>
        , Sweam&apos;s own account.
      </p>
    </div>
  );
}
