import { useEffect } from 'react';

/** Sets the document title for the current page. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} • Sweam`;
  }, [title]);
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
