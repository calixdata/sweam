import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { REPORT_REASONS, REPORT_REASON_LABELS } from '@sweam/shared';
import { ApiError, apiSend } from '../api';

/**
 * A prominent "Report" / flag control that can sit on any piece of content
 * (a title page, the player, a feed card). It toggles an inline panel with a
 * reason picker and optional note, and posts to POST /api/me/reports.
 *
 * Reporting is how viewers flag prohibited content (nudity, explicit, illegal)
 * for the Sweam moderators, alongside the automated review queue.
 */
export function ReportControl({
  titleId,
  titleSlug,
  signedIn,
  variant = 'quiet',
  label = 'Report',
}: {
  titleId: string;
  titleSlug: string;
  signedIn: boolean;
  variant?: 'quiet' | 'plain';
  label?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/me/reports', { titleId, reason, note });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'already_reported') {
        setSent(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not send the report.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const buttonClass = variant === 'plain' ? 'report-control-trigger' : 'button button-quiet';

  return (
    <div className="report-control">
      <button
        type="button"
        className={buttonClass}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⚑</span> {label}
      </button>
      {open && (
        <div id={panelId} className="report-control-panel">
          {!signedIn ? (
            <p>
              <Link to="/signin" state={{ from: `/t/${titleSlug}` }}>
                Sign in
              </Link>{' '}
              to report this to the moderators.
            </p>
          ) : sent ? (
            <p role="status">Thanks. Our moderators will review this.</p>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor={`${panelId}-reason`}>Reason</label>
                <select
                  id={`${panelId}-reason`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                >
                  {REPORT_REASONS.map((value) => (
                    <option key={value} value={value}>
                      {REPORT_REASON_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${panelId}-note`}>Details (optional)</label>
                <textarea
                  id={`${panelId}-note`}
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              {error && (
                <p className="status status-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="button button-quiet" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send report'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
