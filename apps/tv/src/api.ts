import type {
  ApiErrorBody,
  TitleDetail,
  TvFeed,
  TvPairPollResult,
  TvPairStart,
  TvPlatform,
  WatchPayload,
} from '@sweam/shared';

/** Typed error thrown for any non-2xx API response. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body: fall through to the status-based error below.
  }
  if (!res.ok) {
    const body = data as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'unknown',
      body?.error?.message ?? `Request failed (${res.status}).`,
    );
  }
  return data as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export const getFeed = (): Promise<TvFeed> => request('/api/tv/feed');

export const getTitle = (slug: string): Promise<TitleDetail> =>
  request(`/api/titles/${encodeURIComponent(slug)}`);

export const getWatch = (episodeId: string): Promise<WatchPayload> =>
  request(`/api/watch/${encodeURIComponent(episodeId)}`);

export const pairStart = (platform: TvPlatform, name?: string): Promise<TvPairStart> =>
  post('/api/tv/pair/start', { platform, ...(name ? { name } : {}) });

export const pairPoll = (deviceId: string, code: string): Promise<TvPairPollResult> =>
  post('/api/tv/pair/poll', { deviceId, code });

/** Who is signed in on this TV (401 → back to pairing). */
export const tvSession = (deviceId: string | null): Promise<{ user: { username: string | null; displayName: string } }> =>
  request(`/api/tv/session${deviceId ? `?device=${encodeURIComponent(deviceId)}` : ''}`);

/** Unpair this TV (deletes its session; the cookie is cleared by the server). */
export const unpairDevice = (deviceId: string): Promise<{ ok: boolean }> =>
  request(`/api/me/tv/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });

/**
 * Watch-progress beacon: same endpoint and cadence as the website, so a show
 * started on the couch resumes on the phone and the web. keepalive lets the
 * final beacon survive leaving the player.
 */
export function beaconProgress(episodeId: string, positionS: number, durationS: number): void {
  void fetch(`/api/watch/${encodeURIComponent(episodeId)}/progress`, {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ positionS, durationS }),
  }).catch(() => undefined);
}
