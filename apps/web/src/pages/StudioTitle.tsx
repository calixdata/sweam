import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StudioEpisode, StudioTitleDetail } from '@sweam/shared';
import {
  ADVISORIES,
  BLU_SWITCH_COOLDOWN_DAYS,
  BLU_TIERS,
  bluTierByCents,
  CONTENT_KINDS,
  CONTENT_KIND_LABELS,
  GENRES,
  RELEASE_TIME_ZONE,
  formatReleaseDate,
} from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { CoverArtField } from '../components/CoverArtField';

/** The Eastern calendar day (YYYY-MM-DD) a release instant falls on, for the date input. */
function easternDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RELEASE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  return parts;
}
import { ErrorNote, Loading } from '../components/Status';
import { VerbatiimPanel } from '../components/VerbatiimPanel';
import { formatDuration, usePageTitle } from '../hooks';
import { uploadMedia } from '../upload';

export function StudioTitle() {
  const { titleId } = useParams<{ titleId: string }>();
  const navigate = useNavigate();
  const [title, setTitle] = useState<StudioTitleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  usePageTitle(title ? `Studio: ${title.name}` : 'Studio');

  const load = useCallback(async () => {
    if (!titleId) return;
    try {
      setTitle(await apiGet<StudioTitleDetail>(`/api/studio/titles/${encodeURIComponent(titleId)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this title.');
    }
  }, [titleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!title) return <Loading label="Loading title" />;

  async function togglePublish() {
    if (!title) return;
    try {
      const data = await apiSend<{ published: boolean }>(
        'POST',
        `/api/studio/titles/${title.id}/publish`,
        { published: !title.published },
      );
      setNotice(data.published ? 'Published. It is now live in the catalog.' : 'Unpublished.');
      await load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Publish failed.');
    }
  }

  async function deleteTitle() {
    if (!title) return;
    const confirmed = window.confirm(
      `Delete “${title.name}” and all of its episodes? This cannot be undone.`,
    );
    if (!confirmed) return;
    await apiSend('DELETE', `/api/studio/titles/${title.id}`);
    navigate('/studio');
  }

  return (
    <div className="page page-narrow">
      <p>
        <Link to="/studio">Back to Studio</Link>
      </p>
      <h1>{title.name}</h1>
      <p className="title-meta">
        {title.published ? 'Published' : 'Draft'} · {CONTENT_KIND_LABELS[title.kind]} ·{' '}
        {title.stats.plays.toLocaleString()} plays · {title.stats.completes.toLocaleString()} finishes
        {title.published && (
          <>
            {' '}
            · <Link to={`/t/${title.slug}`}>View public page</Link>
          </>
        )}
      </p>

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}

      {title.suppressed && (
        <p className="status status-error" role="status">
          Sweam has this title under review. It is hidden from Sweam while the review is open, and
          its visibility is frozen — you cannot publish, unpublish, or delete it right now.
        </p>
      )}

      <div className="title-actions">
        {!title.suppressed && (
          <button type="button" className="button" onClick={togglePublish}>
            {title.published ? (title.everBlu ? 'Make private' : 'Unpublish') : 'Publish'}
          </button>
        )}
        <Link className="button button-quiet" to={`/studio/t/${title.id}/analytics`}>
          Analytics and scout activity
        </Link>
        {/* Deletion is governed by Blu history only: free titles that have never been Blu
            can be deleted outright. Blu or ex-Blu titles use removal/make-private instead,
            and an investigation hold blocks deletion. */}
        {!title.isBlu && !title.everBlu && !title.suppressed && (
          <button type="button" className="button button-danger" onClick={deleteTitle}>
            Delete title
          </button>
        )}
      </div>

      {(title.isBlu || title.everBlu) && (
        <RemovalRequestPanel title={title} onRequested={load} setNotice={setNotice} />
      )}

      <TitleEditForm title={title} onSaved={load} />
      <BluPanel title={title} onChanged={load} setNotice={setNotice} />
      <EpisodesSection title={title} onChanged={load} />
      <VerbatiimPanel title={title} onChanged={load} />
    </div>
  );
}

/** For Blu or ex-Blu titles: request removal (or make private) instead of deleting. */
function RemovalRequestPanel({
  title,
  onRequested,
  setNotice,
}: {
  title: StudioTitleDetail;
  onRequested: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (title.removalRequested) {
    return (
      <aside className="notice" role="note">
        Your removal request for this title is open and under review by Sweam.
      </aside>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/api/studio/titles/${title.id}/removal-request`, { reason });
      setNotice('Removal request sent. Sweam will review it.');
      setOpen(false);
      setReason('');
      await onRequested();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="notice" role="note">
      <p>
        <strong>
          {title.isBlu
            ? 'This is Sweam Blu content, so it cannot be deleted.'
            : 'This title was Sweam Blu before, so it cannot be deleted. You can make it private using Unpublish above.'}
        </strong>{' '}
        To take it down, send Sweam a removal request with a reason.
      </p>
      {open ? (
        <form onSubmit={submit} className="studio-form">
          <div className="field">
            <label htmlFor="removal-reason">Reason for removal</label>
            <textarea
              id="removal-reason"
              rows={3}
              required
              minLength={10}
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
          <div className="title-actions">
            <button type="submit" className="button" disabled={busy || reason.trim().length < 10}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button type="button" className="button button-quiet" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="button button-quiet" onClick={() => setOpen(true)}>
          Request removal
        </button>
      )}
    </aside>
  );
}

function TitleEditForm({ title, onSaved }: { title: StudioTitleDetail; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(title.name);
  const [kind, setKind] = useState<string>(title.kind);
  const [genre, setGenre] = useState<string>(title.genre);
  const [advisory, setAdvisory] = useState<string>(title.advisory);
  const [synopsis, setSynopsis] = useState(title.synopsis);
  const [scoutable, setScoutable] = useState(title.scoutable);
  const [allowDownload, setAllowDownload] = useState(title.allowDownload);
  const [posterUrl, setPosterUrl] = useState(title.posterUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!posterUrl) {
      setError('Upload cover art for this title. It is the artwork viewers see.');
      return;
    }
    setSubmitting(true);
    try {
      await apiSend('PATCH', `/api/studio/titles/${title.id}`, {
        name,
        kind,
        genre,
        advisory,
        synopsis,
        scoutable,
        allowDownload: title.isBlu ? false : allowDownload,
        posterUrl,
      });
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="edit-title-heading">
      <h2 id="edit-title-heading">Details</h2>
      <form onSubmit={handleSubmit} noValidate className="studio-form">
        <div className="field">
          <label htmlFor="edit-name">Name</label>
          <input
            id="edit-name"
            type="text"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="edit-kind">Kind</label>
            <select id="edit-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              {CONTENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {CONTENT_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-genre">Genre</label>
            <select id="edit-genre" value={genre} onChange={(event) => setGenre(event.target.value)}>
              {GENRES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-advisory">Advisory</label>
            <select
              id="edit-advisory"
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
        <CoverArtField label="Cover art" value={posterUrl} onChange={setPosterUrl} required />
        <div className="field">
          <label htmlFor="edit-synopsis">Synopsis</label>
          <textarea
            id="edit-synopsis"
            rows={3}
            maxLength={2000}
            value={synopsis}
            onChange={(event) => setSynopsis(event.target.value)}
          />
        </div>
        <div className="field field-checkbox">
          <input
            id="edit-scoutable"
            type="checkbox"
            checked={scoutable}
            aria-describedby="edit-scoutable-hint"
            onChange={(event) => setScoutable(event.target.checked)}
          />
          <label htmlFor="edit-scoutable">Visible in the scout portal</label>
          <p className="field-hint" id="edit-scoutable-hint">
            Opt in to let vetted network and studio scouts see this title's momentum stats and
            retention curves. You will see every one-sheet view and interest in Analytics.
          </p>
        </div>
        <div className="field field-checkbox">
          <input
            id="edit-download"
            type="checkbox"
            checked={allowDownload && !title.isBlu}
            disabled={title.isBlu}
            aria-describedby="edit-download-hint"
            onChange={(event) => setAllowDownload(event.target.checked)}
          />
          <label htmlFor="edit-download">Allow viewers to download and share this video off Sweam</label>
          <p className="field-hint" id="edit-download-hint">
            {title.isBlu
              ? 'Sweam Blu content can’t be downloaded or shared off the platform.'
              : 'Lets viewers download the video file and share it off Sweam. Off by default — sharing the Sweam link is always available.'}
          </p>
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="status" role="status">
            Saved.
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save details'}
        </button>
      </form>
    </section>
  );
}

/**
 * Sweam Blu control: the creator makes an explicit Free/Blu choice and, for Blu,
 * picks one of the preset monthly prices. The server enforces the switch cooldown
 * and notifies affected viewers.
 */
function BluPanel({
  title,
  onChanged,
  setNotice,
}: {
  title: StudioTitleDetail;
  onChanged: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<'free' | 'blu'>('free');
  const [tierId, setTierId] = useState<string>(BLU_TIERS[3]?.id ?? 'blu_999');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ isBlu: boolean; bluPriceCents: number | null }>(
      `/api/titles/${encodeURIComponent(title.slug)}`,
    )
      .then((t) => {
        setMode(t.isBlu ? 'blu' : 'free');
        const tier = bluTierByCents(t.bluPriceCents);
        if (tier) setTierId(tier.id);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [title.slug]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'blu' ? { isBlu: true, tierId } : { isBlu: false };
      const res = await apiSend<{ isBlu: boolean; changed: boolean }>(
        'PUT',
        `/api/blu/titles/${title.id}`,
        body,
      );
      setNotice(
        !res.changed
          ? 'No change to the Blu setting.'
          : res.isBlu
            ? 'This title is now Sweam Blu. Your followers were notified it is no longer free.'
            : 'This title is now free. Your subscribers were notified.',
      );
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the Blu setting.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="blu-heading" className="blu-panel">
      <h2 id="blu-heading">Sweam Blu</h2>
      <p className="field-hint">
        Choose whether this title is Free or Sweam Blu (paid). You must pick one. On Blu you keep 80%
        of the revenue and all sales are final. Prices are preset — no custom amounts. You can switch
        a title between Free and Blu at most once every {BLU_SWITCH_COOLDOWN_DAYS} days, and viewers
        are notified when it changes.
      </p>
      {!loaded ? (
        <p className="status" role="status">
          Loading…
        </p>
      ) : (
        <form
          className="studio-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="field field-checkbox">
            <input
              type="radio"
              id="blu-free"
              name="blu-mode"
              checked={mode === 'free'}
              onChange={() => setMode('free')}
            />
            <label htmlFor="blu-free">Free — anyone can watch</label>
          </div>
          <div className="field field-checkbox">
            <input
              type="radio"
              id="blu-paid"
              name="blu-mode"
              checked={mode === 'blu'}
              onChange={() => setMode('blu')}
            />
            <label htmlFor="blu-paid">Sweam Blu — subscribers only</label>
          </div>
          {mode === 'blu' && (
            <div className="field">
              <label htmlFor="blu-tier">Monthly price (choose a preset)</label>
              <select id="blu-tier" value={tierId} onChange={(event) => setTierId(event.target.value)}>
                {BLU_TIERS.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && (
            <p className="status status-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Saving…' : 'Save Blu setting'}
          </button>
        </form>
      )}
    </section>
  );
}

/** One line summarizing where an episode sits in the media pipeline. */
function pipelineLabel(episode: StudioEpisode): string | null {
  if (episode.transcode) {
    switch (episode.transcode.status) {
      case 'queued':
        return 'HLS: queued';
      case 'running':
        return 'HLS: processing';
      case 'done':
        return 'HLS ready';
      case 'failed':
        return `HLS failed${episode.transcode.error ? `: ${episode.transcode.error}` : ''}`;
      case 'canceled':
        return null;
    }
  }
  return episode.sourceUrl ? null : 'external source';
}

function EpisodesSection({
  title,
  onChanged,
}: {
  title: StudioTitleDetail;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<StudioEpisode | null>(null);

  async function deleteEpisode(episode: StudioEpisode) {
    const confirmed = window.confirm(`Delete episode “${episode.name}”? This cannot be undone.`);
    if (!confirmed) return;
    await apiSend('DELETE', `/api/studio/episodes/${episode.id}`);
    if (editing?.id === episode.id) setEditing(null);
    await onChanged();
  }

  async function retryTranscode(episode: StudioEpisode) {
    await apiSend('POST', `/api/studio/episodes/${episode.id}/transcode`);
    await onChanged();
  }

  return (
    <section aria-labelledby="episodes-heading">
      <h2 id="episodes-heading">Episodes</h2>
      {title.episodes.length === 0 ? (
        <p>No episodes yet. A title needs at least one episode before it can be published.</p>
      ) : (
        <ol className="episode-list">
          {title.episodes.map((episode) => (
            <li key={episode.id}>
              <div className="episode-row">
                <div>
                  <h3>
                    S{episode.season} E{episode.episode}: {episode.name}
                  </h3>
                  <p className="episode-synopsis">
                    {formatDuration(episode.durationS)}
                    {episode.captionsUrl ? ' · captions attached' : ' · no captions'}
                    {pipelineLabel(episode) ? ` · ${pipelineLabel(episode)}` : ''}
                    {episode.releaseAt
                      ? episode.released
                        ? ` · released ${formatReleaseDate(episode.releaseAt)}`
                        : ` · scheduled for ${formatReleaseDate(episode.releaseAt)} at 12:00 AM Eastern`
                      : ''}
                  </p>
                </div>
                <div className="episode-actions">
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => setEditing(episode)}
                  >
                    Edit
                  </button>
                  {episode.transcode?.status === 'failed' && (
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => retryTranscode(episode)}
                    >
                      Retry transcode
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => deleteEpisode(episode)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <ReplacementRequest episodeId={episode.id} />
            </li>
          ))}
        </ol>
      )}

      <EpisodeForm
        key={editing?.id ?? 'new'}
        titleId={title.id}
        episode={editing}
        onDone={async () => {
          setEditing(null);
          await onChanged();
        }}
        onCancelEdit={() => setEditing(null)}
      />
    </section>
  );
}

/**
 * Submit a replacement video for a live episode for an admin to swap in. (You can
 * also replace the video yourself by editing the episode; this is the
 * admin-reviewed path — the title, episode, and URL stay the same either way.)
 */
function ReplacementRequest({ episodeId }: { episodeId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setStatus('Uploading…');
    try {
      const { url } = await uploadMedia(file, (progress) => setStatus(progress.message));
      await apiSend('POST', `/api/studio/episodes/${episodeId}/replace-request`, {
        sourceUrl: url,
        note: note.trim(),
      });
      setStatus('Submitted. An admin will review it and swap it in.');
      setFile(null);
      setNote('');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not submit the replacement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="replace-request">
      <summary>Request a video replacement</summary>
      <p className="field-hint">
        Upload a new video for this episode for an admin to swap in. The episode and its link stay
        the same — no new submission.
      </p>
      <div className="field">
        <label htmlFor={`replace-${episodeId}`}>Replacement video (MP4 or WebM)</label>
        <input
          id={`replace-${episodeId}`}
          type="file"
          accept="video/mp4,video/webm"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <div className="field">
        <label htmlFor={`replace-note-${episodeId}`}>Note for the admin (optional)</label>
        <input
          id={`replace-note-${episodeId}`}
          type="text"
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <button type="button" className="button" onClick={() => void submit()} disabled={!file || busy}>
        {busy ? 'Submitting…' : 'Submit for admin review'}
      </button>
      {status && (
        <p className="field-hint" role="status">
          {status}
        </p>
      )}
    </details>
  );
}

function EpisodeForm({
  titleId,
  episode,
  onDone,
  onCancelEdit,
}: {
  titleId: string;
  episode: StudioEpisode | null;
  onDone: () => Promise<void>;
  onCancelEdit: () => void;
}) {
  const [season, setSeason] = useState(episode?.season ?? 1);
  const [episodeNumber, setEpisodeNumber] = useState(episode?.episode ?? 1);
  const [name, setName] = useState(episode?.name ?? '');
  const [synopsis, setSynopsis] = useState(episode?.synopsis ?? '');
  const [videoUrl, setVideoUrl] = useState(episode?.videoUrl ?? '');
  const [captionsUrl, setCaptionsUrl] = useState(episode?.captionsUrl ?? '');
  const [durationS, setDurationS] = useState(episode?.durationS ?? 0);
  // Scheduled release day (YYYY-MM-DD, Eastern); empty = available as soon as the title is live.
  const [releaseDate, setReleaseDate] = useState(episode?.releaseAt ? easternDay(episode.releaseAt) : '');
  // Episode cover art (mandatory).
  const [thumbnailUrl, setThumbnailUrl] = useState(episode?.thumbnailUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isEdit = episode !== null;

  async function handleUpload(file: File, target: 'video' | 'captions') {
    setError(null);
    try {
      // Large files go multipart with resume; progress lands in the status line.
      const { url } = await uploadMedia(file, (progress) => setUploadState(progress.message));
      if (target === 'video') {
        setVideoUrl(url);
        setUploadState(
          `Uploaded ${file.name}. It will be transcoded to adaptive HLS after you save the episode.`,
        );
      } else {
        setCaptionsUrl(url);
      }
    } catch (err) {
      setUploadState('');
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    }
  }

  function detectDuration() {
    if (!videoUrl) {
      setError('Set a video URL first.');
      return;
    }
    setUploadState('Detecting duration…');
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = videoUrl;
    probe.onloadedmetadata = () => {
      setDurationS(Math.round(probe.duration));
      setUploadState(`Detected ${formatDuration(probe.duration)}.`);
      probe.src = '';
    };
    probe.onerror = () => {
      setUploadState('');
      setError('Could not read the video metadata from that URL.');
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!thumbnailUrl) {
      setError('Upload cover art for this episode. Every episode needs its own cover.');
      return;
    }
    setSubmitting(true);
    const body = {
      season,
      episode: episodeNumber,
      name,
      synopsis,
      videoUrl,
      captionsUrl: captionsUrl || null,
      durationS,
      releaseDate: releaseDate || null,
      thumbnailUrl,
    };
    try {
      if (isEdit && episode) {
        await apiSend('PATCH', `/api/studio/episodes/${episode.id}`, body);
      } else {
        await apiSend('POST', `/api/studio/titles/${titleId}/episodes`, body);
      }
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the episode.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="studio-form">
      <h3>{isEdit ? `Editing S${episode.season} E${episode.episode}` : 'Add episode'}</h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="ep-season">Season</label>
          <input
            id="ep-season"
            type="number"
            min={1}
            max={100}
            value={season}
            onChange={(event) => setSeason(Number(event.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="ep-number">Episode</label>
          <input
            id="ep-number"
            type="number"
            min={1}
            max={500}
            value={episodeNumber}
            onChange={(event) => setEpisodeNumber(Number(event.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="ep-duration">Duration (seconds)</label>
          <input
            id="ep-duration"
            type="number"
            min={0}
            max={86400}
            value={durationS}
            onChange={(event) => setDurationS(Number(event.target.value))}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ep-name">Episode name</label>
        <input
          id="ep-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ep-synopsis">Episode synopsis</label>
        <textarea
          id="ep-synopsis"
          rows={2}
          maxLength={2000}
          value={synopsis}
          onChange={(event) => setSynopsis(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ep-video-url">Video URL</label>
        <input
          id="ep-video-url"
          type="text"
          required
          aria-describedby="ep-video-hint"
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
        />
        <p className="field-hint" id="ep-video-hint">
          Paste an https URL, or upload a file below to fill this in automatically.
        </p>
      </div>
      <div className="field">
        <label htmlFor="ep-video-file">Upload video (MP4 or WebM, up to 512 MB)</label>
        <input
          id="ep-video-file"
          type="file"
          accept="video/mp4,video/webm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file, 'video');
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="ep-captions-url">Captions URL (WebVTT, optional)</label>
        <input
          id="ep-captions-url"
          type="text"
          value={captionsUrl}
          onChange={(event) => setCaptionsUrl(event.target.value)}
        />
      </div>
      <CoverArtField
        label="Episode cover art"
        value={thumbnailUrl}
        onChange={setThumbnailUrl}
        required
        portrait={false}
        hint="JPEG, PNG, or WebP, up to 10 MB; landscape works best. Shown in the episode list and on the watch page."
      />
      <div className="field">
        <label htmlFor="ep-release-date">Release date (optional)</label>
        <input
          id="ep-release-date"
          type="date"
          value={releaseDate}
          onChange={(event) => setReleaseDate(event.target.value)}
          aria-describedby="ep-release-hint"
        />
        <p className="field-hint" id="ep-release-hint">
          Viewers see the episode listed with its date and can ask to be notified; it unlocks for
          streaming at 12:00 AM Eastern on that day. Leave empty to make it available as soon as
          the title is live.
        </p>
      </div>
      <div className="field">
        <label htmlFor="ep-captions-file">Upload captions (.vtt)</label>
        <input
          id="ep-captions-file"
          type="file"
          accept="text/vtt,.vtt"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file, 'captions');
          }}
        />
      </div>
      <div className="title-actions">
        <button type="button" className="button button-quiet" onClick={detectDuration}>
          Detect duration from video
        </button>
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save episode' : 'Add episode'}
        </button>
        {isEdit && (
          <button type="button" className="button button-quiet" onClick={onCancelEdit}>
            Cancel edit
          </button>
        )}
      </div>
      {uploadState && (
        <p className="status" role="status">
          {uploadState}
        </p>
      )}
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
