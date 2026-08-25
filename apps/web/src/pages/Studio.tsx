import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { StudioStanding, StudioTitleSummary } from '@sweam/shared';
import { ADVISORIES, CONTENT_KINDS, CONTENT_KIND_LABELS, GENRES } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function Studio() {
  usePageTitle('Studio');
  const { user, refresh } = useAuth();

  if (!user) {
    return (
      <div className="page page-narrow">
        <h1>Studio</h1>
        <p>
          <Link to="/signin" state={{ from: '/studio' }}>
            Sign in
          </Link>{' '}
          to publish on Sweam.
        </p>
      </div>
    );
  }

  if (!user.handle) {
    return <CreatorOnboarding onCreated={refresh} />;
  }

  return <StudioDashboard handle={user.handle} />;
}

function CreatorOnboarding({ onCreated }: { onCreated: () => Promise<void> }) {
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/studio/profile', { handle, bio });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your creator profile.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page page-form">
      <h1>Become a creator</h1>
      <p className="page-intro">
        Pick a handle and you can publish films, series, shorts, and documentaries. Your work
        competes in Discover on finish rate, not follower count.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="creator-handle">Handle</label>
          <input
            id="creator-handle"
            type="text"
            required
            pattern="[A-Za-z0-9_]{3,24}"
            aria-describedby="creator-handle-hint"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
          <p className="field-hint" id="creator-handle-hint">
            3-24 characters: letters, numbers, underscores.
          </p>
        </div>
        <div className="field">
          <label htmlFor="creator-bio">Bio (optional)</label>
          <textarea
            id="creator-bio"
            rows={3}
            maxLength={500}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create creator profile'}
        </button>
      </form>
    </div>
  );
}

function StudioDashboard({ handle }: { handle: string }) {
  const [titles, setTitles] = useState<StudioTitleSummary[] | null>(null);
  const [standing, setStanding] = useState<StudioStanding | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [titleData, standingData] = await Promise.all([
        apiGet<{ titles: StudioTitleSummary[] }>('/api/studio/titles'),
        apiGet<StudioStanding>('/api/studio/standing'),
      ]);
      setTitles(titleData.titles);
      setStanding(standingData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your titles.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!titles || !standing) return <Loading label="Loading your Studio" />;

  return (
    <div className="page page-narrow">
      <h1>Studio</h1>
      <p className="page-intro">Signed in as @{handle}.</p>

      {(standing.suspended || standing.activeStrikes > 0 || standing.takedowns.length > 0) && (
        <section aria-labelledby="standing-heading">
          <h2 id="standing-heading">Account standing</h2>
          {standing.suspended ? (
            <p className="status status-error" role="alert">
              Publishing, uploads, and new titles are suspended: {standing.activeStrikes} active
              strikes on your account. Check your notifications for the details of each strike.
            </p>
          ) : (
            standing.activeStrikes > 0 && (
              <p className="status" role="status">
                {standing.activeStrikes} active strike{standing.activeStrikes === 1 ? '' : 's'} on
                your account. Three active strikes suspend publishing.
              </p>
            )
          )}
          {standing.takedowns.length > 0 && (
            <ul>
              {standing.takedowns.map((takedown) => (
                <li key={`${takedown.titleName}-${takedown.createdAt}`}>
                  {takedown.titleName}: removed under{' '}
                  {takedown.kind === 'dmca' ? 'a DMCA takedown' : 'community guidelines'} on{' '}
                  {takedown.createdAt.slice(0, 10)}. It cannot be republished until released.
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <NewTitleForm onCreated={load} />

      <section aria-labelledby="studio-titles-heading">
        <h2 id="studio-titles-heading">Your titles</h2>
        {titles.length === 0 ? (
          <p>No titles yet. Create one above, add episodes, then publish.</p>
        ) : (
          <table className="studio-table">
            <caption className="visually-hidden">
              Your titles with status and performance counters
            </caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Kind</th>
                <th scope="col">Status</th>
                <th scope="col">Episodes</th>
                <th scope="col">Plays</th>
                <th scope="col">Finishes</th>
                <th scope="col">Likes</th>
              </tr>
            </thead>
            <tbody>
              {titles.map((title) => (
                <tr key={title.id}>
                  <th scope="row">
                    <Link to={`/studio/t/${title.id}`}>{title.name}</Link>
                  </th>
                  <td>{CONTENT_KIND_LABELS[title.kind]}</td>
                  <td>{title.published ? 'Published' : 'Draft'}</td>
                  <td>{title.episodeCount}</td>
                  <td>{title.stats.plays.toLocaleString()}</td>
                  <td>{title.stats.completes.toLocaleString()}</td>
                  <td>{title.stats.likes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function NewTitleForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('film');
  const [genre, setGenre] = useState<string>(GENRES[0]);
  const [advisory, setAdvisory] = useState<string>('TV-PG');
  const [synopsis, setSynopsis] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdMessage, setCreatedMessage] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/studio/titles', { name, kind, genre, advisory, synopsis });
      setCreatedMessage(`Created “${name}” as a draft. Open it below to add episodes.`);
      setName('');
      setSynopsis('');
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the title.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="new-title-heading">
      <h2 id="new-title-heading">New title</h2>
      <form onSubmit={handleSubmit} noValidate className="studio-form">
        <div className="field">
          <label htmlFor="new-title-name">Name</label>
          <input
            id="new-title-name"
            type="text"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="new-title-kind">Kind</label>
            <select id="new-title-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              {CONTENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {CONTENT_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-title-genre">Genre</label>
            <select id="new-title-genre" value={genre} onChange={(event) => setGenre(event.target.value)}>
              {GENRES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-title-advisory">Advisory</label>
            <select
              id="new-title-advisory"
              value={advisory}
              onChange={(event) => setAdvisory(event.target.value)}
            >
              {ADVISORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="new-title-synopsis">Synopsis</label>
          <textarea
            id="new-title-synopsis"
            rows={3}
            maxLength={2000}
            value={synopsis}
            onChange={(event) => setSynopsis(event.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        {createdMessage && (
          <p className="status" role="status">
            {createdMessage}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting || name.trim() === ''}>
          {submitting ? 'Creating…' : 'Create draft'}
        </button>
      </form>
    </section>
  );
}
