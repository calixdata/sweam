import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ScoutUcastPoll, UcastPollSummary } from '@sweam/shared';
import { UCAST_NAME, UCAST_PHASE_LABELS, UCAST_WORK_KIND_LABELS } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { formatWhen } from '../components/UcastShell';
import { usePageTitle } from '../hooks';

function PollResults({ slug }: { slug: string }) {
  const [data, setData] = useState<ScoutUcastPoll | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<ScoutUcastPoll>(`/api/ucast/scout/${encodeURIComponent(slug)}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load results.');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading label="Loading results" />;
  return (
    <div className="ucast-scout-results">
      <p className="field-hint">
        {data.participants} participants · {data.totalVotes} agreements · {UCAST_PHASE_LABELS[data.poll.phase]}
        {data.poll.closesAt && ` · closes ${formatWhen(data.poll.closesAt)}`} ·{' '}
        <a href={`/api/ucast/scout/${encodeURIComponent(slug)}/results.csv`}>Download CSV</a>
      </p>
      <div className="table-scroll">
        <table className="studio-table">
          <caption className="visually-hidden">Results for {data.poll.title}</caption>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Originally</th>
              <th scope="col">Performer</th>
              <th scope="col">Ballots</th>
              <th scope="col">Share</th>
              <th scope="col">Agreements</th>
            </tr>
          </thead>
          <tbody>
            {data.results.flatMap((r) =>
              r.standings.length === 0
                ? [
                    <tr key={r.role.id}>
                      <th scope="row">{r.role.name}</th>
                      <td>{r.role.originalPerformer}</td>
                      <td colSpan={4}>No ballots yet</td>
                    </tr>,
                  ]
                : r.standings.map((s, i) => (
                    <tr key={`${r.role.id}-${s.pick}`}>
                      <th scope="row">{i === 0 ? r.role.name : ''}</th>
                      <td>{i === 0 ? r.role.originalPerformer : ''}</td>
                      <td>{s.pick}</td>
                      <td>{s.ballots}</td>
                      <td>{Math.round(s.share * 100)}%</td>
                      <td>{s.votes}</td>
                    </tr>
                  )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Scout portal: every UCast poll and its full results, live while open. */
export function ScoutUcast() {
  usePageTitle(`${UCAST_NAME} data · Scout portal`);
  const { user, loading } = useAuth();
  const [polls, setPolls] = useState<UcastPollSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  useEffect(() => {
    if (user?.scout?.status !== 'approved') return;
    apiGet<{ polls: UcastPollSummary[] }>('/api/ucast/scout')
      .then((d) => setPolls(d.polls))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load UCast data.'));
  }, [user?.scout?.status]);

  if (loading) return <Loading />;
  if (user?.scout?.status !== 'approved') {
    return (
      <div className="page page-narrow">
        <h1>UCast data</h1>
        <p>
          UCast polling results are part of the <Link to="/scout">Scout portal</Link>. Apply for scout access to see who audiences would cast in every poll, live while it runs and final when it closes.
        </p>
      </div>
    );
  }
  return (
    <div className="page">
      <h1>UCast data</h1>
      <p className="page-intro">
        Who audiences would cast, role by role, for every UCast poll: ballots per performer, share of ballots, and agreements from other members. Live while a poll is open, final when it closes. Each poll exports as CSV. <Link to="/scout">Back to the Scout portal</Link>.
      </p>
      {error && <ErrorNote message={error} />}
      {!polls && !error && <Loading label="Loading polls" />}
      {polls && polls.length === 0 && <p>No polls yet.</p>}
      {polls && polls.length > 0 && (
        <ul className="ucast-admin-list">
          {polls.map((p) => (
            <li key={p.id} className="ucast-admin-row">
              <div className="ucast-admin-row-head">
                <div>
                  <strong>{p.title}</strong> ({p.year}) · {UCAST_WORK_KIND_LABELS[p.kind]} · {UCAST_PHASE_LABELS[p.phase]} · {p.ballotCount} ballots · {p.roleCount} roles
                  {p.closesAt && ` · closes ${formatWhen(p.closesAt)}`}
                </div>
                <button type="button" className="button button-quiet" aria-expanded={openSlug === p.slug} onClick={() => setOpenSlug((s) => (s === p.slug ? null : p.slug))}>
                  {openSlug === p.slug ? 'Hide results' : 'Show results'}
                </button>
              </div>
              {openSlug === p.slug && <PollResults slug={p.slug} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
