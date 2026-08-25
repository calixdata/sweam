import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { EpisodeSummary, StudioTitleDetail } from '@sweam/shared';
import { ADVISORIES, CONTENT_KINDS, CONTENT_KIND_LABELS, GENRES } from '@sweam/shared';
import { ApiError, apiGet, apiSend, apiUpload } from '../api';
import { ErrorNote, Loading } from '../components/Status';
import { formatDuration, usePageTitle } from '../hooks';

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

      <div className="title-actions">
        <button type="button" className="button" onClick={togglePublish}>
          {title.published ? 'Unpublish' : 'Publish'}
        </button>
        <button type="button" className="button button-danger" onClick={deleteTitle}>
          Delete title
        </button>
      </div>

      <TitleEditForm title={title} onSaved={load} />
      <EpisodesSection title={title} onChanged={load} />
    </div>
  );
}

function TitleEditForm({ title, onSaved }: { title: StudioTitleDetail; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(title.name);
  const [kind, setKind] = useState<string>(title.kind);
  const [genre, setGenre] = useState<string>(title.genre);
  const [advisory, setAdvisory] = useState<string>(title.advisory);
  const [synopsis, setSynopsis] = useState(title.synopsis);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      await apiSend('PATCH', `/api/studio/titles/${title.id}`, {
        name,
        kind,
        genre,
        advisory,
        synopsis,
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

function EpisodesSection({
  title,
  onChanged,
}: {
  title: StudioTitleDetail;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<EpisodeSummary | null>(null);

  async function deleteEpisode(episode: EpisodeSummary) {
    const confirmed = window.confirm(`Delete episode “${episode.name}”? This cannot be undone.`);
    if (!confirmed) return;
    await apiSend('DELETE', `/api/studio/episodes/${episode.id}`);
    if (editing?.id === episode.id) setEditing(null);
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
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => deleteEpisode(episode)}
                  >
                    Delete
                  </button>
                </div>
              </div>
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

function EpisodeForm({
  titleId,
  episode,
  onDone,
  onCancelEdit,
}: {
  titleId: string;
  episode: EpisodeSummary | null;
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
  const [error, setError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isEdit = episode !== null;

  async function handleUpload(file: File, target: 'video' | 'captions') {
    setUploadState(`Uploading ${file.name}…`);
    setError(null);
    try {
      const { url } = await apiUpload(file);
      if (target === 'video') setVideoUrl(url);
      else setCaptionsUrl(url);
      setUploadState(`Uploaded ${file.name}.`);
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
    setSubmitting(true);
    const body = {
      season,
      episode: episodeNumber,
      name,
      synopsis,
      videoUrl,
      captionsUrl: captionsUrl || null,
      durationS,
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
