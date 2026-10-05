import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SeriesSummary, SubmissionItem, SubmissionStatus } from '@sweam/shared';
import {
  AUDIENCES,
  AUDIENCE_LABELS,
  CONTENT_KINDS,
  CONTENT_KIND_LABELS,
  CREATOR_REVENUE_SHARE,
  GENRES,
  SUBGENRES,
  MIN_PAYOUT_MILLICENTS,
  MONETIZATION_THRESHOLDS,
  RATINGS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_STEPS,
  UPLOAD_SPECS,
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
            Approved work goes live on Sweam. The full policy lives in the public{' '}
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
          <li>It fits a catalog category with an honest rating and metadata.</li>
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
  const [series, setSeries] = useState<SeriesSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ submissions: SubmissionItem[] }>('/api/submissions/mine');
      setMine(data.submissions);
    } catch {
      setMine([]);
    }
  }, []);

  const loadSeries = useCallback(async () => {
    try {
      const data = await apiGet<{ series: SeriesSummary[] }>('/api/submissions/series');
      setSeries(data.series);
    } catch {
      setSeries([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSeries();
    apiGet<{ connected: boolean }>('/api/submissions/verbatiim/status')
      .then((data) => setVerbatiimConnected(data.connected))
      .catch(() => setVerbatiimConnected(false));
  }, [load, loadSeries]);

  return (
    <>
      <SubmissionForm
        verbatiimConnected={verbatiimConnected}
        series={series}
        onSubmitted={async () => {
          await load();
          await loadSeries();
        }}
      />
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
            ({CONTENT_KIND_LABELS[submission.kind]} · {submission.genre}
            {submission.rating ? ` · ${submission.rating}` : ''}
            {submission.seriesName ? ` · series: ${submission.seriesName}` : ''})
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
async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('That image could not be read.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function UploadField({
  id,
  label,
  accept,
  hint,
  maxBytes,
  minWidth,
  minHeight,
  currentName,
  onUploaded,
}: {
  id: string;
  label: string;
  accept: string;
  hint: string;
  maxBytes?: number;
  minWidth?: number;
  minHeight?: number;
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
      if (maxBytes && file.size > maxBytes) {
        const mb = Math.round(maxBytes / (1024 * 1024));
        setError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${mb} MB.`);
        onUploaded(null, null);
        return;
      }
      setBusy(true);
      try {
        if (minWidth && minHeight && file.type.startsWith('image/')) {
          const { width, height } = await imageDimensions(file);
          if (width < minWidth || height < minHeight) {
            setError(`Cover art must be at least ${minWidth} x ${minHeight}px. Yours is ${width} x ${height}px.`);
            onUploaded(null, null);
            return;
          }
        }
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
    [onUploaded, maxBytes, minWidth, minHeight],
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

/** A labelled multi-select rendered as an accessible checkbox group. */
function CheckGroup({
  legend,
  name,
  options,
  selected,
  onToggle,
  labels,
  grid,
}: {
  legend: string;
  name: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  labels?: Record<string, string>;
  grid?: boolean;
}) {
  return (
    <fieldset className="check-group">
      <legend>{legend}</legend>
      <div className={grid ? 'check-grid' : 'check-row'}>
        {options.map((value) => {
          const id = `${name}-${value.replace(/\s+/g, '-')}`;
          return (
            <div key={value} className="field-checkbox">
              <input
                id={id}
                type="checkbox"
                checked={selected.includes(value)}
                onChange={() => onToggle(value)}
              />
              <label htmlFor={id}>{labels?.[value] ?? value}</label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function SubmissionForm({
  verbatiimConnected,
  series,
  onSubmitted,
}: {
  verbatiimConnected: boolean;
  series: SeriesSummary[];
  onSubmitted: () => Promise<void>;
}) {
  const [titleName, setTitleName] = useState('');
  const [kind, setKind] = useState<string>('film');
  const [audiences, setAudiences] = useState<string[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [subgenres, setSubgenres] = useState<string[]>([]);
  const [rating, setRating] = useState<string>('');
  const [synopsis, setSynopsis] = useState('');

  const [posterUrl, setPosterUrl] = useState('');
  const [posterName, setPosterName] = useState<string | null>(null);

  const [seriesMode, setSeriesMode] = useState<'existing' | 'new'>('new');
  const [seriesId, setSeriesId] = useState('');
  const [seriesName, setSeriesName] = useState('');

  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [captionsUrl, setCaptionsUrl] = useState('');
  const [captionsName, setCaptionsName] = useState<string | null>(null);
  const [verbatiimProjectId, setVerbatiimProjectId] = useState<string | null>(null);
  const [workUrl, setWorkUrl] = useState('');

  const [verbatiimInput, setVerbatiimInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [isAdaptation, setIsAdaptation] = useState(false);
  const [adaptationSource, setAdaptationSource] = useState('');
  const [rightsProofUrl, setRightsProofUrl] = useState('');
  const [rightsProofName, setRightsProofName] = useState<string | null>(null);
  const [idProofUrl, setIdProofUrl] = useState('');
  const [idProofName, setIdProofName] = useState<string | null>(null);
  const [adaptationAttested, setAdaptationAttested] = useState(false);

  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const hasWork = Boolean(sourceUrl || workUrl.trim() || verbatiimProjectId);
  const isSeries = kind === 'series';
  const seriesOk = !isSeries || (seriesMode === 'existing' ? Boolean(seriesId) : Boolean(seriesName.trim()));
  const adaptationOk =
    !isAdaptation ||
    Boolean(adaptationSource.trim() && rightsProofUrl && idProofUrl && adaptationAttested);
  const canSubmit = Boolean(
    rightsConfirmed &&
      rating &&
      posterUrl &&
      audiences.length > 0 &&
      genres.length > 0 &&
      seriesOk &&
      adaptationOk,
  );

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  function resetForm() {
    setTitleName('');
    setAudiences([]);
    setGenres([]);
    setSubgenres([]);
    setRating('');
    setSynopsis('');
    setPosterUrl('');
    setPosterName(null);
    setSeriesId('');
    setSeriesName('');
    setSourceUrl('');
    setSourceName(null);
    setCaptionsUrl('');
    setCaptionsName(null);
    setVerbatiimProjectId(null);
    setWorkUrl('');
    setVerbatiimInput('');
    setIsAdaptation(false);
    setAdaptationSource('');
    setRightsProofUrl('');
    setRightsProofName(null);
    setIdProofUrl('');
    setIdProofName(null);
    setAdaptationAttested(false);
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
        audiences,
        genres,
        subgenres,
        rating,
        synopsis,
        posterUrl,
        sourceUrl: sourceUrl || null,
        captionsUrl: captionsUrl || null,
        verbatiimProjectId,
        seriesId: isSeries && seriesMode === 'existing' ? seriesId : null,
        seriesName: isSeries && seriesMode === 'new' ? seriesName.trim() : null,
        workUrl: workUrl.trim() || null,
        isAdaptation,
        adaptationSource: adaptationSource.trim(),
        rightsProofUrl: rightsProofUrl || null,
        idProofUrl: idProofUrl || null,
        adaptationAttested,
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
      <aside className="intake-specs" aria-label="File requirements">
        <h3>File requirements</h3>
        <ul>
          <li>
            <strong>Cover art:</strong> {UPLOAD_SPECS.poster.formats}, up to{' '}
            {UPLOAD_SPECS.poster.maxLabel}. {UPLOAD_SPECS.poster.aspect}, at least{' '}
            {UPLOAD_SPECS.poster.minWidth} x {UPLOAD_SPECS.poster.minHeight}px.
          </li>
          <li>
            <strong>Video:</strong> {UPLOAD_SPECS.video.formats}, up to {UPLOAD_SPECS.video.maxLabel}.
            Larger files upload in resumable parts.
          </li>
          <li>
            <strong>Captions (optional):</strong> {UPLOAD_SPECS.captions.formats}, up to{' '}
            {UPLOAD_SPECS.captions.maxLabel}.
          </li>
        </ul>
      </aside>
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

        <CheckGroup
          legend="Audience (choose at least one)"
          name="audience"
          options={AUDIENCES}
          labels={AUDIENCE_LABELS}
          selected={audiences}
          onToggle={(value) => setAudiences((cur) => toggle(cur, value))}
        />
        <CheckGroup
          legend="Genres (choose at least one)"
          name="genre"
          options={GENRES}
          selected={genres}
          onToggle={(value) => setGenres((cur) => toggle(cur, value))}
          grid
        />
        <CheckGroup
          legend="Sub-genres (optional, combine freely)"
          name="subgenre"
          options={SUBGENRES}
          selected={subgenres}
          onToggle={(value) => setSubgenres((cur) => toggle(cur, value))}
          grid
        />

        <div className="field">
          <label htmlFor="sub-rating">Viewer rating (required)</label>
          <select
            id="sub-rating"
            required
            value={rating}
            aria-describedby="sub-rating-reminder"
            onChange={(event) => setRating(event.target.value)}
          >
            <option value="" disabled>
              Choose a rating…
            </option>
            {RATINGS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <aside id="sub-rating-reminder" className="notice notice-warn" role="note">
            <strong>Explicit or pornographic content is forbidden.</strong> Rate honestly. Submitting
            or uploading forbidden content results in a permanent account ban.
          </aside>
        </div>

        <div className="field">
          <label htmlFor="sub-synopsis">Synopsis (required)</label>
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

        <UploadField
          id="sub-poster"
          label="Cover art (required)"
          accept={UPLOAD_SPECS.poster.accept}
          hint={`${UPLOAD_SPECS.poster.formats}, up to ${UPLOAD_SPECS.poster.maxLabel}, ${UPLOAD_SPECS.poster.aspect}. This is the artwork viewers see.`}
          maxBytes={UPLOAD_SPECS.poster.maxBytes}
          minWidth={UPLOAD_SPECS.poster.minWidth}
          minHeight={UPLOAD_SPECS.poster.minHeight}
          currentName={posterName}
          onUploaded={(url, name) => {
            setPosterUrl(url ?? '');
            setPosterName(name);
          }}
        />

        {isSeries && (
          <fieldset className="intake-sources">
            <legend>Series</legend>
            <p className="field-hint">
              Group this part under a series so you can add more episodes later; the series is saved
              to your account.
            </p>
            {series.length > 0 && (
              <div className="field field-checkbox">
                <input
                  id="series-existing"
                  type="radio"
                  name="series-mode"
                  checked={seriesMode === 'existing'}
                  onChange={() => setSeriesMode('existing')}
                />
                <label htmlFor="series-existing">Add to an existing series</label>
              </div>
            )}
            {series.length > 0 && seriesMode === 'existing' && (
              <div className="field">
                <label htmlFor="sub-series">Series</label>
                <select id="sub-series" value={seriesId} onChange={(event) => setSeriesId(event.target.value)}>
                  <option value="" disabled>
                    Choose a series…
                  </option>
                  {series.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field field-checkbox">
              <input
                id="series-new"
                type="radio"
                name="series-mode"
                checked={seriesMode === 'new'}
                onChange={() => setSeriesMode('new')}
              />
              <label htmlFor="series-new">Start a new series</label>
            </div>
            {seriesMode === 'new' && (
              <div className="field">
                <label htmlFor="sub-series-name">Series name</label>
                <input
                  id="sub-series-name"
                  type="text"
                  maxLength={120}
                  value={seriesName}
                  onChange={(event) => setSeriesName(event.target.value)}
                />
              </div>
            )}
          </fieldset>
        )}

        <fieldset className="intake-sources">
          <legend>Your film</legend>
          <p className="field-hint">
            Upload it to Sweam (recommended, so we host it), import a finished Verbatiim project, or
            link an external screener. Any one is enough.
          </p>

          <UploadField
            id="sub-video"
            label="Upload the film"
            accept={UPLOAD_SPECS.video.accept}
            hint={`${UPLOAD_SPECS.video.formats}, up to ${UPLOAD_SPECS.video.maxLabel}. Large files upload in resumable parts.`}
            maxBytes={UPLOAD_SPECS.video.maxBytes}
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
            accept={UPLOAD_SPECS.captions.accept}
            hint={`${UPLOAD_SPECS.captions.formats}, up to ${UPLOAD_SPECS.captions.maxLabel}. A captions file makes your work accessible.`}
            maxBytes={UPLOAD_SPECS.captions.maxBytes}
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

        <fieldset className="intake-sources">
          <legend>Rights &amp; licensing</legend>
          <div className="field field-checkbox">
            <input
              id="sub-adaptation"
              type="checkbox"
              checked={isAdaptation}
              onChange={(event) => setIsAdaptation(event.target.checked)}
            />
            <label htmlFor="sub-adaptation">
              This is an adaptation of a third-party published work (a book, script, article, song,
              or other copyrighted material I did not create).
            </label>
          </div>
          {isAdaptation && (
            <>
              <div className="field">
                <label htmlFor="sub-adaptation-source">What published work are you adapting?</label>
                <input
                  id="sub-adaptation-source"
                  type="text"
                  maxLength={200}
                  value={adaptationSource}
                  onChange={(event) => setAdaptationSource(event.target.value)}
                />
              </div>
              <UploadField
                id="sub-rights-proof"
                label="Proof of rights or licence (required)"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                hint="A licence, rights assignment, or written permission. PDF or image, up to 20 MB."
                maxBytes={20 * 1024 * 1024}
                currentName={rightsProofName}
                onUploaded={(url, name) => {
                  setRightsProofUrl(url ?? '');
                  setRightsProofName(name);
                }}
              />
              <UploadField
                id="sub-id-proof"
                label="Your identification (required)"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                hint="Government or studio ID to accompany the rights proof. PDF or image, up to 20 MB."
                maxBytes={20 * 1024 * 1024}
                currentName={idProofName}
                onUploaded={(url, name) => {
                  setIdProofUrl(url ?? '');
                  setIdProofName(name);
                }}
              />
              <div className="field field-checkbox">
                <input
                  id="sub-adaptation-attest"
                  type="checkbox"
                  checked={adaptationAttested}
                  onChange={(event) => setAdaptationAttested(event.target.checked)}
                />
                <label htmlFor="sub-adaptation-attest">
                  I attest that I own or have licensed the rights to adapt this work, that the
                  documents above are true, and I agree to hold Falcyn Inc dba Sweam harmless from
                  any liability arising from it.
                </label>
              </div>
            </>
          )}
        </fieldset>

        <div className="field field-checkbox">
          <input
            id="sub-rights"
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          <label htmlFor="sub-rights">
            I confirm I hold the rights to this work, it contains no forbidden content, and I accept
            that submitting forbidden content results in a permanent account ban.
          </label>
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting || !canSubmit}>
          {submitting ? 'Sending…' : 'Submit for review'}
        </button>
      </form>
    </section>
  );
}
