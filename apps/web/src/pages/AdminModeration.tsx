import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AdminReport, AdminStrike, AdminTakedown } from '@sweam/shared';
import { REPORT_REASON_LABELS } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function AdminModeration() {
  usePageTitle('Moderation');
  const { user, loading } = useAuth();

  if (loading) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>Moderation</h1>
        <p>This area is for Sweam administrators.</p>
      </div>
    );
  }
  return <ModerationQueue />;
}

function ModerationQueue() {
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [takedowns, setTakedowns] = useState<AdminTakedown[] | null>(null);
  const [strikes, setStrikes] = useState<AdminStrike[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [reportData, takedownData, strikeData] = await Promise.all([
        apiGet<{ reports: AdminReport[] }>('/api/admin/reports'),
        apiGet<{ takedowns: AdminTakedown[] }>('/api/admin/takedowns'),
        apiGet<{ strikes: AdminStrike[] }>('/api/admin/strikes'),
      ]);
      setReports(reportData.reports);
      setTakedowns(takedownData.takedowns);
      setStrikes(strikeData.strikes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the moderation queue.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!reports || !takedowns || !strikes) return <Loading label="Loading the moderation queue" />;

  return (
    <div className="page page-narrow">
      <p>
        <Link to="/admin">Back to Admin</Link>
      </p>
      <h1>Moderation</h1>

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}

      <section aria-labelledby="mod-reports">
        <h2 id="mod-reports">Open reports</h2>
        {reports.length === 0 ? (
          <p>The queue is empty.</p>
        ) : (
          <ul className="interest-list">
            {reports.map((report) => (
              <li key={report.id}>
                <h3>
                  {REPORT_REASON_LABELS[report.reason]}: <Link to={`/t/${report.title.slug}`}>{report.title.name}</Link>
                </h3>
                <p>
                  By @{report.creator.handle} ({report.creator.activeStrikes} active strike
                  {report.creator.activeStrikes === 1 ? '' : 's'}) · reported by{' '}
                  {report.reporter.displayName} on {report.createdAt.slice(0, 10)} ·{' '}
                  {report.title.published ? 'currently published' : 'currently unpublished'}
                </p>
                {report.note && <blockquote>{report.note}</blockquote>}
                <ResolveForm
                  report={report}
                  onResolved={async (message) => {
                    setNotice(message);
                    await load();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mod-takedowns">
        <h2 id="mod-takedowns">Active takedowns</h2>
        {takedowns.length === 0 ? (
          <p>No active takedowns.</p>
        ) : (
          <ul className="interest-list">
            {takedowns.map((takedown) => (
              <li key={takedown.id}>
                <h3>
                  {takedown.kind === 'dmca' ? 'DMCA' : 'Guidelines'}: {takedown.title.name}
                </h3>
                <p>
                  By @{takedown.creatorHandle} · issued {takedown.createdAt.slice(0, 10)}
                </p>
                <blockquote>{takedown.reason}</blockquote>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={async () => {
                    await apiSend('POST', `/api/admin/takedowns/${takedown.id}/release`);
                    setNotice(`Released the takedown on ${takedown.title.name}.`);
                    await load();
                  }}
                >
                  Release takedown
                </button>
              </li>
            ))}
          </ul>
        )}
        <DirectTakedownForm
          onDone={async (message) => {
            setNotice(message);
            await load();
          }}
        />
      </section>

      <section aria-labelledby="mod-strikes">
        <h2 id="mod-strikes">Active strikes</h2>
        {strikes.length === 0 ? (
          <p>No active strikes.</p>
        ) : (
          <ul className="interest-list">
            {strikes.map((strike) => (
              <li key={strike.id}>
                <h3>
                  @{strike.creator.handle} ({strike.creator.displayName})
                </h3>
                <p>{strike.createdAt.slice(0, 10)}</p>
                <blockquote>{strike.reason}</blockquote>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={async () => {
                    await apiSend('POST', `/api/admin/strikes/${strike.id}/revoke`);
                    setNotice(`Revoked a strike for @${strike.creator.handle}.`);
                    await load();
                  }}
                >
                  Revoke strike
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ResolveForm({
  report,
  onResolved,
}: {
  report: AdminReport;
  onResolved: (message: string) => Promise<void>;
}) {
  const [action, setAction] = useState('dismiss');
  const [kind, setKind] = useState('guidelines');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const needsKind = action.includes('takedown');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', `/api/admin/reports/${report.id}/resolve`, {
        action,
        kind: needsKind ? kind : undefined,
        note,
      });
      await onResolved(`Report on ${report.title.name} resolved (${action.replaceAll('_', ' ')}).`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resolve the report.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="resolve-form">
      <div className="field-row">
        <div className="field">
          <label htmlFor={`action-${report.id}`}>Action</label>
          <select
            id={`action-${report.id}`}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="dismiss">Dismiss</option>
            <option value="takedown">Take down title</option>
            <option value="strike">Strike creator</option>
            <option value="takedown_and_strike">Take down and strike</option>
          </select>
        </div>
        {needsKind && (
          <div className="field">
            <label htmlFor={`kind-${report.id}`}>Takedown kind</label>
            <select
              id={`kind-${report.id}`}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="guidelines">Community guidelines</option>
              <option value="dmca">DMCA</option>
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`note-${report.id}`}>Note (shared with the creator)</label>
          <input
            id={`note-${report.id}`}
            type="text"
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </div>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={submitting}>
        {submitting ? 'Resolving…' : 'Resolve report'}
      </button>
    </form>
  );
}

function DirectTakedownForm({ onDone }: { onDone: (message: string) => Promise<void> }) {
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState('dmca');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/admin/takedowns', { slug, kind, reason });
      setSlug('');
      setReason('');
      await onDone(`Takedown issued for ${slug}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Takedown failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="studio-form">
      <h3>Direct takedown</h3>
      <p className="field-hint">
        For notices that arrive outside the report flow, such as a DMCA notice by email.
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="takedown-slug">Title slug</label>
          <input
            id="takedown-slug"
            type="text"
            required
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="takedown-kind">Kind</label>
          <select id="takedown-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="dmca">DMCA</option>
            <option value="guidelines">Community guidelines</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="takedown-reason">Reason (shared with the creator)</label>
        <textarea
          id="takedown-reason"
          rows={2}
          required
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={submitting}>
        {submitting ? 'Issuing…' : 'Issue takedown'}
      </button>
    </form>
  );
}
