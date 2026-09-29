import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminRemovalRequest, AdminSubmission, SubmissionStatus } from '@sweam/shared';
import {
  AI_RECOMMENDATION_LABELS,
  CONTENT_KIND_LABELS,
  SUBMISSION_STATUS_LABELS,
} from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function AdminSubmissions() {
  usePageTitle('Submissions');
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>Submissions</h1>
        <p>This area is for Sweam administrators.</p>
      </div>
    );
  }
  return <SubmissionsCrm />;
}

const TABS: { key: string; label: string; query: string }[] = [
  { key: 'open', label: 'Open queue', query: '' },
  { key: 'pending', label: 'Received', query: 'pending' },
  { key: 'under_review', label: 'Under review', query: 'under_review' },
  { key: 'accepted', label: 'Accepted', query: 'accepted' },
  { key: 'declined', label: 'Declined', query: 'declined' },
  { key: 'withdrawn', label: 'Withdrawn', query: 'withdrawn' },
  { key: 'all', label: 'All', query: 'all' },
];

function SubmissionsCrm() {
  const [tab, setTab] = useState('open');
  const [submissions, setSubmissions] = useState<AdminSubmission[] | null>(null);
  const [removals, setRemovals] = useState<AdminRemovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async (tabKey: string) => {
    const active = TABS.find((entry) => entry.key === tabKey);
    try {
      const query = active?.query ? `?status=${active.query}` : '';
      const data = await apiGet<{ submissions: AdminSubmission[] }>(`/api/admin/submissions${query}`);
      setSubmissions(data.submissions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load submissions.');
    }
  }, []);

  const loadRemovals = useCallback(async () => {
    try {
      const data = await apiGet<{ requests: AdminRemovalRequest[] }>('/api/admin/removal-requests');
      setRemovals(data.requests);
    } catch {
      setRemovals([]);
    }
  }, []);

  useEffect(() => {
    setSubmissions(null);
    void load(tab);
  }, [tab, load]);

  useEffect(() => {
    void loadRemovals();
  }, [loadRemovals]);

  async function decideRemoval(request: AdminRemovalRequest, remove: boolean) {
    try {
      await apiSend('POST', `/api/admin/removal-requests/${request.id}/decide`, { remove });
      setNotice(
        remove ? `Removed "${request.title.name}".` : `Kept "${request.title.name}" live.`,
      );
      await loadRemovals();
      await load(tab);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not decide the request.');
    }
  }

  async function runAiReview(submission: AdminSubmission) {
    setNotice(`Asking Claude to review "${submission.titleName}"…`);
    try {
      await apiSend('POST', `/api/admin/submissions/${submission.id}/ai-review`);
      setNotice(`AI review ready for "${submission.titleName}".`);
      await load(tab);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'AI review failed.');
    }
  }

  async function setStatus(submission: AdminSubmission, status: SubmissionStatus) {
    try {
      await apiSend('POST', `/api/admin/submissions/${submission.id}/status`, { status });
      setNotice(`Moved "${submission.titleName}" to ${SUBMISSION_STATUS_LABELS[status]}.`);
      await load(tab);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not move the submission.');
    }
  }

  async function decide(submission: AdminSubmission, accept: boolean, note: string) {
    try {
      await apiSend('POST', `/api/admin/submissions/${submission.id}/decide`, { accept, note });
      setNotice(`${accept ? 'Accepted' : 'Declined'} "${submission.titleName}".`);
      await load(tab);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Decision failed.');
    }
  }

  if (error) return <ErrorNote message={error} />;

  return (
    <div className="page page-narrow">
      <h1>Submissions</h1>
      <p className="page-intro">
        The review pipeline for content pitched to Sweam. Back to the{' '}
        <Link to="/admin">admin dashboard</Link>.
      </p>

      {removals.length > 0 && (
        <section aria-labelledby="removals-heading" className="crm-removals">
          <h2 id="removals-heading">Removal requests ({removals.length})</h2>
          <ul className="crm-list">
            {removals.map((request) => (
              <li key={request.id} className="crm-card">
                <div className="crm-card-head">
                  <h3>
                    {request.title.name}{' '}
                    <span className="submission-meta">
                      by {request.creator.displayName}
                      {request.creator.handle ? ` (@${request.creator.handle})` : ''}
                    </span>
                  </h3>
                  <a href={`/t/${request.title.slug}`} target="_blank" rel="noreferrer">
                    View
                  </a>
                </div>
                <blockquote>{request.reason}</blockquote>
                <p className="submission-detail">Requested {request.createdAt.slice(0, 10)}</p>
                <div className="episode-actions">
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => decideRemoval(request, true)}
                  >
                    Remove from Sweam
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => decideRemoval(request, false)}
                  >
                    Keep live
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="crm-tabs" role="tablist" aria-label="Submission status">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            className={`crm-tab${tab === entry.key ? ' crm-tab-active' : ''}`}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}

      {!submissions ? (
        <Loading label="Loading submissions" />
      ) : submissions.length === 0 ? (
        <p>Nothing here.</p>
      ) : (
        <ul className="crm-list">
          {submissions.map((submission) => (
            <SubmissionCrmCard
              key={submission.id}
              submission={submission}
              onAiReview={() => runAiReview(submission)}
              onStatus={(status) => setStatus(submission, status)}
              onDecide={(accept, note) => decide(submission, accept, note)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function hostingLabel(submission: AdminSubmission): string {
  if (submission.verbatiimProjectId) return 'Imported from Verbatiim, hosted on Sweam';
  if (submission.sourceUrl) return 'Uploaded to Sweam';
  return 'External screener link';
}

function SubmissionCrmCard({
  submission,
  onAiReview,
  onStatus,
  onDecide,
}: {
  submission: AdminSubmission;
  onAiReview: () => Promise<void>;
  onStatus: (status: SubmissionStatus) => Promise<void>;
  onDecide: (accept: boolean, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const open = submission.status === 'pending' || submission.status === 'under_review';
  const watchUrl = submission.sourceUrl || submission.workUrl || null;
  const review = submission.aiReview;
  const noteId = `note-${submission.id}`;

  async function ai() {
    setAiBusy(true);
    try {
      await onAiReview();
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <li className="crm-card">
      <div className="crm-card-head">
        <h2>
          {submission.titleName}{' '}
          <span className="submission-meta">
            ({CONTENT_KIND_LABELS[submission.kind]} · {submission.genre})
          </span>
        </h2>
        <span className={`crm-status crm-status-${submission.status}`}>
          {SUBMISSION_STATUS_LABELS[submission.status]}
        </span>
      </div>
      <p className="submission-detail">
        From {submission.submitter.displayName} ({submission.submitter.email}
        {submission.submitter.handle ? `, @${submission.submitter.handle}` : ''}) ·{' '}
        {submission.createdAt.slice(0, 10)} · {hostingLabel(submission)}
      </p>
      <blockquote>{submission.synopsis}</blockquote>
      <p className="submission-detail">
        {submission.rating ? `Rated ${submission.rating} · ` : ''}
        {[...submission.audiences, ...submission.genres, ...submission.subgenres].join(', ') ||
          submission.genre}
      </p>
      {submission.isAdaptation && (
        <div className="notice notice-warn" role="note">
          <strong>Adaptation of a published work:</strong>{' '}
          {submission.adaptationSource || '(unnamed source)'}.{' '}
          {submission.rightsProofUrl && (
            <a href={submission.rightsProofUrl} target="_blank" rel="noreferrer">
              Rights proof
            </a>
          )}
          {submission.rightsProofUrl && submission.idProofUrl ? ' · ' : ''}
          {submission.idProofUrl && (
            <a href={submission.idProofUrl} target="_blank" rel="noreferrer">
              Identification
            </a>
          )}
          {' · '}
          {submission.adaptationAttested
            ? 'Attested; hold-harmless agreed.'
            : 'NOT attested.'}
        </div>
      )}
      {watchUrl && (
        <p className="submission-detail">
          <a href={watchUrl} target="_blank" rel="noreferrer">
            {submission.sourceUrl ? 'Watch the uploaded film' : 'Open the screener link'}
          </a>
        </p>
      )}

      <div className="crm-ai">
        <div className="crm-ai-head">
          <h3>AI review</h3>
          <button type="button" className="button button-quiet" onClick={ai} disabled={aiBusy}>
            {aiBusy ? 'Reviewing…' : review ? 'Re-run AI review' : 'Run AI review'}
          </button>
        </div>
        {review ? (
          <div className="crm-ai-body">
            <p>
              <span className={`ai-rec ai-rec-${review.recommendation}`}>
                {AI_RECOMMENDATION_LABELS[review.recommendation]}
              </span>{' '}
              <span className="submission-meta">
                ({Math.round(review.confidence * 100)}% confidence · {review.model})
              </span>
            </p>
            <p>{review.summary}</p>
            {review.riskFlags.length > 0 && (
              <ul className="ai-flags">
                {review.riskFlags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            )}
            {review.suggestedNote && (
              <p className="crm-ai-note">
                <strong>Suggested note:</strong> {review.suggestedNote}{' '}
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setNote(review.suggestedNote)}
                >
                  Use as note
                </button>
              </p>
            )}
            <p className="submission-meta">
              Advisory only, from the description and metadata, not the video.
            </p>
          </div>
        ) : (
          <p className="submission-meta">
            No AI review yet. It assesses the described work against the guidelines to help you
            triage.
          </p>
        )}
      </div>

      {open ? (
        <div className="crm-actions">
          <div className="field">
            <label htmlFor={noteId}>Reviewer note (shared with the submitter)</label>
            <input
              id={noteId}
              type="text"
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="episode-actions">
            {submission.status === 'pending' ? (
              <button type="button" className="button button-quiet" onClick={() => onStatus('under_review')}>
                Start review
              </button>
            ) : (
              <button type="button" className="button button-quiet" onClick={() => onStatus('pending')}>
                Back to received
              </button>
            )}
            <button type="button" className="button" onClick={() => onDecide(true, note)}>
              Accept
            </button>
            <button type="button" className="button button-danger" onClick={() => onDecide(false, note)}>
              Decline
            </button>
          </div>
        </div>
      ) : (
        submission.note && <p className="submission-detail">Reviewer note: {submission.note}</p>
      )}
    </li>
  );
}
