import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type Hls from 'hls.js';
import type { PrerollAd, WatchPayload } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { formatDuration, usePageTitle } from '../hooks';

/** Send a resume beacon at most this often while playing. */
const BEACON_INTERVAL_MS = 10_000;

/** In-memory fallback when sessionStorage is unavailable (private browsing). */
const viewIdFallback = new Map<string, string>();

/**
 * Anonymous playback session id: random, per episode, per browser session.
 * Never derived from the user, IP, or device, so signed-out plays count in
 * stats without collecting identity.
 */
function getViewId(episodeId: string): string {
  const key = `sweam-view-${episodeId}`;
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    let id = viewIdFallback.get(key);
    if (!id) {
      id = crypto.randomUUID();
      viewIdFallback.set(key, id);
    }
    return id;
  }
}

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
  const [preroll, setPreroll] = useState<PrerollAd | null>(null);
  const [adDone, setAdDone] = useState(false);
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
      if (!video || !episodeId) return;
      const now = Date.now();
      if (!force && now - lastBeaconAt.current < BEACON_INTERVAL_MS) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      lastBeaconAt.current = now;

      // Signed-in viewers get resume via /progress; everyone else counts via
      // the anonymous /view beacon.
      const beacon: Record<string, unknown> = {
        positionS: video.currentTime,
        durationS: video.duration,
      };
      let url = `/api/watch/${encodeURIComponent(episodeId)}/progress`;
      if (!user) {
        url = `/api/watch/${encodeURIComponent(episodeId)}/view`;
        beacon.viewId = getViewId(episodeId);
      }
      const body = JSON.stringify(beacon);
      // sendBeacon survives page unload; fall back to fetch for older browsers.
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

  // Decide the pre-roll slot once per title per browser session. Free
  // catalog, ad-supported: the split is published on the earnings page.
  const titleId = payload?.title.id ?? null;
  useEffect(() => {
    if (!titleId) return;
    const seenKey = `sweam-preroll-${titleId}`;
    let seen = false;
    try {
      seen = sessionStorage.getItem(seenKey) === '1';
    } catch {
      // Session storage unavailable: play the ad; capping is best-effort.
    }
    if (seen) {
      setAdDone(true);
      return;
    }
    let cancelled = false;
    apiGet<{ ad: PrerollAd | null }>(`/api/ads/preroll?titleId=${encodeURIComponent(titleId)}`)
      .then((data) => {
        if (cancelled) return;
        if (data.ad) setPreroll(data.ad);
        else setAdDone(true);
      })
      .catch(() => {
        if (!cancelled) setAdDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [titleId]);

  const videoUrl = adDone ? (payload?.episode.videoUrl ?? null) : null;

  // Attach the source: native for MP4/WebM (and Safari's built-in HLS),
  // hls.js (lazy-loaded) for .m3u8 everywhere else. Runs only after the
  // pre-roll slot resolves so the ad and the feature never race.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    let hls: Hls | null = null;
    let cancelled = false;
    const needsHlsJs =
      videoUrl.endsWith('.m3u8') && video.canPlayType('application/vnd.apple.mpegurl') === '';

    if (needsHlsJs) {
      void import('hls.js').then(({ default: HlsModule }) => {
        if (cancelled) return;
        if (HlsModule.isSupported()) {
          hls = new HlsModule();
          hls.on(HlsModule.Events.ERROR, (_event, data) => {
            if (data.fatal) setAnnouncement('Playback error. Try reloading the page.');
          });
          hls.loadSource(videoUrl);
          hls.attachMedia(video);
        } else {
          setAnnouncement('This browser cannot play adaptive HLS streams.');
        }
      });
    } else {
      video.src = videoUrl;
    }

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      else video.removeAttribute('src');
    };
  }, [videoUrl]);

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

      {preroll && !adDone && (
        <PrerollPlayer
          ad={preroll}
          titleId={title.id}
          onDone={() => {
            try {
              sessionStorage.setItem(`sweam-preroll-${title.id}`, '1');
            } catch {
              // Best-effort capping only.
            }
            setAdDone(true);
            setAnnouncement('Ad finished. Your video is ready to play.');
          }}
        />
      )}

      {/* Native controls carry the primary keyboard/SR experience. The
          feature player mounts after the pre-roll slot resolves. */}
      <video
        ref={videoRef}
        className="player"
        controls
        preload="metadata"
        hidden={!adDone}
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

const AD_SKIPPABLE_AFTER_S = 5;

/**
 * The pre-roll slot. Nothing autoplays: the viewer starts the ad with a
 * button press (which also satisfies browser audio policies), can pause it at
 * any time, and can skip after five seconds. The impression is recorded once,
 * when ad playback actually starts.
 */
function PrerollPlayer({
  ad,
  titleId,
  onDone,
}: {
  ad: PrerollAd;
  titleId: string;
  onDone: () => void;
}) {
  const adRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const impressionSent = useRef(false);

  function start() {
    void adRef.current?.play().catch(() => onDone());
    setStarted(true);
  }

  function togglePause() {
    const video = adRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => undefined);
      setPaused(false);
    } else {
      video.pause();
      setPaused(true);
    }
  }

  function handlePlaying() {
    if (impressionSent.current) return;
    impressionSent.current = true;
    void apiSend('POST', `/api/ads/${ad.id}/impression`, { titleId }).catch(() => undefined);
  }

  function handleTimeUpdate() {
    const video = adRef.current;
    if (!video) return;
    setElapsed(Math.floor(video.currentTime));
    if (video.currentTime >= ad.durationS) onDone();
  }

  const skippable = elapsed >= AD_SKIPPABLE_AFTER_S;

  return (
    <section className="preroll" aria-label="Advertisement">
      <p className="preroll-label">
        Ad: {ad.headline} — {ad.sponsor}. Your video plays after this ad.
      </p>
      <video
        ref={adRef}
        className="player"
        src={ad.mediaUrl}
        preload="auto"
        playsInline
        aria-label={`Advertisement from ${ad.sponsor}`}
        onPlaying={handlePlaying}
        onTimeUpdate={handleTimeUpdate}
        onEnded={onDone}
        onError={onDone}
      />
      <div className="player-extras">
        {!started ? (
          <button type="button" className="button" onClick={start}>
            Play ad, then your video
          </button>
        ) : (
          <>
            <button type="button" className="button button-quiet" onClick={togglePause}>
              {paused ? 'Resume ad' : 'Pause ad'}
            </button>
            <button type="button" className="button button-quiet" disabled={!skippable} onClick={onDone}>
              {skippable ? 'Skip ad' : `Skip ad (in ${AD_SKIPPABLE_AFTER_S - elapsed}s)`}
            </button>
          </>
        )}
        <a className="button button-quiet" href={ad.clickUrl}>
          Learn more about {ad.sponsor}
        </a>
      </div>
    </section>
  );
}
