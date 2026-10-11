import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AdminUcastPoll, UcastWorkKind } from '@sweam/shared';
import { UCAST_DEFAULT_WINDOW_DAYS, UCAST_MAX_ROLES, UCAST_PHASE_LABELS, UCAST_WORK_KINDS, UCAST_WORK_KIND_LABELS } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { AdminNav } from '../components/AdminNav';
import { ErrorNote, Loading } from '../components/Status';
import { formatWhen } from '../components/UcastShell';
import { UcastCoverField as CoverField } from '../components/UcastCoverField';
import { usePageTitle } from '../hooks';

/** Roles as "Name - Original" lines for a textarea, and back. */
function rolesToText(roles: { name: string; originalPerformer: string }[]): string {
  return roles.map((r) => (r.originalPerformer ? `${r.name} - ${r.originalPerformer}` : r.name)).join('\n');
}
function textToRoles(text: string): { name: string; originalPerformer: string }[] {
  const out: { name: string; originalPerformer: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.search(/\s[-–—]\s/);
    const name = (i === -1 ? line : line.slice(0, i)).trim().slice(0, 80);
    const originalPerformer = (i === -1 ? '' : line.slice(i + 3)).trim().slice(0, 80);
    if (name) out.push({ name, originalPerformer });
    if (out.length >= UCAST_MAX_ROLES) break;
  }
  return out;
}
/** ISO instant to the value a datetime-local input wants (local time, minutes). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultClose(): string {
  const d = new Date(Date.now() + UCAST_DEFAULT_WINDOW_DAYS * 86_400_000);
  d.setHours(23, 59, 0, 0);
  return toLocalInput(d.toISOString());
}

/** One pending request with everything the admin sets before opening it. */
function RequestCard({ poll, onDone }: { poll: AdminUcastPoll; onDone: (msg: string) => void }) {
  const [roles, setRoles] = useState(rolesToText(poll.roles));
  const [closesAt, setClosesAt] = useState(defaultClose());
  const [opensAt, setOpensAt] = useState('');
  const [hook, setHook] = useState(poll.hook);
  const [cover, setCover] = useState<string | null>(poll.coverUrl);
  const [adminNote, setAdminNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setErr(null);
    if (!approve && !window.confirm(`Reject the request for ${poll.title} (${poll.year})? The member is notified with your note.`)) return;
    setBusy(true);
    try {
      await apiSend('POST', `/api/admin/ucast/${poll.id}/decide`, approve
        ? { approve: true, roles: textToRoles(roles), closesAt: new Date(closesAt).toISOString(), opensAt: opensAt ? new Date(opensAt).toISOString() : undefined, hook, coverUrl: cover, adminNote }
        : { approve: false, adminNote });
      onDone(`${approve ? 'Opened' : 'Rejected'} ${poll.title} (${poll.year}).`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="ucast-admin-card">
      <h3>
        {poll.title} ({poll.year}) · {UCAST_WORK_KIND_LABELS[poll.kind]}
      </h3>
      <p className="field-hint">
        Requested by {poll.requester.username ? <Link to={`/c/${poll.requester.username}`}>@{poll.requester.username}</Link> : poll.requester.displayName} on {formatWhen(poll.createdAt)}.
      </p>
      <p>
        <strong>Duplicate check:</strong> {poll.dedupeNote || 'none recorded'}
      </p>
      {poll.requesterNote && (
        <p>
          <strong>Member&apos;s note:</strong> {poll.requesterNote}
        </p>
      )}
      <div className="field">
        <label htmlFor={`hook-${poll.id}`}>One-liner shown on the poll</label>
        <input id={`hook-${poll.id}`} value={hook} maxLength={300} onChange={(e) => setHook(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`roles-${poll.id}`}>Roles, one per line as "Role - original performer" (required to open)</label>
        <textarea id={`roles-${poll.id}`} rows={6} value={roles} onChange={(e) => setRoles(e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`opens-${poll.id}`}>Opens (blank = now)</label>
          <input id={`opens-${poll.id}`} type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`closes-${poll.id}`}>Closes (polling window end)</label>
          <input id={`closes-${poll.id}`} type="datetime-local" value={closesAt} required onChange={(e) => setClosesAt(e.target.value)} />
          <p className="field-hint">Results are due within 48 hours after this.</p>
        </div>
      </div>
      <CoverField id={`cover-${poll.id}`} value={cover} onChange={setCover} />
      <div className="field">
        <label htmlFor={`note-${poll.id}`}>Note to the member (sent with either decision)</label>
        <input id={`note-${poll.id}`} value={adminNote} maxLength={1000} onChange={(e) => setAdminNote(e.target.value)} />
      </div>
      {err && <ErrorNote message={err} />}
      <div className="ucast-actions">
        <button type="button" className="button" disabled={busy} onClick={() => decide(true)}>
          Open this poll
        </button>
        <button type="button" className="button button-quiet" disabled={busy} onClick={() => decide(false)}>
          Reject
        </button>
      </div>
    </li>
  );
}

/** An opened poll: adjust the window, cover, roles; close now; post results. */
function PollRow({ poll, onDone }: { poll: AdminUcastPoll; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [closesAt, setClosesAt] = useState(toLocalInput(poll.closesAt));
  const [hook, setHook] = useState(poll.hook);
  const [roles, setRoles] = useState(rolesToText(poll.roles));
  const [cover, setCover] = useState<string | null>(poll.coverUrl);
  const [coverSaving, setCoverSaving] = useState(false);
  const [resultsNote, setResultsNote] = useState(poll.resultsNote);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** A cover change saves on its own; no need to open the editor or press Save. */
  async function saveCover(url: string | null) {
    setCover(url);
    setCoverSaving(true);
    setErr(null);
    try {
      await apiSend('PATCH', `/api/admin/ucast/${poll.id}`, { coverUrl: url });
      onDone(`${url ? 'Cover set' : 'Cover removed'}: ${poll.title} (${poll.year}).`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save the cover.');
    } finally {
      setCoverSaving(false);
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      onDone(`${label}: ${poll.title} (${poll.year}).`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="ucast-admin-row">
      <div className="ucast-admin-row-head">
        <div>
          <Link to={`/ucast/p/${poll.slug}`} aria-label={`${poll.title} (${poll.year}), open the poll page`}>
            <strong>{poll.title}</strong> ({poll.year})
          </Link>{' '}
          · {UCAST_WORK_KIND_LABELS[poll.kind]} · {UCAST_PHASE_LABELS[poll.phase]}
          {poll.closesAt && ` · closes ${formatWhen(poll.closesAt)}`} · {poll.ballotCount} ballots · {poll.roles.length} roles
          {poll.resultsAt && ` · results posted ${formatWhen(poll.resultsAt)}`}
        </div>
        <button type="button" className="button button-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close editor' : 'Edit window, roles or results'}
        </button>
      </div>
      <CoverField id={`pcover-${poll.id}`} value={cover} onChange={saveCover} saving={coverSaving} />
      {err && !open && <ErrorNote message={err} />}
      {open && (
        <div className="ucast-admin-editor">
          <div className="field-row">
            <div className="field">
              <label htmlFor={`pclose-${poll.id}`}>Closes</label>
              <input id={`pclose-${poll.id}`} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`phook-${poll.id}`}>One-liner</label>
              <input id={`phook-${poll.id}`} value={hook} maxLength={300} onChange={(e) => setHook(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`proles-${poll.id}`}>Roles (renaming keeps ballots; removing a role drops its picks)</label>
            <textarea id={`proles-${poll.id}`} rows={5} value={roles} onChange={(e) => setRoles(e.target.value)} />
          </div>
          {err && <ErrorNote message={err} />}
          <div className="ucast-actions">
            <button type="button" className="button" disabled={busy} onClick={() => run('Saved', () => apiSend('PATCH', `/api/admin/ucast/${poll.id}`, { closesAt: closesAt ? new Date(closesAt).toISOString() : undefined, hook, roles: textToRoles(roles) }))}>
              Save changes
            </button>
            {poll.phase === 'open' && (
              <button type="button" className="button button-quiet" disabled={busy} onClick={() => window.confirm('Close this poll now? Casting stops immediately.') && run('Closed', () => apiSend('PATCH', `/api/admin/ucast/${poll.id}`, { closeNow: true }))}>
                Close now
              </button>
            )}
          </div>
          {(poll.phase === 'closed' || poll.phase === 'results') && (
            <div className="ucast-admin-results">
              <div className="field">
                <label htmlFor={`pres-${poll.id}`}>Results note (shown above the results)</label>
                <textarea id={`pres-${poll.id}`} rows={3} maxLength={2000} value={resultsNote} onChange={(e) => setResultsNote(e.target.value)} />
              </div>
              <button type="button" className="button" disabled={busy} onClick={() => run(poll.resultsAt ? 'Results updated' : 'Results posted', () => apiSend('POST', `/api/admin/ucast/${poll.id}/results`, { resultsNote }))}>
                {poll.resultsAt ? 'Update results note' : 'Post results now'}
              </button>
              {!poll.resultsAt && poll.resultsDueAt && <p className="field-hint">Otherwise results go public automatically at {formatWhen(poll.resultsDueAt)}.</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Open a poll directly as @ucast. */
function NewPollForm({ onDone }: { onDone: (msg: string) => void }) {
  const [kind, setKind] = useState<UcastWorkKind>('film');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [hook, setHook] = useState('');
  const [roles, setRoles] = useState('');
  const [closesAt, setClosesAt] = useState(defaultClose());
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await apiSend('POST', '/api/admin/ucast', { kind, title, year: Number(year), hook, roles: textToRoles(roles), closesAt: new Date(closesAt).toISOString(), coverUrl: cover, asHost: true });
      onDone(`Opened ${title} (${year}) as @ucast.`);
      setTitle('');
      setYear('');
      setHook('');
      setRoles('');
      setCover(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not open the poll.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="studio-form ucast-form" onSubmit={submit}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="np-kind">Kind</label>
          <select id="np-kind" value={kind} onChange={(e) => setKind(e.target.value as UcastWorkKind)}>
            {UCAST_WORK_KINDS.map((k) => (
              <option key={k} value={k}>
                {UCAST_WORK_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="np-title">Title</label>
          <input id="np-title" value={title} required maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="np-year">Year</label>
          <input id="np-year" type="number" required value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="np-close">Closes</label>
          <input id="np-close" type="datetime-local" required value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="np-hook">One-liner</label>
        <input id="np-hook" value={hook} maxLength={300} onChange={(e) => setHook(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="np-roles">Roles, one per line as "Role - original performer"</label>
        <textarea id="np-roles" rows={5} required value={roles} onChange={(e) => setRoles(e.target.value)} />
      </div>
      <CoverField id="np-cover" value={cover} onChange={setCover} />
      {err && <ErrorNote message={err} />}
      <button type="submit" className="button" disabled={busy}>
        Open poll as @ucast
      </button>
    </form>
  );
}

export function AdminUcast() {
  usePageTitle('UCast admin');
  const { user, loading } = useAuth();
  const [polls, setPolls] = useState<AdminUcastPoll[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setPolls((await apiGet<{ polls: AdminUcastPoll[] }>('/api/admin/ucast')).polls);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load UCast.');
    }
  }, []);
  useEffect(() => {
    if (user?.isAdmin) void load();
  }, [load, user?.isAdmin]);

  if (loading) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>UCast</h1>
        <p>This area is for Sweam administrators.</p>
      </div>
    );
  }
  function done(msg: string) {
    setNotice(msg);
    void load();
  }
  const pending = polls?.filter((p) => p.status === 'pending') ?? [];
  const live = polls?.filter((p) => p.status === 'open' || p.status === 'closed') ?? [];
  const groups: { id: string; title: string; hint: string; items: AdminUcastPoll[] }[] = [
    { id: 'au-open', title: 'Open for casting', hint: 'Edit the window or roles, add a cover, or close early.', items: live.filter((p) => p.phase === 'open' || p.phase === 'scheduled') },
    { id: 'au-closed', title: 'Closed, results due', hint: 'Post results with a note; otherwise they go public automatically 48 hours after closing.', items: live.filter((p) => p.phase === 'closed') },
    { id: 'au-results', title: 'Results posted', hint: 'Done. The results note can still be edited.', items: live.filter((p) => p.phase === 'results') },
  ];
  const rejected = polls?.filter((p) => p.status === 'rejected') ?? [];

  return (
    <div className="page">
      <h1>UCast</h1>
      <AdminNav />
      <p className="page-intro">
        Everything UCast lives on this tab and nowhere else in the console: requests to review, open polls to tend, closed polls awaiting results, and opening a poll as @ucast.
      </p>
      {notice && (
        <p className="status status-ok" role="status">
          {notice}
        </p>
      )}
      {error && <ErrorNote message={error} />}
      {!polls && !error && <Loading label="Loading UCast" />}
      {polls && (
        <>
          <section aria-labelledby="au-requests">
            <h2 id="au-requests">Requests awaiting review ({pending.length})</h2>
            <p className="field-hint">Nothing opens for polling until you open it here. Set the roles and the window; the duplicate check result is shown for each request.</p>
            {pending.length === 0 ? <p className="ucast-empty">No requests waiting.</p> : <ul className="ucast-admin-list">{pending.map((p) => <RequestCard key={p.id} poll={p} onDone={done} />)}</ul>}
          </section>
          {groups.map((g) => (
            <section key={g.id} aria-labelledby={g.id}>
              <h2 id={g.id}>
                {g.title} ({g.items.length})
              </h2>
              <p className="field-hint">{g.hint}</p>
              {g.items.length === 0 ? (
                <p className="ucast-empty">None.</p>
              ) : (
                <ul className="ucast-admin-list">
                  {g.items.map((p) => (
                    <PollRow key={p.id} poll={p} onDone={done} />
                  ))}
                </ul>
              )}
            </section>
          ))}
          <section aria-labelledby="au-new">
            <h2 id="au-new">Open a poll as @ucast</h2>
            <NewPollForm onDone={done} />
          </section>
          {rejected.length > 0 && (
            <section aria-labelledby="au-rejected">
              <h2 id="au-rejected">Rejected ({rejected.length})</h2>
              <ul className="ucast-request-list">
                {rejected.map((p) => (
                  <li key={p.id}>
                    {p.title} ({p.year}) · @{p.requester.username} · {p.adminNote || 'no note'}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
