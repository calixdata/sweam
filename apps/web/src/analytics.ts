import { analyticsAllowed } from './consent';

/**
 * First-party analytics client. Sends a minimal, cookieless page-view beacon to
 * the analytics subdomain — only after the visitor has allowed analytics, never
 * when a Do-Not-Track / Global-Privacy-Control signal is set, and only from the
 * real sweam.co origin (so localhost and preview builds stay silent). The
 * payload carries no identifiers: the collector derives a daily, salted,
 * one-way visitor hash server-side and never stores an IP or user agent.
 */

const ENDPOINT = 'https://analytics.sweam.co/collect';

/** Bucket the viewport so the collector never receives a fingerprintable exact size. */
function widthBucket(width: number): string {
  if (width < 640) return 'sm';
  if (width < 1024) return 'md';
  if (width < 1440) return 'lg';
  return 'xl';
}

/** Only the referrer's host leaves the browser, and only when it is another site. */
function referrerHost(): string {
  try {
    if (!document.referrer) return '';
    const url = new URL(document.referrer);
    return url.host === location.host ? '' : url.host.slice(0, 120);
  } catch {
    return '';
  }
}

function tracksThisVisitor(): boolean {
  // Honor browser-level opt-outs even if a stale consent record says otherwise.
  const dnt =
    navigator.doNotTrack === '1' ||
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  if (dnt) return false;
  // Never phone home from local dev, previews, or a self-hosted copy.
  if (!location.hostname.endsWith('sweam.co')) return false;
  return analyticsAllowed();
}

/** Record a single page view for the given app path. Safe to call unconditionally. */
export function trackPageView(path: string): void {
  if (!tracksThisVisitor()) return;
  const payload = JSON.stringify({
    p: path.slice(0, 512),
    r: referrerHost(),
    w: widthBucket(window.innerWidth),
  });
  try {
    // text/plain keeps the beacon a CORS-safelisted request (no preflight);
    // sendBeacon survives the page unloading between route changes.
    const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
    if (navigator.sendBeacon(ENDPOINT, blob)) return;
    void fetch(ENDPOINT, { method: 'POST', body: blob, keepalive: true, mode: 'no-cors' });
  } catch {
    // Analytics must never break navigation.
  }
}
