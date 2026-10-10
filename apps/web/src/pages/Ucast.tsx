import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { UcastBoard, UcastWorkKind, UcastWorkSummary } from '@sweam/shared';
import {
  UCAST_DISCLAIMER,
  UCAST_HANDLE,
  UCAST_MIN_WORK_AGE_YEARS,
  UCAST_NAME,
  UCAST_WORK_KINDS,
  UCAST_WORK_KIND_LABELS,
} from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { usePageTitle } from '../hooks';

/** One work on the board. */
function WorkCard({ work }: { work: UcastWorkSummary }) {
  return (
    <li className="ucast-card">
      <Link to={`/ucast/w/${work.slug}`} className="ucast-card-link">
        <span className="ucast-card-kind">
          {UCAST_WORK_KIND_LABELS[work.kind]}
          {work.official ? ' · Open call' : ''}
        </span>
        <span className="ucast-card-title">
          {work.title} <span className="ucast-card-year">({work.year})</span>
        </span>
        {work.hook && <span className="ucast-card-hook">{work.hook}</span>}
        <span className="ucast-card-meta">
          {work.recastCount === 0
            ? 'No recasts yet. Be first.'
            : `${work.recastCount} ${work.recastCount === 1 ? 'recast' : 'recasts'}`}
        </span>
      </Link>
    </li>
  );
}

export function Ucast() {
  usePageTitle(UCAST_NAME);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [board, setBoard] = useState<UcastBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<UcastWorkKind | ''>('');

  const [newKind, setNewKind] = useState<UcastWorkKind>('film');
  const [newTitle, setNewTitle] = useState('');
  const [newYear, setNewYear] = useState('');
  const [newHook, setNewHook] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBoard(null);
    apiGet<UcastBoard>(kind ? `/api/ucast?kind=${kind}` : '/api/ucast')
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load UCast.');
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  async function openWork(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const year = Number(newYear);
    if (!Number.isInteger(year)) {
      setFormError('Enter the year the original came out.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiSend<{ work: UcastWorkSummary; created: boolean }>('POST', '/api/ucast/works', {
        kind: newKind,
        title: newTitle,
        year,
        hook: newHook,
      });
      navigate(`/ucast/w/${data.work.slug}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not open that work.');
    } finally {
      setBusy(false);
    }
  }

  const latestYear = new Date().getFullYear() - UCAST_MIN_WORK_AGE_YEARS;

  return (
    <div className="page">
      <section className="ucast-hero">
        <h1>{UCAST_NAME}</h1>
        <p className="page-intro">
          The recasting room. Take a film, TV series, song, musical or music video from {latestYear} or
          earlier and name who you would cast in every role for a remake or rendition today. Vote on the
          picks you agree with. The room is hosted by{' '}
          <Link to={`/c/${UCAST_HANDLE}`}>
            @{UCAST_HANDLE} <VerifiedBadge />
          </Link>
          , Sweam&apos;s own account, which posts the open calls.
        </p>
        <p className="ucast-disclaimer" role="note">
          {UCAST_DISCLAIMER}
        </p>
      </section>

      <section aria-labelledby="ucast-open-heading">
        <div className="field ucast-filter">
          <label htmlFor="ucast-kind-filter">Show</label>
          <select
            id="ucast-kind-filter"
            value={kind}
            onChange={(event) => setKind(event.target.value as UcastWorkKind | '')}
          >
            <option value="">Everything</option>
            {UCAST_WORK_KINDS.map((k) => (
              <option key={k} value={k}>
                {UCAST_WORK_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <h2 id="ucast-open-heading">Open calls from @{UCAST_HANDLE}</h2>
        {error && <ErrorNote message={error} />}
        {!error && !board && <Loading label="Loading the room" />}
        {board && board.openCalls.length === 0 && <p>No open calls in this lane yet.</p>}
        {board && board.openCalls.length > 0 && (
          <ul className="ucast-grid">
            {board.openCalls.map((work) => (
              <WorkCard key={work.id} work={work} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ucast-new-heading">
        <h2 id="ucast-new-heading">Open a work of your own</h2>
        {user ? (
          <form className="studio-form ucast-form" onSubmit={openWork}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="ucast-new-kind">What is it?</label>
                <select
                  id="ucast-new-kind"
                  value={newKind}
                  onChange={(event) => setNewKind(event.target.value as UcastWorkKind)}
                >
                  {UCAST_WORK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {UCAST_WORK_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ucast-new-title">Title of the original</label>
                <input
                  id="ucast-new-title"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  maxLength={120}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="ucast-new-year">Year it came out</label>
                <input
                  id="ucast-new-year"
                  inputMode="numeric"
                  value={newYear}
                  onChange={(event) => setNewYear(event.target.value)}
                  min={1900}
                  max={latestYear}
                  type="number"
                  required
                />
                <p className="field-hint">{latestYear} or earlier.</p>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ucast-new-hook">Why recast it? (one line, optional)</label>
              <input
                id="ucast-new-hook"
                value={newHook}
                onChange={(event) => setNewHook(event.target.value)}
                maxLength={300}
              />
            </div>
            {formError && <p className="status status-error" role="alert">{formError}</p>}
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Opening…' : 'Open it and cast it'}
            </button>
            <p className="field-hint">
              If someone already opened this title, you land on their board and add your cast there.
            </p>
          </form>
        ) : (
          <p>
            <Link to="/signin">Sign in</Link> or <Link to="/signup">join Sweam</Link> to open a work and post
            your cast. Browsing is open to everyone.
          </p>
        )}
      </section>

      <section aria-labelledby="ucast-all-heading">
        <h2 id="ucast-all-heading">Everything in the room</h2>
        {board && board.works.length === 0 && <p>Nothing here yet.</p>}
        {board && board.works.length > 0 && (
          <ul className="ucast-grid">
            {board.works.map((work) => (
              <WorkCard key={work.id} work={work} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
