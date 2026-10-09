import { useEffect, useState } from 'react';

/**
 * Whether the launch animation has handed off to the app. The feed waits for
 * this before it starts playing, so nothing plays (or sounds) under the logo.
 */
let done = false;
const listeners = new Set<() => void>();

export function isIntroDone(): boolean {
  return done;
}

export function markIntroDone(): void {
  if (done) return;
  done = true;
  for (const listener of listeners) listener();
}

export function useIntroDone(): boolean {
  const [value, setValue] = useState(done);
  useEffect(() => {
    if (done) {
      setValue(true);
      return;
    }
    const listener = () => setValue(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}
