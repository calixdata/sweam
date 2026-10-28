import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WatchPayload } from '@sweam/shared';
import { ApiError, beaconProgress, getWatch } from '../api';
import { arrowDirection, focusFirst, isBackKey } from '../focus';

const SEEK_S = 10;
const BEACON_INTERVAL_MS = 10_000;
const NEXT_COUNTDOWN_S = 6;
const OVERLAY_HIDE_MS = 5_000;

interface PlayerScreenProps {
  episodeId: string;
  announce: (message: string) => void;
  onBack: () => void;
  onNext: (episodeId: string) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * The player. With the overlay hidden, Enter toggles play, left/right seek,
 * and up/down raise the overlay; with it up, arrows move focus between real
 * buttons and Back hides it again. Progress beacons use the same endpoint and
 * cadence as the website, so the couch, the phone, and the web share resume.
 */
export function PlayerScreen({ episodeId, announce, onBack, onNext }: PlayerScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const payloadRef = useRef<WatchPayload | null>(null);
  const [payload, setPayload] = useState<WatchPayload | null>(null);
  const [error, setError] = useState('');
  const [overlay, setOverlay] = useState(true);
  const [paused, setPaused] = useState(true);
  const [timeLabel, setTimeLabel] = useState('');
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(NEXT_COUNTDOWN_S);

  // Load the watch payload (fresh per episode; onNext reuses this screen).
  useEffect(() => {
    let cancelled = false;
    payloadRef.current = null;
    setPayload(null);
    setError('');
    setEnded(false);
    setOverlay(true);
    setCountdown(NEXT_COUNTDOWN_S);
    setTimeLabel('');
    void (async () => {
      try {
        const data = await getWatch(episodeId);
        if (cancelled) return;
        if (!data.episode.videoUrl) {
          setError('This episode has not released yet.');
          return;
        }
        payloadRef.current = data;
        setPayload(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load this episode.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  useEffect(() => {
    if (error) focusFirst();
  }, [error]);

  // Attach the media. HLS plays through hls.js when the runtime needs it.
  useEffect(() => {
    const video = videoRef.current;
    if (!payload || !video) return;
    const src = payload.episode.videoUrl;
    let hls: Hls | null = null;
    if (src.endsWith('.m3u8') && !video.canPlayType('application/vnd.apple.mpegurl')) {
      if (!Hls.isSupported()) {
        setError('This TV cannot play this video format.');
        return;
      }
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('Could not play this video. Press Back and try again.');
      });
    } else {
      video.src = src;
    }
    const onLoaded = () => {
      if (payload.positionS > 5 && payload.positionS < video.duration - 15) {
        video.currentTime = payload.positionS;
        announce(`Resuming from ${formatTime(payload.positionS)}.`);
      }
      void video.play().catch(() => setPaused(true));
    };
    video.addEventListener('loadedmetadata', onLoaded);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      if (hls) hls.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [payload, announce]);

  const sendBeacon = useCallback(() => {
    const video = videoRef.current;
    const data = payloadRef.current;
    if (!video || !data || !Number.isFinite(video.duration) || video.duration <= 0) return;
    beaconProgress(data.episode.id, Math.floor(video.currentTime), Math.round(video.duration));
  }, []);

  // Beacon cadence + a final beacon when leaving the episode.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) sendBeacon();
    }, BEACON_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      sendBeacon();
    };
  }, [sendBeacon, episodeId]);

  // Mirror the media state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPaused(false);
    const onPause = () => {
      setPaused(true);
      sendBeacon();
    };
    const onEnded = () => {
      sendBeacon();
      setEnded(true);
      setOverlay(false);
    };
    const onTime = () =>
      setTimeLabel(`${formatTime(video.currentTime)} of ${formatTime(video.duration)}`);
    const onError = () => {
      // Only a real source failure counts; teardown fires spurious events.
      if (video.error) setError('Could not play this video. Press Back and try again.');
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('error', onError);
    };
  }, [sendBeacon]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  // When the episode ends: count down to the next one, or leave.
  useEffect(() => {
    if (!ended) return;
    const next = payloadRef.current?.nextEpisode;
    if (!next) {
      announce('Episode finished.');
      onBack();
      return;
    }
    announce(`Episode finished. Next episode starts in ${NEXT_COUNTDOWN_S} seconds.`);
    focusFirst();
    const interval = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(interval);
          onNext(next.id);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [ended, announce, onBack, onNext]);

  // Show the overlay briefly on keys; hide it again while playing.
  useEffect(() => {
    if (!overlay || paused || ended) return;
    const timeout = window.setTimeout(() => setOverlay(false), OVERLAY_HIDE_MS);
    return () => window.clearTimeout(timeout);
  }, [overlay, paused, ended]);

  useEffect(() => {
    if (overlay && !ended) focusFirst();
  }, [overlay, ended]);

  // Player key handling runs in the capture phase, ahead of the app's focus
  // navigation, and consumes only what the player owns.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const video = videoRef.current;
      if (!video || ended) return;
      const direction = arrowDirection(event);
      if (!overlay) {
        if (direction === 'left' || direction === 'right') {
          event.preventDefault();
          event.stopPropagation();
          const delta = direction === 'left' ? -SEEK_S : SEEK_S;
          const limit = Number.isFinite(video.duration) ? video.duration - 0.5 : Number.MAX_SAFE_INTEGER;
          video.currentTime = Math.max(0, Math.min(limit, video.currentTime + delta));
          announce(`${direction === 'left' ? 'Back' : 'Forward'} ${SEEK_S} seconds.`);
          setOverlay(true);
          return;
        }
        if (direction === 'up' || direction === 'down') {
          event.preventDefault();
          event.stopPropagation();
          setOverlay(true);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          togglePlay();
          return;
        }
        return; // Back bubbles to the app, which closes the player.
      }
      if (isBackKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        setOverlay(false);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [overlay, ended, announce, togglePlay]);

  if (error) {
    return (
      <div className="player-wrap">
        <div className="player-message">
          <p className="error-line" role="alert">
            {error}
          </p>
          <div className="button-row" style={{ justifyContent: 'center' }}>
            <button type="button" data-tv-focus className="tv-button primary" onClick={onBack}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const episodeLabel = payload
    ? `S${payload.episode.season} E${payload.episode.episode} — ${payload.episode.name}`
    : '';
  const next = payload?.nextEpisode ?? null;

  return (
    <div className="player-wrap">
      {/* Captions render through the standard text track; the player chrome is
          our own, so the remote drives everything. */}
      <video ref={videoRef} playsInline aria-label={payload ? `${payload.title.name}, ${episodeLabel}` : 'Video player'}>
        {payload?.episode.captionsUrl && (
          <track kind="subtitles" src={payload.episode.captionsUrl} srcLang="en" label="English" default />
        )}
      </video>

      {!payload && (
        <div className="player-message">
          <p className="status-line" role="status">
            Loading…
          </p>
        </div>
      )}

      {payload && overlay && !ended && (
        <div className="player-overlay">
          <h2>
            {payload.title.name}
            {payload.title.kind === 'series' ? ` · ${episodeLabel}` : ''}
          </h2>
          <p className="time" role="status">
            {timeLabel || '0:00'}
            {paused ? ' · Paused' : ''}
          </p>
          <div className="controls button-row">
            <button type="button" data-tv-focus className="tv-button primary" onClick={togglePlay}>
              {paused ? 'Play' : 'Pause'}
            </button>
            {next && (
              <button type="button" data-tv-focus className="tv-button" onClick={() => onNext(next.id)}>
                Next: E{next.episode} {next.name}
              </button>
            )}
            <button type="button" data-tv-focus className="tv-button" onClick={onBack}>
              Back
            </button>
          </div>
        </div>
      )}

      {ended && next && (
        <div className="next-card">
          <p role="status">
            Next: S{next.season} E{next.episode} — {next.name} in {countdown}…
          </p>
          <div className="button-row">
            <button type="button" data-tv-focus className="tv-button primary" onClick={() => onNext(next.id)}>
              Play now
            </button>
            <button type="button" data-tv-focus className="tv-button" onClick={onBack}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
