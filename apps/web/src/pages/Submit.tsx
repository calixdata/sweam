import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SubmissionItem, SubmissionStatus } from '@sweam/shared';
import {
  CONTENT_KINDS,
  CONTENT_KIND_LABELS,
  CREATOR_REVENUE_SHARE,
  GENRES,
  MIN_PAYOUT_MILLICENTS,
  MONETIZATION_THRESHOLDS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_STEPS,
  formatMillicents,
} from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { usePageTitle } from '../hooks';
import { uploadMedia } from '../upload';
import type { UploadProgress } from '../upload';

const SHARE_PERCENT = Math.round(CREATOR_REVENUE_SHARE * 100);
const INTAKE_UPLOAD_BASE = '/api/submissions/upload';
const VERBATIIM_SITE = 'https://verbatiim.co';

export function Submit() {
  usePageTitle('Submit your work');
  const { user } = useAuth();

  return (
    <div className="page page-narrow">
      <h1>Submit your work to Sweam</h1>
      <p className="page-intro">
        Sweam is free streaming built for independent creators: films, series, shorts, and
        documentaries presented like a catalog, discovered on finish rate instead of follower count.
        Upload your work and we host it, import a finished film from{' '}
        <a href={VERBATIIM_SITE} target="_blank" rel="noreferrer">
          Verbatiim
        </a>
        , or link a screener for review.
      </p>

      <section aria-labelledby="submit-deal">
        <h2 id="submit-deal">The deal, in numbers</h2>
        <ul>
          <li>
            Free to watch, ad-supported. Creators keep <strong>{SHARE_PERCENT}%</strong> of the ad
            revenue earned on their titles: one published split, the same for everyone, no
            negotiation.
          </li>
          <li>
            Payouts unlock at {formatMillicents(MIN_PAYOUT_MILLICENTS)} of earnings, far below the
            $100 floors common elsewhere.
          </li>
          <li>
            Monetization opens at {MONETIZATION_THRESHOLDS.minFollowers} followers,{' '}
            {Math.round(MONETIZATION_THRESHOLDS.minWatchSeconds / 60).toLocaleString()} watch
            minutes, and {MONETIZATION_THRESHOLDS.minPublishedTitles} published title
            {MONETIZATION_THRESHOLDS.minPublishedTitles === 1 ? '' : 's'}, with an account in good
            standing.
          </li>
          <li>
            The full policy lives in the public{' '}
            <a href="https://github.com/calixdata/sweam/blob/main/docs/CREATOR-PROGRAM.md">
              Creator Program document
            </a>
            .
          </li>
        </ul>
      </section>

      <section aria-labelledby="submit-review">
        <h2 id="submit-review">What review looks for</h2>
        <ul>
          <li>You hold the rights to the work (confirmed with your submission).</li>
          <li>The work is original and finished: no reposts, no rips.</li>
          <li>It fits a catalog category with honest metadata.</li>
          <li>
            Not considered: follower counts elsewhere, agents, or distributors. Discovery here is
            equal-visibility by design.
          </li>
        </ul>
      </section>

      {user ? (
        <SubmissionArea />
      ) : (
        <p className="status">
          <Link to="/signin" state={{ from: '/submit' }}>
            Sign in
          </Link>{' '}
          or{' '}
          <Link to="/signup" state={{ from: '/submit' }}>
            create a free account
          </Link>{' '}
          to submit your work.
        </p>
      )}
    </div>
  );
}

function SubmissionArea() {
  const [mine, setMine] = useState<SubmissionItem[] | null>(null);
  const [verbatiimConnected, setVerbatiimConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ submissions: SubmissionItem[] }>('/api/submissions/mine');
      setMine(data.submissions);
    } catch {
      setMine([]);
    }
  }, []);

  useEffect(() => {
    void load();
    apiGet<{ connected: boolean }>('/api/submissions/verbatiim/status')
      .then((data) => setVerbatiimConnected(data.connected))
      .catch(() => setVerbatiimConnected(false));
  }, [load]);

  return (
    <>
      <SubmissionForm verbatiimConnected={verbatiimConnected} onSubmitted={load} />
      <section aria-labelledby="my-submissions">
        <h2 id="my-submissions">Your submissions</h2>
        {!mine || mine.length === 0 ? (
          <p>No submissions yet.</p>
        ) : (
          <ul className="submission-list">
            {mine.map((submission) => (
              <SubmissionCard key={submission.id} submission={submission} onChanged={load} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** The forward-pipeline status bar, with declined/withdrawn as terminal chips. */
function StatusBar({ status }: { status: SubmissionStatus }) {
  if (status === 'declined' || status === 'withdrawn') {
    return (
      <p className={`submission-terminal submission-terminal-${status}`}>
        {SUBMISSION_STATUS_LABELS[status]}
      </p>
    );
  }
  const currentIndex = SUBMISSION_STATUS_STEPS.indexOf(status);
  return (
    <ol className="status-steps" aria-label="Submission status">
      {SUBMISSION_STATUS_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
        return (
          <li
            key={step}
            className={`status-step status-step-${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="status-step-dot" aria-hidden="true" />
            <span className="status-step-label">{SUBMISSION_STATUS_LABELS[step]}</span>
            <span className="visually-hidden">
              {state === 'done' ? ' (done)' : state === 'current' ? ' (current step)' : ' (upcoming)'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function hostingLabel(submission: SubmissionItem): string {
  if (submission.verbatiimProjectId) return 'Imported from Verbatiim, hosted on Sweam';
  if (submission.sourceUrl) return 'Uploaded to Sweam';
  return 'External screener link';
}

function SubmissionCard({
  submission,
  onChanged,
}: {
  submission: SubmissionItem;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWithdraw = submission.status === 'pending' || submission.status === 'under_review';

  async function withdraw() {
    if (!window.confirm(`Withdraw "${submission.titleName}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/api/submissions/${submission.id}/withdraw`);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not withdraw the submission.');
      setBusy(false);
    }
  }

  return (
    <li className="submission-card">
      <div className="submission-card-head">
        <h3>
          {submission.titleName}{' '}
          <span className="submission-meta">
            ({CONTENT_KIND_LABELS[submission.kind]} · {submission.genre})
          </span>
        </h3>
        {canWithdraw && (
          <button type="button" className="button button-quiet" onClick={withdraw} disabled={busy}>
            {busy ? 'Withdrawing…' : 'Withdraw'}
          </button>
        )}
      </div>
      <StatusBar status={submission.status} />
      <p className="submission-detail">
        {hostingLabel(submission)} · submitted {submission.createdAt.slice(0, 10)}
        {submission.decidedAt ? `, decided ${submission.decidedAt.slice(0, 10)}` : ''}
      </p>
      {submission.sourceUrl && (
        <p className="submission-detail">
          <a href={submission.sourceUrl} target="_blank" rel="noreferrer">
            Preview the uploaded file
          </a>
        </p>
      )}
      {submission.note && <blockquote>Reviewer note: {submission.note}</blockquote>}
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** One reusable upload control that streams to the intake uploader with progress. */
function UploadField({
  id,
  label,
  accept,
  hint,
  currentName,
  onUploaded,
}: {
  id: string;
  label: string;
  accept: string;
  hint: string;
  currentName: string | null;
  onUploaded: (url: string | null, name: string | null) => void;
}) {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      setBusy(true);
      try {
        const { url } = await uploadMedia(file, setProgress, INTAKE_UPLOAD_BASE);
        onUploaded(url, file.name);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Upload failed.');
        onUploaded(null, null);
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [onUploaded],
  );

  return (
    <div
      className="upload-field"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!busy) void handleFile(event.dataTransfer.files?.[0]);
      }}
    >
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        className="upload-input"
        disabled={busy}
        aria-describedby={`${id}-hint`}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <p className="field-hint" id={`${id}-hint`}>
        {hint} You can also drag a file here.
      </p>
      {busy && progress && (
        <div className="upload-progress">
          <progress max={progress.partsTotal} value={progress.partsDone} aria-label={label} />
          <p className="status" role="status">
            {progress.message}
          </p>
        </div>
      )}
      {!busy && currentName && !error && (
        <p className="status status-ok" role="status">
          Attached: {currentName}
        </p>
      )}
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SubmissionForm({
  verbatiimConnected,
  onSubmitted,
}: {
  verbatiimConnected: boolean;
  onSubmitted: () => Promise<void>;
}) {
  const [titleName, setTitleName] = useState('');
  const [kind, setKind] = useState<string>('film');
  const [genre, setGenre] = useState<string>(GENRES[0]);
  const [synopsis, setSynopsis] = useState('');

  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [captionsUrl, setCaptionsUrl] = useState('');
  const [captionsName, setCaptionsName] = useState<string | null>(null);
  const [verbatiimProjectId, setVerbatiimProjectId] = useState<string | null>(null);
  const [workUrl, setWorkUrl] = useState('');

  const [verbatiimInput, setVerbatiimInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const hasWork = Boolean(sourceUrl || workUrl.trim() || verbatiimProjectId);

  function resetForm() {
    setTitleName('');
    setSynopsis('');
    setSourceUrl('');
    setSourceName(null);
    setCaptionsUrl('');
    setCaptionsName(null);
    setVerbatiimProjectId(null);
    setWorkUrl('');
    setVerbatiimInput('');
    setRightsConfirmed(false);
  }

  async function importFromVerbatiim() {
    const projectId = verbatiimInput.trim();
    if (!projectId) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await apiSend<{ sourceUrl: string; captionsUrl: string | null; projectId: string }>(
        'POST',
        '/api/submissions/verbatiim/import',
        { projectId },
      );
      setSourceUrl(result.sourceUrl);
      setSourceName('Verbatiim film');
      setVerbatiimProjectId(result.projectId);
      if (result.captionsUrl) {
        setCaptionsUrl(result.captionsUrl);
        setCaptionsName('Verbatiim captions');
      }
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Could not import from Verbatiim.');
    } finally {
      setImporting(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!hasWork) {
      setError('Add your work: upload a file, import from Verbatiim, or paste a screener link.');
      return;
    }
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/submissions', {
        titleName,
        kind,
        genre,
        synopsis,
        sourceUrl: sourceUrl || null,
        captionsUrl: captionsUrl || null,
        verbatiimProjectId,
        workUrl: workUrl.trim() || null,
        rightsConfirmed,
      });
      setSent(true);
      resetForm();
      await onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the submission.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="submission-form-heading">
      <h2 id="submission-form-heading">Submit a work</h2>
      {sent && (
        <p className="status status-ok" role="status">
          Submission received. A reviewer will look at it; you will get a notification either way.
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate className="studio-form">
        <div className="field">
          <label htmlFor="sub-name">Title of the work</label>
          <input
            id="sub-name"
            type="text"
            required
            maxLength={120}
            value={titleName}
            onChange={(event) => setTitleName(event.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sub-kind">Kind</label>
            <select id="sub-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              {CONTENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {CONTENT_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sub-genre">Genre</label>
            <select id="sub-genre" value={genre} onChange={(event) => setGenre(event.target.value)}>
              {GENRES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="sub-synopsis">About the work</label>
          <textarea
            id="sub-synopsis"
            rows={4}
            required
            maxLength={2000}
            aria-describedby="sub-synopsis-hint"
            value={synopsis}
            onChange={(event) => setSynopsis(event.target.value)}
          />
          <p className="field-hint" id="sub-synopsis-hint">
            What it is, how long it is, and anything a reviewer should know. At least a couple of
            sentences.
          </p>
        </div>

        <fieldset className="intake-sources">
          <legend>Your film</legend>
          <p className="field-hint">
            Upload it to Sweam (recommended, so we host it), import a finished Verbatiim project, or
            link an external screener. Any one is enough.
          </p>

          <UploadField
            id="sub-video"
            label="Upload the film"
            accept="video/mp4,video/webm"
            hint="MP4 or WebM, up to 512 MB. Large files upload in resumable parts."
            currentName={sourceName}
            onUploaded={(url, name) => {
              setSourceUrl(url ?? '');
              setSourceName(name);
              if (url) setVerbatiimProjectId(null);
            }}
          />

          <UploadField
            id="sub-captions"
            label="Captions (optional)"
            accept="text/vtt,.vtt"
            hint="A WebVTT captions file makes your work accessible."
            currentName={captionsName}
            onUploaded={(url, name) => {
              setCaptionsUrl(url ?? '');
              setCaptionsName(name);
            }}
          />

          <div className="intake-verbatiim">
            <p className="field-label">Import from Verbatiim</p>
            {verbatiimConnected ? (
              <>
                <div className="field-inline">
                  <label htmlFor="sub-verbatiim" className="visually-hidden">
                    Verbatiim project id or link
                  </label>
                  <input
                    id="sub-verbatiim"
                    type="text"
                    placeholder="Verbatiim project id or link"
                    value={verbatiimInput}
                    onChange={(event) => setVerbatiimInput(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={importFromVerbatiim}
                    disabled={importing || !verbatiimInput.trim()}
                  >
                    {importing ? 'Importing…' : 'Import'}
                  </button>
                </div>
                <p className="field-hint">
                  We copy the finished film into Sweam so we host it. New to Verbatiim?{' '}
                  <a href={VERBATIIM_SITE} target="_blank" rel="noreferrer">
                    Create your film there
                  </a>
                  .
                </p>
                {importError && (
                  <p className="status status-error" role="alert">
                    {importError}
                  </p>
                )}
              </>
            ) : (
              <p className="field-hint">
                <a href={VERBATIIM_SITE} target="_blank" rel="noreferrer">
                  Create your film with Verbatiim
                </a>
                , then upload the export above.
              </p>
            )}
          </div>

          <details className="intake-link">
            <summary>Or link an external screener instead</summary>
            <div className="field">
              <label htmlFor="sub-url">Screener link (https)</label>
              <input
                id="sub-url"
                type="url"
                placeholder="https://"
                aria-describedby="sub-url-hint"
                value={workUrl}
                onChange={(event) => setWorkUrl(event.target.value)}
              />
              <p className="field-hint" id="sub-url-hint">
                An unlisted upload, a screener page, or a portfolio. Uploading to Sweam is preferred
                so your work is not dependent on another host.
              </p>
            </div>
          </details>
        </fieldset>

        <div className="field field-checkbox">
          <input
            id="sub-rights"
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          <label htmlFor="sub-rights">
            I confirm I hold the rights to this work and the authority to license it for streaming.
          </label>
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting || !rightsConfirmed}>
          {submitting ? 'Sending…' : 'Submit for review'}
        </button>
      </form>
    </section>
  );
}
