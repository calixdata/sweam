import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { WatchPayload } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { formatDuration, usePageTitle } from '../hooks';

/** Send a resume beacon at most this often while playing. */
const BEACON_INTERVAL_MS = 10_000;

/**
 * The player deliberately uses the browser's native video controls: they are
 * the most screen-reader- and keyboard-accessible controls available, for
 * free. We add resume, captions, a transcript link, and progress beacons
 * around them rather than replacing them.
 */
export function Watch() {
  const { episodeId } = useParams<{ episodeId: string }>();
  const { user, loading: authLoading } = useAuth();
  const [payload, setPayload] = useState<WatchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastBeaconAt = useRef(0);
  const resumeApplied = useRef(false);

  usePageTitle(payload ? `${payload.title.name}: ${payload.episode.name}` : 'Watch');

  useEffect(() => {
    if (!episodeId || authLoading) return;
    let cancelled = false;
    resumeApplied.current = false;
    apiGet<WatchPayload>(`/api/watch/${encodeURIComponent(episodeId)}`)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this episode.');
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId, authLoading, user?.id]);

  const sendProgress = useCallback(
    (force: boolean) => {
      const video = videoRef.current;
      if (!video || !user || !episodeId) return;
      const now = Date.now();
      if (!force && now - lastBeaconAt.current < BEACON_INTERVAL_MS) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      lastBeaconAt.current = now;
      const body = JSON.stringify({ positionS: video.currentTime, durationS: video.duration });
      // sendBeacon survives page unload; fall back to fetch for older browsers.
      const url = `/api/watch/${encodeURIComponent(episodeId)}/progress`;
      if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) {
        void fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        });
      }
    },
    [user, episodeId],
  );

  // Flush a final beacon when the viewer navigates away or closes the tab.
  useEffect(() => {
    const flush = () => sendProgress(true);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [sendProgress]);

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video || !payload || resumeApplied.current) return;
    resumeApplied.current = true;
    // Resume midway, but never inside the final seconds of the runtime.
    if (payload.positionS > 5 && payload.positionS < video.duration - 10) {
      video.currentTime = payload.positionS;
      setAnnouncement(`Resumed at ${formatDuration(payload.positionS)}.`);
    }
  }

  function skip(deltaS: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, video.currentTime + deltaS), video.duration || Infinity);
    setAnnouncement(`${deltaS > 0 ? 'Forward' : 'Back'} to ${formatDuration(video.currentTime)}.`);
  }

  if (error) return <ErrorNote message={error} />;
  if (!payload) return <Loading label="Loading episode" />;

  const { episode, title, nextEpisode } = payload;
  const isSeries = title.kind === 'series';

  return (
    <div className="page page-narrow">
      <header className="watch-header">
        <h1>
          {title.name}
          {isSeries ? `: S${episode.season} E${episode.episode} ${episode.name}` : ''}
        </h1>
        <p className="title-meta">
          by {title.creator.displayName} (@{title.creator.handle}) ·{' '}
          <Link to={`/t/${title.slug}`}>Title page</Link>
        </p>
      </header>

      {/* Native controls carry the primary keyboard/SR experience. */}
      <video
        ref={videoRef}
        className="player"
        src={episode.videoUrl}
        controls
        preload="metadata"
        aria-label={`${title.name}: ${episode.name}`}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={() => sendProgress(true)}
        onEnded={() => sendProgress(true)}
        onTimeUpdate={() => sendProgress(false)}
      >
        {episode.captionsUrl && (
          <track
            kind="captions"
            src={episode.captionsUrl}
            srcLang="en"
            label="English captions"
            default
          />
        )}
        Your browser does not support HTML video.
      </video>

      <div className="player-extras">
        <button type="button" className="button button-quiet" onClick={() => skip(-10)}>
          Back 10 seconds
        </button>
        <button type="button" className="button button-quiet" onClick={() => skip(10)}>
          Forward 10 seconds
        </button>
        {episode.captionsUrl && (
          <a className="button button-quiet" href={episode.captionsUrl}>
            Transcript (WebVTT)
          </a>
        )}
        {nextEpisode && (
          <Link className="button" to={`/watch/${nextEpisode.id}`}>
            Next: E{nextEpisode.episode} {nextEpisode.name}
          </Link>
        )}
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {!user && (
        <p className="status">
          <Link to="/signin" state={{ from: `/watch/${episode.id}` }}>
            Sign in
          </Link>{' '}
          to save your place and keep watching across devices.
        </p>
      )}

      {episode.synopsis && <p className="episode-synopsis">{episode.synopsis}</p>}
    </div>
  );
}
