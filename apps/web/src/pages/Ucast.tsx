import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { UcastBoard, UcastPollSummary, UcastWorkKind } from '@sweam/shared';
import { UCAST_NAME, UCAST_RESULTS_WITHIN_HOURS, UCAST_WORK_KINDS, UCAST_WORK_KIND_LABELS } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { PollCard, UcastShell } from '../components/UcastShell';
import { usePageTitle } from '../hooks';

function Grid({ polls, empty }: { polls: UcastPollSummary[]; empty: string }) {
  if (polls.length === 0) return <p className="ucast-empty">{empty}</p>;
  return (
    <ul className="ucast-grid">
      {polls.map((poll) => (
        <PollCard key={poll.id} poll={poll} />
      ))}
    </ul>
  );
}

function useBoard() {
  const [board, setBoard] = useState<UcastBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<UcastBoard>('/api/ucast')
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load UCast.');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { board, error };
}

/** The board: what is open now, what is closing soon, and what comes next. */
export function Ucast() {
  usePageTitle(UCAST_NAME);
  const { user } = useAuth();
  const { board, error } = useBoard();
  const [kind, setKind] = useState<UcastWorkKind | ''>('');
  const byKind = (polls: UcastPollSummary[]) => (kind ? polls.filter((p) => p.kind === kind) : polls);

  return (
    <UcastShell>
      <section className="ucast-howto" aria-labelledby="ucast-how">
        <h2 id="ucast-how">How it works</h2>
        <ol>
          <li>
            <strong>Pick a poll.</strong> Each one is a classic with a fixed list of roles.
          </li>
          <li>
            <strong>Cast each role.</strong> One ballot per member. Agree with other members&apos; picks.
          </li>
          <li>
            <strong>Results.</strong> Every poll shows its closing date. Results are posted within {UCAST_RESULTS_WITHIN_HOURS} hours of closing.
          </li>
        </ol>
        <p>
          Missing a classic? <Link to="/ucast/request">Request a poll</Link>. Every request is checked for duplicates and reviewed by UCast before it opens.
          {!user && (
            <>
              {' '}
              <Link to="/signin" state={{ from: '/ucast' }}>
                Sign in
              </Link>{' '}
              to cast.
            </>
          )}
        </p>
      </section>

      {error && <ErrorNote message={error} />}
      {!error && !board && <Loading label="Loading polls" />}
      {board && (
        <>
          <div className="field ucast-filter">
            <label htmlFor="ucast-kind-filter">Show</label>
            <select id="ucast-kind-filter" value={kind} onChange={(event) => setKind(event.target.value as UcastWorkKind | '')}>
              <option value="">All kinds</option>
              {UCAST_WORK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {UCAST_WORK_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          {byKind(board.closingSoon).length > 0 && (
            <section aria-labelledby="ucast-soon">
              <h2 id="ucast-soon">Closing this week</h2>
              <Grid polls={byKind(board.closingSoon)} empty="" />
            </section>
          )}

          <section aria-labelledby="ucast-open">
            <h2 id="ucast-open">Open for casting</h2>
            <Grid polls={byKind(board.open).filter((p) => !board.closingSoon.includes(p))} empty={board.closingSoon.length > 0 ? 'Everything else open is closing this week.' : 'No polls are open right now. Check back soon, or request one.'} />
          </section>

          {byKind(board.awaitingResults).length > 0 && (
            <section aria-labelledby="ucast-awaiting">
              <h2 id="ucast-awaiting">Closed, results coming</h2>
              <Grid polls={byKind(board.awaitingResults)} empty="" />
            </section>
          )}

          <section aria-labelledby="ucast-results">
            <h2 id="ucast-results">Latest results</h2>
            <Grid polls={byKind(board.results).slice(0, 10)} empty="No results posted yet. The first polls close and post within 48 hours." />
            {board.results.length > 10 && (
              <p>
                <Link to="/ucast/results">All results</Link>
              </p>
            )}
          </section>

          {byKind(board.scheduled).length > 0 && (
            <section aria-labelledby="ucast-scheduled">
              <h2 id="ucast-scheduled">Opening soon</h2>
              <Grid polls={byKind(board.scheduled)} empty="" />
            </section>
          )}
        </>
      )}
    </UcastShell>
  );
}

/** Every poll with posted results, newest first. */
export function UcastResults() {
  usePageTitle(`Results · ${UCAST_NAME}`);
  const { board, error } = useBoard();
  return (
    <UcastShell>
      <section aria-labelledby="ucast-all-results">
        <h2 id="ucast-all-results">Results</h2>
        <p className="page-intro">Who the room would cast, poll by poll. Results are posted within {UCAST_RESULTS_WITHIN_HOURS} hours of a poll closing.</p>
        {error && <ErrorNote message={error} />}
        {!error && !board && <Loading label="Loading results" />}
        {board && <Grid polls={board.results} empty="No results posted yet." />}
        {board && board.awaitingResults.length > 0 && (
          <>
            <h3>Closed, results coming</h3>
            <Grid polls={board.awaitingResults} empty="" />
          </>
        )}
      </section>
    </UcastShell>
  );
}
