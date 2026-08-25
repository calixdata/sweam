import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ScoutLeaderboards } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function Scout() {
  usePageTitle('Scout portal');
  const { user, refresh, loading } = useAuth();

  if (loading) return <Loading />;

  if (!user) {
    return (
      <div className="page page-narrow">
        <h1>Scout portal</h1>
        <p className="page-intro">
          For networks, studios, and aggregators: ranked momentum boards and per-title one-sheets
          for the creator work that is breaking out on Sweam. Access is by application, creators
          opt in per title, and every one-sheet view is visible to the creator.
        </p>
        <p>
          <Link to="/signin" state={{ from: '/scout' }}>
            Sign in
          </Link>{' '}
          to apply for scout access.
        </p>
      </div>
    );
  }

  if (!user.scout) return <ScoutApplication onApplied={refresh} />;

  if (user.scout.status === 'pending') {
    return (
      <div className="page page-narrow">
        <h1>Scout portal</h1>
        <p className="status" role="status">
          Your application for {user.scout.orgName} is pending review. You will have access to the
          boards once it is approved.
        </p>
      </div>
    );
  }

  return <ScoutBoards orgName={user.scout.orgName} />;
}

function ScoutApplication({ onApplied }: { onApplied: () => Promise<void> }) {
  const [orgName, setOrgName] = useState('');
  const [orgUrl, setOrgUrl] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/scout/apply', {
        orgName,
        orgUrl: orgUrl.trim() === '' ? null : orgUrl,
        contactEmail,
      });
      await onApplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the application.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page page-form">
      <h1>Apply for scout access</h1>
      <p className="page-intro">
        Scout accounts represent an organization looking for content and talent. Creators see your
        organization name whenever you open one of their one-sheets, and your contact email when
        you express interest.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="scout-org">Organization name</label>
          <input
            id="scout-org"
            type="text"
            required
            maxLength={120}
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="scout-url">Organization website (optional)</label>
          <input
            id="scout-url"
            type="url"
            placeholder="https://"
            maxLength={2048}
            value={orgUrl}
            onChange={(event) => setOrgUrl(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="scout-email">Contact email for creators</label>
          <input
            id="scout-email"
            type="email"
            required
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
      </form>
    </div>
  );
}

function ScoutBoards({ orgName }: { orgName: string }) {
  const [boards, setBoards] = useState<ScoutLeaderboards | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<ScoutLeaderboards>('/api/scout/leaderboards')
      .then((data) => {
        if (!cancelled) setBoards(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the boards.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!boards) return <Loading label="Loading the boards" />;

  return (
    <div className="page page-narrow">
      <h1>Scout portal</h1>
      <p className="page-intro">
        Signed in for {orgName}. Boards cover titles whose creators opted into scouting; recent
        means the last 7 days. Opening a one-sheet is logged and visible to the creator.
      </p>

      <section aria-labelledby="board-growth">
        <h2 id="board-growth">Fastest growing</h2>
        {boards.fastestGrowing.length === 0 ? (
          <p>Not enough recent activity yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">
                Titles ranked by week-over-week play growth weighted by volume
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Title</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Plays, recent 7 days</th>
                  <th scope="col">Prior 7 days</th>
                  <th scope="col">Growth</th>
                </tr>
              </thead>
              <tbody>
                {boards.fastestGrowing.map((entry, index) => (
                  <tr key={entry.title.id}>
                    <td>{index + 1}</td>
                    <th scope="row">
                      <Link to={`/scout/t/${entry.title.id}`}>{entry.title.name}</Link>
                    </th>
                    <td>@{entry.title.creator.handle}</td>
                    <td>{entry.recentPlays.toLocaleString()}</td>
                    <td>{entry.priorPlays.toLocaleString()}</td>
                    <td>{entry.growth}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="board-finish">
        <h2 id="board-finish">Finish-rate leaders</h2>
        {boards.finishLeaders.length === 0 ? (
          <p>No title has enough plays yet (the board needs 20 or more).</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">
                Titles ranked by smoothed completion rate, minimum 20 plays
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Title</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Plays</th>
                  <th scope="col">Finish rate</th>
                </tr>
              </thead>
              <tbody>
                {boards.finishLeaders.map((entry, index) => (
                  <tr key={entry.title.id}>
                    <td>{index + 1}</td>
                    <th scope="row">
                      <Link to={`/scout/t/${entry.title.id}`}>{entry.title.name}</Link>
                    </th>
                    <td>@{entry.title.creator.handle}</td>
                    <td>{entry.plays.toLocaleString()}</td>
                    <td>{Math.round(entry.finishRate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="board-genre">
        <h2 id="board-genre">Genre breakouts</h2>
        {boards.genreBreakouts.length === 0 ? (
          <p>Not enough recent activity yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">The current breakout title in each genre</caption>
              <thead>
                <tr>
                  <th scope="col">Genre</th>
                  <th scope="col">Title</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Plays, recent 7 days</th>
                  <th scope="col">Growth</th>
                </tr>
              </thead>
              <tbody>
                {boards.genreBreakouts.map((entry) => (
                  <tr key={entry.title.id}>
                    <td>{entry.genre}</td>
                    <th scope="row">
                      <Link to={`/scout/t/${entry.title.id}`}>{entry.title.name}</Link>
                    </th>
                    <td>@{entry.title.creator.handle}</td>
                    <td>{entry.recentPlays.toLocaleString()}</td>
                    <td>{entry.growth}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
