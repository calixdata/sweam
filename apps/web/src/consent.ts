import { useSyncExternalStore } from 'react';

/**
 * Cookie / analytics consent, stored per-browser. Sweam sets exactly one
 * essential cookie (the sign-in session) that needs no consent; the only
 * consented category is first-party analytics, which stays off until the
 * visitor explicitly allows it. The choice lives in localStorage, survives
 * reloads, and is versioned so a materially changed policy can re-ask.
 */

export const CONSENT_VERSION = 1;
const STORAGE_KEY = 'sweam.cookie-consent';

export interface ConsentState {
  /** Whether the visitor allowed first-party analytics. */
  analytics: boolean;
  /** ISO timestamp of the decision. */
  decidedAt: string;
  /** Policy version the decision was made against. */
  version: number;
}

const listeners = new Set<() => void>();

// Cache the parsed value so useSyncExternalStore gets a stable snapshot
// (returning a fresh object every read would loop React forever).
let cache: ConsentState | null = null;
let cacheLoaded = false;

function read(): ConsentState | null {
  if (cacheLoaded) return cache;
  cacheLoaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cache = null);
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof parsed.analytics !== 'boolean' || parsed.version !== CONSENT_VERSION) {
      // Unknown shape or an older policy version: treat as undecided.
      return (cache = null);
    }
    return (cache = {
      analytics: parsed.analytics,
      decidedAt: typeof parsed.decidedAt === 'string' ? parsed.decidedAt : new Date().toISOString(),
      version: CONSENT_VERSION,
    });
  } catch {
    // Private mode or blocked storage: behave as undecided, never throw.
    return (cache = null);
  }
}

/** The current decision, or null if the visitor has not chosen yet. */
export function getConsent(): ConsentState | null {
  return read();
}

/** True once the visitor has made a choice against the current policy version. */
export function hasDecided(): boolean {
  return read() !== null;
}

/** True only when analytics is allowed; false while undecided or declined. */
export function analyticsAllowed(): boolean {
  return read()?.analytics === true;
}

/** Record a decision and notify every subscriber (banner, analytics, policy page). */
export function setConsent(analytics: boolean): void {
  const next: ConsentState = {
    analytics,
    decidedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
  };
  cache = next;
  cacheLoaded = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // If storage is unavailable the choice holds for this page only.
  }
  for (const listener of listeners) listener();
}

/** Clear the decision so the banner reappears (used by "Cookie settings"). */
export function resetConsent(): void {
  cache = null;
  cacheLoaded = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive view of the current consent decision. */
export function useConsent(): ConsentState | null {
  return useSyncExternalStore(subscribe, getConsent, () => null);
}
