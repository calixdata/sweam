import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminTitleEpisodes, AdminVideoReplacement } from '@sweam/shared';
import { UPLOAD_SPECS } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { Loading } from '../components/Status';
import { usePageTitle } from '../hooks';
import { uploadMedia } from '../upload';

/**
 * Admin video tools: swap any episode's live video for a new file in place (same
 * title, episode, and URL — no fresh submission), and review the replacement
 * videos creators submit for approval.
 */
export function AdminVideo() {
  usePageTitle('Video');
  const { user, loading } = useAuth();

  if (loading) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>Video</h1>
        <p>This area is for Sweam administrators.</p>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <p>
        <Link to="/admin">Back to Admin</Link>
      </p>
      <h1>Video replacement</h1>
      <p className="page-intro">
        Swap a live episode's video for a new file without a fresh submission — the title, episode,
        and watch history stay the same, and the new file re-processes to adaptive HLS. Below that,
        review replacement videos creators have submitted.
      </p>
      <SwapTool />
      <ReplacementRequests />
    </div>
  );
}

function SwapTool() {
  const [slug, setSlug] = useState('');
  const [data, setData] = useState<AdminTitleEpisodes | null>(null);
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  async function loadEpisodes() {
    setError(null);
    setNotice('');
    setData(null);
    try {
      setData(await apiGet<AdminTitleEpisodes>(`/api/admin/titles/${encodeURIComponent(slug.trim())}/episodes`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load that title.');
    }
  }

  async function swap(episodeId: string, label: string) {
    const file = files[episodeId];
    if (!file) return;
    if (!window.confirm(`Replace the video for ${label} with "${file.name}"? This changes the live episode immediately.`)) {
      return;
    }
    setBusy(episodeId);
    setNotice('');
    setError(null);
    try {
      // Large episodes exceed the Worker body limit, so this uploads in parts.
      const { url } = await uploadMedia(file, (p) => setNotice(p.message), '/api/admin/upload');
      await apiSend('POST', `/api/admin/episodes/${episodeId}/replace-video`, {
        sourceUrl: url,
        captionsUrl: null,
      });
      setNotice(`Swapped ${label}. The new video is live and re-processing to HLS.`);
      setFiles((prev) => ({ ...prev, [episodeId]: undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not swap the video.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="swap-heading">
      <h2 id="swap-heading">Swap a video</h2>
      <div className="field-inline">
        <input
          type="text"
          aria-label="Title slug"
          placeholder="Title slug (e.g. scion-saga)"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
        <button type="button" className="button" onClick={() => void loadEpisodes()} disabled={!slug.trim()}>
          Load episodes
        </button>
      </div>
      <p className="field-hint">
        The slug is the last part of the title's URL, e.g. sweam.co/t/<strong>scion-saga</strong>.
      </p>

      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="status status-ok" role="status">
          {notice}
        </p>
      )}

      {data && (
        <>
          <h3>
            {data.title.name}{' '}
            {data.title.creatorHandle ? `(@${data.title.creatorHandle})` : ''}
          </h3>
          {data.episodes.length === 0 ? (
            <p>This title has no episodes.</p>
          ) : (
            <ul className="interest-list">
              {data.episodes.map((ep) => {
                const label = `S${ep.season} E${ep.episode}: ${ep.name}`;
                return (
                  <li key={ep.id}>
                    <h4>{label}</h4>
                    <div className="field">
                      <label htmlFor={`file-${ep.id}`}>Replacement video</label>
                      <input
                        id={`file-${ep.id}`}
                        type="file"
                        accept={UPLOAD_SPECS.video.accept}
                        disabled={busy === ep.id}
                        onChange={(event) =>
                          setFiles((prev) => ({ ...prev, [ep.id]: event.target.files?.[0] }))
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="button"
                      onClick={() => void swap(ep.id, label)}
                      disabled={!files[ep.id] || busy === ep.id}
                    >
                      {busy === ep.id ? 'Swapping…' : 'Upload & swap'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function ReplacementRequests() {
  const [requests, setRequests] = useState<AdminVideoReplacement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setRequests((await apiGet<{ replacements: AdminVideoReplacement[] }>('/api/admin/video-replacements')).replacements);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load replacement requests.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, apply: boolean) {
    setBusy(id);
    setNotice('');
    try {
      await apiSend('POST', `/api/admin/video-replacements/${id}/decide`, { apply });
      setNotice(apply ? 'Applied — the episode is re-processing.' : 'Request rejected.');
      await load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not update the request.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="requests-heading">
      <h2 id="requests-heading">Replacement requests</h2>
      {error ? (
        <p className="status status-error" role="alert">
          {error}
        </p>
      ) : !requests ? (
        <p>Loading…</p>
      ) : requests.length === 0 ? (
        <p>No replacement requests awaiting review.</p>
      ) : (
        <ul className="interest-list">
          {requests.map((r) => (
            <li key={r.id}>
              <h3>
                {r.title.name} — S{r.episode.season} E{r.episode.episode}: {r.episode.name}
              </h3>
              <p>
                From @{r.creator.handle ?? r.creator.displayName} · {r.createdAt.slice(0, 10)}
                {r.note ? ` · "${r.note}"` : ''}
              </p>
              <p>
                <a href={r.sourceUrl} target="_blank" rel="noreferrer">
                  Preview the submitted video
                </a>
              </p>
              <div className="episode-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void decide(r.id, true)}
                  disabled={busy === r.id}
                >
                  {busy === r.id ? 'Working…' : 'Apply swap'}
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => void decide(r.id, false)}
                  disabled={busy === r.id}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
