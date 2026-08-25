import type { ApiErrorBody } from '@sweam/shared';

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
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
  });
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

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiSend<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Streams a file to the Studio uploader; returns the stored /media/... URL. */
export async function apiUpload(file: File): Promise<{ url: string }> {
  const res = await fetch(`/api/studio/upload/${encodeURIComponent(file.name)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': file.type },
    body: file,
  });
  const data = (await res.json().catch(() => null)) as ({ url: string } & ApiErrorBody) | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'unknown',
      data?.error?.message ?? `Upload failed (${res.status}).`,
    );
  }
  if (!data?.url) throw new ApiError(500, 'bad_response', 'Upload succeeded but returned no URL.');
  return { url: data.url };
}
