import type { TvPlatform } from '@sweam/shared';

/**
 * The device id is minted by the server at pair/start and kept locally so the
 * TV can name itself (last-seen, unpair). Storage can be unavailable on some
 * TV runtimes, so every access is guarded; losing it only means the TV shows
 * as a nameless row in Settings until it pairs again.
 */
const DEVICE_KEY = 'sweamtv.device';

export function getDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export function setDeviceId(id: string): void {
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    // Best effort only.
  }
}

export function clearDeviceId(): void {
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Best effort only.
  }
}

/** Which TV runtime this bundle is running in (shapes the Settings label). */
export function detectPlatform(): TvPlatform {
  const ua = navigator.userAgent;
  if (/Tizen/i.test(ua)) return 'tizen';
  if (/Web0S|webOS/i.test(ua)) return 'webos';
  if (/Roku/i.test(ua)) return 'roku';
  return 'tv-web';
}
