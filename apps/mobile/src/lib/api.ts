import * as SecureStore from 'expo-secure-store';
import { API_BASE } from './config';

/**
 * The Sweam API client for the app. Auth is a Bearer token stored in the device
 * keystore (SecureStore); every request also identifies as the mobile client so
 * sign-in returns that token. Video is fetched by expo-video with the same
 * Authorization header (see videoSource); posters are public.
 */

const TOKEN_KEY = 'sweam_token';
let cachedToken: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken ?? null;
  try {
    cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    cachedToken = null;
  }
  return cachedToken ?? null;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Keystore unavailable: session lives in memory for this launch.
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'x-sweam-client': 'mobile',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

/** Absolute URL for a /media or /img path (posters, hero art). */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

/** A video source for expo-video that carries the auth header gated /media needs. */
export function videoSource(path: string, token: string | null) {
  const uri = path.startsWith('http') ? path : `${API_BASE}${path}`;
  return token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
}
