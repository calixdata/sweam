/**
 * D-pad spatial navigation. Arrow keys move focus between the visible
 * elements marked data-tv-focus by comparing screen geometry: the nearest
 * element in the pressed direction wins, with off-axis drift penalized so
 * focus tracks rows and columns the way TV interfaces are expected to.
 * Enter/OK activates natively (every focusable is a real <button>), which
 * keeps the whole app usable with a keyboard and honest for screen readers.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function arrowDirection(event: KeyboardEvent): Direction | null {
  return ARROWS[event.key] ?? null;
}

/** Remote back buttons: web, Samsung Tizen (10009) and LG webOS (461). */
export function isBackKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'Escape' ||
    event.key === 'Backspace' ||
    event.key === 'GoBack' ||
    event.key === 'BrowserBack' ||
    event.key === 'XF86Back' ||
    event.keyCode === 10009 ||
    event.keyCode === 461
  );
}

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tv-focus]')).filter(
    (el) => el.offsetParent !== null && !el.hasAttribute('disabled'),
  );
}

/** Focus the first focusable on screen (used when a screen mounts). */
export function focusFirst(): boolean {
  const [first] = focusables();
  if (!first) return false;
  first.focus();
  return true;
}

/** Move focus in a direction. Returns true when focus moved (consume the key). */
export function moveFocus(direction: Direction): boolean {
  const candidates = focusables();
  if (candidates.length === 0) return false;

  const active = document.activeElement as HTMLElement | null;
  if (!active || !active.hasAttribute('data-tv-focus')) {
    const first = candidates[0];
    if (!first) return false;
    first.focus();
    return true;
  }

  const from = active.getBoundingClientRect();
  const fromX = (from.left + from.right) / 2;
  const fromY = (from.top + from.bottom) / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of candidates) {
    if (el === active) continue;
    const rect = el.getBoundingClientRect();
    const dx = (rect.left + rect.right) / 2 - fromX;
    const dy = (rect.top + rect.bottom) / 2 - fromY;
    const towards =
      direction === 'left' ? dx < -1 : direction === 'right' ? dx > 1 : direction === 'up' ? dy < -1 : dy > 1;
    if (!towards) continue;
    const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
    const cross = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (!best) return false;
  best.focus();
  best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}
