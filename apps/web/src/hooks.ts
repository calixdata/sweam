import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

/** Sets the document title for the current page. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} • Sweam`;
  }, [title]);
}

/**
 * Double-click (mouse) / double-tap (touch) to fire a callback, TikTok-style.
 * Returns handlers to spread onto an element. Touch double-taps are detected by
 * timing so they work where a synthetic dblclick doesn't. This is a bonus
 * gesture layered over a real, accessible button — never the only way to act.
 */
export function useDoubleTap<T = Element>(
  onDoubleTap: () => void,
  delayMs = 300,
): {
  onDoubleClick: (event: ReactMouseEvent<T>) => void;
  onTouchEnd: (event: ReactTouchEvent<T>) => void;
} {
  const lastTap = useRef(0);
  const onDoubleClick = useCallback(() => {
    onDoubleTap();
  }, [onDoubleTap]);
  const onTouchEnd = useCallback(
    (event: ReactTouchEvent<T>) => {
      const now = Date.now();
      if (now - lastTap.current < delayMs) {
        event.preventDefault();
        lastTap.current = 0;
        onDoubleTap();
      } else {
        lastTap.current = now;
      }
    },
    [onDoubleTap, delayMs],
  );
  return { onDoubleClick, onTouchEnd };
}

/** h:mm:ss for hour-plus runtimes, m:ss below that. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
