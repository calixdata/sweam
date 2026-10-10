import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { UcastDuplicateCheck, UcastMyRequest, UcastWorkKind } from '@sweam/shared';
import { UCAST_MAX_ROLES, UCAST_MIN_WORK_AGE_YEARS, UCAST_NAME, UCAST_PHASE_LABELS, UCAST_WORK_KINDS, UCAST_WORK_KIND_LABELS } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote } from '../components/Status';
import { UcastShell, formatDay } from '../components/UcastShell';
import { usePageTitle } from '../hooks';

/** "Role - Original performer" lines into role objects; mirrors the API's parser. */
function parseRoles(text: string): { name: string; originalPerformer: string }[] {
  const out: { name: string; originalPerformer: string }[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(.*?)\s*(?:[-–—:]\s*|\()\s*([^()]*?)\)?\s*$/.exec(line);
    const name = (match && match[2] ? (match[1] ?? line) : line).trim().slice(0, 80);
    const originalPerformer = (match && match[2] ? match[2] : '').trim().slice(0, 80);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, originalPerformer });
    if (out.length >= UCAST_MAX_ROLES) break;
  }
  return out;
}

export function UcastRequest() {
  usePageTitle(`Request a poll · ${UCAST_NAME}`);
  const { user } = useAuth();
  const [kind, setKind] = useState<UcastWorkKind>('film');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [hook, setHook] = useState('');
  const [rolesText, setRolesText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<UcastDuplicateCheck | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [mine, setMine] = useState<UcastMyRequest[] | null>(null);

  const latestYear = new Date().getFullYear() - UCAST_MIN_WORK_AGE_YEARS;

  const loadMine = useCallback(async () => {
    if (!user) return;
    try {
      setMine((await apiGet<{ requests: UcastMyRequest[] }>('/api/ucast/requests/mine')).requests);
    } catch {
      setMine([]);
    }
  }, [user]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  async function send(confirmDifferent: boolean) {
    setError(null);
    const y = Number(year);
    if (!Number.isInteger(y)) {
      setError('Enter the year the original came out.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ slug: string }>('POST', '/api/ucast/requests', {
        kind,
        title,
        year: y,
        hook,
        note,
        roles: parseRoles(rolesText),
        confirmDifferent,
      });
      setSent(res.slug);
      setCheck(null);
      setTitle('');
      setYear('');
      setHook('');
      setRolesText('');
      setNote('');
      await loadMine();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'possible_duplicate') {
        // The API attaches the candidates; fetch them explicitly so the UI can show them.
        try {
          setCheck(await apiSend<UcastDuplicateCheck>('POST', '/api/ucast/requests/check', { kind, title, year: y }));
        } catch {
          setCheck({ method: 'fuzzy', candidates: [] });
        }
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not send your request.');
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(false);
  }

  return (
    <UcastShell>
      <section aria-labelledby="ucast-request-heading" className="ucast-section">
        <h2 id="ucast-request-heading">Request a poll</h2>
        <p className="page-intro">
          Tell UCast which classic you want recast. Every request is checked for duplicates (the room already has a lot of titles) and reviewed by a UCast admin, who sets the roles and the polling window before it opens. You are notified either way.
        </p>
        {!user && (
          <p>
            <Link to="/signin" state={{ from: '/ucast/request' }}>
              Sign in
            </Link>{' '}
            to request a poll.
          </p>
        )}
        {sent && (
          <p className="status status-ok" role="status">
            Request sent. It appears under your requests below while UCast reviews it.
          </p>
        )}
        {user && (
          <form className="studio-form ucast-form" onSubmit={onSubmit}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="req-kind">What kind of work is it?</label>
                <select id="req-kind" value={kind} onChange={(e) => setKind(e.target.value as UcastWorkKind)}>
                  {UCAST_WORK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {UCAST_WORK_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="req-title">Title of the original</label>
                <input id="req-title" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="req-year">Year it came out</label>
                <input id="req-year" type="number" inputMode="numeric" min={1900} max={latestYear} required value={year} onChange={(e) => setYear(e.target.value)} />
                <p className="field-hint">{latestYear} or earlier: UCast is for classics.</p>
              </div>
            </div>
            <div className="field">
              <label htmlFor="req-hook">Why recast it? One line (optional)</label>
              <input id="req-hook" value={hook} maxLength={300} onChange={(e) => setHook(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="req-roles">Roles to cast, one per line (optional; the admin can edit these)</label>
              <textarea id="req-roles" rows={5} value={rolesText} onChange={(e) => setRolesText(e.target.value)} placeholder={'Audrey - Ellen Greene\nSeymour Krelborn - Rick Moranis'} />
              <p className="field-hint">Write "Role - original performer". Up to {UCAST_MAX_ROLES} roles.</p>
            </div>
            <div className="field">
              <label htmlFor="req-note">Anything else for the reviewer (optional)</label>
              <textarea id="req-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && <ErrorNote message={error} />}
            {check && (
              <div className="notice notice-warn" role="region" aria-label="Possible duplicates">
                <strong>Already in UCast?</strong>
                {check.candidates.length === 0 ? (
                  <p>The check could not list the matches. If you are sure this is a different work, send it anyway.</p>
                ) : (
                  <ul>
                    {check.candidates.map((cand) => (
                      <li key={cand.slug}>
                        <Link to={`/ucast/p/${cand.slug}`}>
                          {cand.title} ({cand.year}), {UCAST_WORK_KIND_LABELS[cand.kind]}
                        </Link>{' '}
                        · {UCAST_PHASE_LABELS[cand.phase]} · {cand.reason} ({Math.round(cand.confidence * 100)}% match{check.method === 'ai' ? ', AI check' : ''})
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="button button-quiet" disabled={busy} onClick={() => send(true)}>
                  It is a different work, send my request anyway
                </button>
              </div>
            )}
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Checking…' : 'Check for duplicates and send'}
            </button>
          </form>
        )}
      </section>

      {user && (
        <section aria-labelledby="ucast-mine-heading" className="ucast-section">
          <h2 id="ucast-mine-heading">Your requests</h2>
          {mine === null && <p className="ucast-empty">Loading…</p>}
          {mine && mine.length === 0 && <p className="ucast-empty">You have not requested a poll yet.</p>}
          {mine && mine.length > 0 && (
            <ul className="ucast-request-list">
              {mine.map((r) => (
                <li key={r.id}>
                  <Link to={`/ucast/p/${r.slug}`}>
                    {r.title} ({r.year})
                  </Link>{' '}
                  · {UCAST_WORK_KIND_LABELS[r.kind]} · {UCAST_PHASE_LABELS[r.phase]} · requested {formatDay(r.createdAt)}
                  {r.adminNote && <span className="ucast-pick-note"> · UCast says: {r.adminNote}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </UcastShell>
  );
}
