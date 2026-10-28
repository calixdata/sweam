import { useCallback, useEffect, useRef, useState } from 'react';
import type { TvPairStart } from '@sweam/shared';
import type { TvUser } from '../App';
import { ApiError, pairPoll, pairStart } from '../api';
import { detectPlatform, setDeviceId } from '../device';
import { focusFirst } from '../focus';

interface PairScreenProps {
  announce: (message: string) => void;
  onPaired: (user: TvUser) => void;
}

/**
 * The pairing screen: show a big code and poll until someone claims it at
 * sweam.co/activate. The poll answer carries the session exactly once (the
 * server also sets the cookie this app rides on).
 */
export function PairScreen({ announce, onPaired }: PairScreenProps) {
  const [pair, setPair] = useState<TvPairStart | null>(null);
  const [state, setState] = useState<'starting' | 'showing' | 'expired' | 'error'>('starting');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  const start = useCallback(async () => {
    setState('starting');
    setMessage('');
    try {
      const result = await pairStart(detectPlatform());
      setDeviceId(result.deviceId);
      setPair(result);
      setState('showing');
      announce(`Your pairing code is ${result.code.split('').join(', ')}.`);
    } catch (err) {
      setState('error');
      setMessage(
        err instanceof ApiError ? err.message : 'Could not reach Sweam. Check the TV’s connection.',
      );
    }
  }, [announce]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  // Poll while the code is on screen.
  useEffect(() => {
    if (state !== 'showing' || !pair) return;
    let cancelled = false;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const result = await pairPoll(pair.deviceId, pair.code);
          if (cancelled) return;
          if (result.status === 'paired') {
            window.clearInterval(interval);
            onPaired(result.user);
          } else if (result.status === 'expired') {
            window.clearInterval(interval);
            setState('expired');
            announce('The pairing code expired. Choose Get a new code.');
          }
        } catch {
          // A dropped poll is not fatal; the next tick tries again.
        }
      })();
    }, Math.max(2, pair.pollSeconds) * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [state, pair, onPaired, announce]);

  // Put focus somewhere useful when a button appears.
  useEffect(() => {
    if (state === 'expired' || state === 'error') focusFirst();
  }, [state]);

  return (
    <main className="tv-root pair-wrap">
      <h1>
        SweamTV
        <span className="sr-only">.</span>
      </h1>
      <p className="pair-tag">AI-generated binge series and films, on your TV.</p>

      {state === 'starting' && (
        <p className="status-line" role="status">
          Getting your pairing code…
        </p>
      )}

      {state === 'showing' && pair && (
        <>
          <div className="pair-code" aria-label={`Pairing code: ${pair.code.split('').join(', ')}`}>
            {pair.code}
          </div>
          <ol className="pair-steps">
            <li>
              On your phone or computer, go to <strong>sweam.co/activate</strong>
            </li>
            <li>Sign in to Sweam (accounts are free)</li>
            <li>Enter the code above</li>
          </ol>
          <p className="status-line" role="status">
            Waiting for the code to be entered… This screen continues by itself.
          </p>
        </>
      )}

      {state === 'expired' && (
        <>
          <p className="status-line" role="alert">
            That code expired.
          </p>
          <button type="button" data-tv-focus className="tv-button primary" onClick={() => void start()}>
            Get a new code
          </button>
        </>
      )}

      {state === 'error' && (
        <>
          <p className="error-line" role="alert">
            {message}
          </p>
          <button type="button" data-tv-focus className="tv-button primary" onClick={() => void start()}>
            Try again
          </button>
        </>
      )}
    </main>
  );
}
