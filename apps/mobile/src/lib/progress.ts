import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { api } from './api';

/** Report the position at most this often while playing (same as the web player). */
export const PROGRESS_INTERVAL_S = 10;

/** The parts of the video player the progress beacon uses. */
export interface ProgressPlayer {
  currentTime: number;
  readonly duration: number;
  readonly status: string;
  timeUpdateEventInterval: number;
  addListener(event: 'timeUpdate' | 'playToEnd', fn: () => void): { remove(): void };
  addListener(event: 'playingChange', fn: (e: { isPlaying: boolean }) => void): { remove(): void };
  addListener(event: 'statusChange', fn: (e: { status: string }) => void): { remove(): void };
}

export interface ProgressOptions {
  resumeS: number;
  send: (body: { positionS: number; durationS: number }) => void;
  onBackground: (fn: () => void) => { remove(): void };
  now?: () => number;
  /** Shared across re-attachments for the same episode: resume only once. */
  state?: { lastSentAt: number; resumed: boolean };
}

/**
 * Attach the progress beacon to a player. Sends every 10 seconds while
 * playing, and right away on pause, at the end, when the app goes to the
 * background and on detach. Resumes once, midway, never in the last seconds.
 * Returns the detach function.
 */
export function attachWatchProgress(player: ProgressPlayer, opts: ProgressOptions): () => void {
  const now = opts.now ?? Date.now;
  const st = opts.state ?? { lastSentAt: 0, resumed: false };

  const send = (force: boolean) => {
    let positionS = 0;
    let durationS = 0;
    try {
      positionS = player.currentTime;
      durationS = player.duration;
    } catch {
      return; // player already released
    }
    if (!Number.isFinite(durationS) || durationS <= 0 || !Number.isFinite(positionS) || positionS < 0) return;
    const t = now();
    if (!force && t - st.lastSentAt < PROGRESS_INTERVAL_S * 1000) return;
    st.lastSentAt = t;
    opts.send({ positionS: Math.min(positionS, durationS), durationS });
  };

  const resume = () => {
    if (st.resumed) return;
    let durationS = 0;
    try {
      durationS = player.duration;
    } catch {
      return;
    }
    if (!Number.isFinite(durationS) || durationS <= 0) return;
    st.resumed = true;
    if (opts.resumeS > 5 && opts.resumeS < durationS - 10) {
      try {
        player.currentTime = opts.resumeS;
      } catch {
        /* player released */
      }
    }
  };

  try {
    player.timeUpdateEventInterval = PROGRESS_INTERVAL_S;
  } catch {
    /* player released */
  }
  const subs = [
    player.addListener('timeUpdate', () => send(false)),
    player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) {
        resume();
        send(false); // the first beacon counts the play
      } else {
        send(true);
      }
    }),
    player.addListener('playToEnd', () => send(true)),
    player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') resume();
    }),
  ];
  try {
    if (player.status === 'readyToPlay') resume();
  } catch {
    /* player released */
  }
  const bg = opts.onBackground(() => send(true));
  return () => {
    send(true);
    for (const s of subs) s.remove();
    bg.remove();
  };
}

/**
 * Watch progress for a signed-in viewer: the same beacon the web player sends
 * (POST /api/watch/:episodeId/progress). It is what counts a play, a
 * completion and watch time, keeps Continue watching up to date, and feeds
 * analytics.
 */
export function useWatchProgress(
  player: VideoPlayer,
  episodeId: string | undefined,
  enabled: boolean,
  resumeS: number,
): void {
  const state = useRef({ lastSentAt: 0, resumed: false });

  useEffect(() => {
    state.current = { lastSentAt: 0, resumed: false };
  }, [episodeId]);

  useEffect(() => {
    if (!enabled || !episodeId) return;
    const path = `/api/watch/${encodeURIComponent(episodeId)}/progress`;
    return attachWatchProgress(player as unknown as ProgressPlayer, {
      resumeS,
      state: state.current,
      send: (body) => void api.post(path, body).catch(() => undefined),
      onBackground: (fn) =>
        AppState.addEventListener('change', (s) => {
          if (s !== 'active') fn();
        }),
    });
  }, [player, episodeId, enabled, resumeS]);
}
