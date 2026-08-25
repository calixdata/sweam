import type { MultipartInit, MultipartPart } from '@sweam/shared';
import { ApiError, apiSend, apiUpload } from './api';

/**
 * Media upload with automatic strategy selection: small files go up in one
 * PUT; larger ones use multipart with per-part retry and resumability. Part
 * state (upload id and etags) is persisted to localStorage keyed by the
 * file's fingerprint, so an interrupted upload of the same file resumes from
 * the next part instead of starting over, even after a page reload.
 */

const MULTIPART_THRESHOLD = 32 * 1024 * 1024;
const PART_RETRIES = 3;
const RESUME_PREFIX = 'sweam-upload:';

export interface UploadProgress {
  message: string;
  partsDone: number;
  partsTotal: number;
}

interface ResumeState {
  key: string;
  uploadId: string;
  partSize: number;
  etags: Record<number, string>;
}

function fingerprintOf(file: File): string {
  return `${RESUME_PREFIX}${file.name}:${file.size}:${file.lastModified}`;
}

function loadResumeState(file: File): ResumeState | null {
  try {
    const raw = localStorage.getItem(fingerprintOf(file));
    return raw ? (JSON.parse(raw) as ResumeState) : null;
  } catch {
    return null;
  }
}

function saveResumeState(file: File, state: ResumeState): void {
  try {
    localStorage.setItem(fingerprintOf(file), JSON.stringify(state));
  } catch {
    // Private browsing or full storage: uploads still work, just not resumable.
  }
}

function clearResumeState(file: File): void {
  try {
    localStorage.removeItem(fingerprintOf(file));
  } catch {
    // Same as above.
  }
}

export async function uploadMedia(
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<{ url: string }> {
  if (file.size <= MULTIPART_THRESHOLD) {
    onProgress({ message: `Uploading ${file.name}…`, partsDone: 0, partsTotal: 1 });
    const result = await apiUpload(file);
    onProgress({ message: `Uploaded ${file.name}.`, partsDone: 1, partsTotal: 1 });
    return result;
  }
  return uploadMultipart(file, onProgress, true);
}

async function uploadMultipart(
  file: File,
  onProgress: (progress: UploadProgress) => void,
  allowResume: boolean,
): Promise<{ url: string }> {
  let state = allowResume ? loadResumeState(file) : null;
  const resuming = state !== null;

  if (!state) {
    const init = await apiSend<MultipartInit>('POST', '/api/studio/upload/multipart', {
      filename: file.name,
      contentType: file.type,
    });
    state = { key: init.key, uploadId: init.uploadId, partSize: init.partSize, etags: {} };
    saveResumeState(file, state);
  }

  const partsTotal = Math.ceil(file.size / state.partSize);

  try {
    for (let partNumber = 1; partNumber <= partsTotal; partNumber++) {
      if (state.etags[partNumber]) continue;
      const start = (partNumber - 1) * state.partSize;
      const chunk = file.slice(start, Math.min(start + state.partSize, file.size));
      const part = await uploadPartWithRetry(state, partNumber, chunk);
      state.etags[part.partNumber] = part.etag;
      saveResumeState(file, state);
      onProgress({
        message: `Uploading ${file.name}: part ${partNumber} of ${partsTotal} done.`,
        partsDone: partNumber,
        partsTotal,
      });
    }

    onProgress({ message: `Finalizing ${file.name}…`, partsDone: partsTotal, partsTotal });
    const parts: MultipartPart[] = Object.entries(state.etags)
      .map(([partNumber, etag]) => ({ partNumber: Number(partNumber), etag }))
      .sort((a, b) => a.partNumber - b.partNumber);
    const result = await apiSend<{ url: string }>('POST', '/api/studio/upload/multipart/complete', {
      key: state.key,
      uploadId: state.uploadId,
      parts,
    });
    clearResumeState(file);
    onProgress({ message: `Uploaded ${file.name}.`, partsDone: partsTotal, partsTotal });
    return result;
  } catch (err) {
    // A resumed upload can reference a multipart session the server no longer
    // has; discard the stale state and run once more from scratch.
    if (resuming && err instanceof ApiError && err.code === 'upload_gone') {
      clearResumeState(file);
      await apiSend('POST', '/api/studio/upload/multipart/abort', {
        key: state.key,
        uploadId: state.uploadId,
      }).catch(() => undefined);
      return uploadMultipart(file, onProgress, false);
    }
    throw err;
  }
}

async function uploadPartWithRetry(
  state: ResumeState,
  partNumber: number,
  chunk: Blob,
): Promise<MultipartPart> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PART_RETRIES; attempt++) {
    try {
      const query = `key=${encodeURIComponent(state.key)}&uploadId=${encodeURIComponent(state.uploadId)}&partNumber=${partNumber}`;
      const res = await fetch(`/api/studio/upload/multipart/part?${query}`, {
        method: 'PUT',
        credentials: 'same-origin',
        body: chunk,
      });
      const data = (await res.json().catch(() => null)) as
        | (MultipartPart & { error?: { code: string; message: string } })
        | null;
      if (!res.ok) {
        throw new ApiError(
          res.status,
          data?.error?.code ?? 'unknown',
          data?.error?.message ?? `Part ${partNumber} failed (${res.status}).`,
        );
      }
      if (!data?.etag) throw new ApiError(500, 'bad_response', 'Part upload returned no etag.');
      return { partNumber: data.partNumber, etag: data.etag };
    } catch (err) {
      lastError = err;
      // A gone upload cannot be fixed by retrying the part.
      if (err instanceof ApiError && err.code === 'upload_gone') throw err;
      if (attempt < PART_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new ApiError(500, 'part_failed', `Part ${partNumber} failed after ${PART_RETRIES} attempts.`);
}
