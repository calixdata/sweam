import { useCallback, useEffect, useState } from 'react';
import { tvSession } from './api';
import { getDeviceId } from './device';
import { arrowDirection, isBackKey, moveFocus } from './focus';
import { DevicesScreen } from './screens/Devices';
import { HomeScreen } from './screens/Home';
import { PairScreen } from './screens/Pair';
import { PlayerScreen } from './screens/Player';
import { TitleScreen } from './screens/Title';

export interface TvUser {
  username: string | null;
  displayName: string;
}

export type Screen =
  | { kind: 'home' }
  | { kind: 'title'; slug: string }
  | { kind: 'player'; episodeId: string }
  | { kind: 'devices' };

/**
 * SweamTV shell: a screen stack driven entirely by the D-pad. Back pops the
 * stack; the player consumes its own keys first (capture listener). A polite
 * live region narrates screen changes for screen-reader users.
 */
export function App() {
  const [phase, setPhase] = useState<'booting' | 'pair' | 'ready'>('booting');
  const [user, setUser] = useState<TvUser | null>(null);
  const [stack, setStack] = useState<Screen[]>([{ kind: 'home' }]);
  const [announcement, setAnnouncement] = useState('');

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  // Boot: a TV that already paired kept its session cookie; everyone else
  // lands on the pairing screen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await tvSession(getDeviceId());
        if (cancelled) return;
        setUser(result.user);
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('pair');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const push = useCallback((screen: Screen) => {
    setStack((prev) => [...prev, screen]);
  }, []);

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // Global D-pad handling. The player registers a capture-phase listener and
  // prevents default on keys it consumes, so this skips them.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const direction = arrowDirection(event);
      if (direction) {
        if (moveFocus(direction)) event.preventDefault();
        return;
      }
      if (isBackKey(event)) {
        event.preventDefault();
        back();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [back]);

  const top: Screen = stack[stack.length - 1] ?? { kind: 'home' };

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {phase === 'booting' && (
        <main className="tv-root">
          <p className="status-line" role="status">
            Starting SweamTV…
          </p>
        </main>
      )}
      {phase === 'pair' && (
        <PairScreen
          announce={announce}
          onPaired={(pairedUser) => {
            setUser(pairedUser);
            setPhase('ready');
            setStack([{ kind: 'home' }]);
            announce(`Signed in as ${pairedUser.displayName}. Home.`);
          }}
        />
      )}
      {phase === 'ready' && top.kind === 'home' && (
        <HomeScreen
          user={user}
          announce={announce}
          onOpenTitle={(slug) => push({ kind: 'title', slug })}
          onOpenDevices={() => push({ kind: 'devices' })}
        />
      )}
      {phase === 'ready' && top.kind === 'title' && (
        <TitleScreen
          slug={top.slug}
          announce={announce}
          onPlay={(episodeId) => push({ kind: 'player', episodeId })}
          onBack={back}
        />
      )}
      {phase === 'ready' && top.kind === 'player' && (
        <PlayerScreen
          episodeId={top.episodeId}
          announce={announce}
          onBack={back}
          onNext={(episodeId) =>
            setStack((prev) => [...prev.slice(0, -1), { kind: 'player', episodeId }])
          }
        />
      )}
      {phase === 'ready' && top.kind === 'devices' && (
        <DevicesScreen
          user={user}
          announce={announce}
          onBack={back}
          onUnpaired={() => {
            setUser(null);
            setStack([{ kind: 'home' }]);
            setPhase('pair');
            announce('This TV was unpaired. Pair it again to keep watching.');
          }}
        />
      )}
    </>
  );
}
