import * as FileSystem from 'expo-file-system/legacy';
import { api, getToken } from './api';
import { API_BASE } from './config';

/**
 * Mobile media upload to the Sweam intake bucket, mirroring the web uploader.
 * Small files go up in a single PUT; larger ones use the same R2 multipart
 * pipeline (init → parts → complete), so a recorded clip up to the 200 MB cap
 * posts without hitting the Worker's request-body limit. Each transfer is a
 * raw-binary upload via expo-file-system carrying the mobile bearer token; a
 * multipart part is staged to a temp file (a byte range read out of the source)
 * so every PUT sends real bytes with a Content-Length the API requires.
 *
 * Returns the `/media/sub/<uid>/...` key the clip API expects as `sourceUrl`.
 */

const INTAKE_BASE = '/api/submissions/upload';
const MULTIPART_THRESHOLD = 32 * 1024 * 1024;

export interface UploadProgress {
  message: string;
  partsDone: number;
  partsTotal: number;
}

export class UploadError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'UploadError';
  }
}

interface MultipartInit {
  key: string;
  uploadId: string;
  partSize: number;
}

async function uploadHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    'x-sweam-client': 'mobile',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function uploadErrorFrom(status: number, body: string | null): UploadError {
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
      if (parsed.error?.code) {
        return new UploadError(parsed.error.code, parsed.error.message ?? `Upload failed (${status}).`);
      }
    } catch {
      // Non-JSON body; fall through to the generic message.
    }
  }
  return new UploadError('upload_failed', `Upload failed (${status}).`);
}

export async function uploadVideo(
  uri: string,
  contentType: string,
  filename: string,
  onProgress: (progress: UploadProgress) => void,
  maxBytes?: number,
): Promise<{ url: string }> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new UploadError('missing', 'The video could not be found on the device.');
  const size = info.size ?? 0;
  if (size <= 0) throw new UploadError('empty', 'The video file is empty.');
  if (maxBytes && size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    throw new UploadError('too_large', `This clip is over the ${mb} MB limit. Record a shorter clip.`);
  }

  if (size <= MULTIPART_THRESHOLD) {
    onProgress({ message: 'Uploading…', partsDone: 0, partsTotal: 1 });
    const res = await FileSystem.uploadAsync(
      `${API_BASE}${INTAKE_BASE}/${encodeURIComponent(filename)}`,
      uri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: await uploadHeaders({ 'content-type': contentType }),
      },
    );
    if (res.status < 200 || res.status >= 300) throw uploadErrorFrom(res.status, res.body);
    const data = JSON.parse(res.body) as { url: string };
    onProgress({ message: 'Uploaded.', partsDone: 1, partsTotal: 1 });
    return { url: data.url };
  }

  return uploadMultipart(uri, contentType, filename, size, onProgress);
}

async function uploadMultipart(
  uri: string,
  contentType: string,
  filename: string,
  size: number,
  onProgress: (progress: UploadProgress) => void,
): Promise<{ url: string }> {
  const init = await api.post<MultipartInit>(`${INTAKE_BASE}/multipart`, { filename, contentType });
  const partsTotal = Math.ceil(size / init.partSize);
  const parts: { partNumber: number; etag: string }[] = [];

  try {
    for (let partNumber = 1; partNumber <= partsTotal; partNumber++) {
      const start = (partNumber - 1) * init.partSize;
      const length = Math.min(init.partSize, size - start);
      const etag = await uploadPart(init, partNumber, uri, start, length);
      parts.push({ partNumber, etag });
      onProgress({
        message: `Uploading… part ${partNumber} of ${partsTotal}`,
        partsDone: partNumber,
        partsTotal,
      });
    }
    onProgress({ message: 'Finishing…', partsDone: partsTotal, partsTotal });
    const done = await api.post<{ url: string }>(`${INTAKE_BASE}/multipart/complete`, {
      key: init.key,
      uploadId: init.uploadId,
      parts,
    });
    return { url: done.url };
  } catch (err) {
    await api
      .post(`${INTAKE_BASE}/multipart/abort`, { key: init.key, uploadId: init.uploadId })
      .catch(() => undefined);
    throw err;
  }
}

async function uploadPart(
  init: MultipartInit,
  partNumber: number,
  uri: string,
  start: number,
  length: number,
): Promise<string> {
  const chunk = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: start,
    length,
  });
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const tmp = `${base}sweam-part-${partNumber}.bin`;
  await FileSystem.writeAsStringAsync(tmp, chunk, { encoding: FileSystem.EncodingType.Base64 });
  try {
    const query =
      `key=${encodeURIComponent(init.key)}` +
      `&uploadId=${encodeURIComponent(init.uploadId)}` +
      `&partNumber=${partNumber}`;
    const res = await FileSystem.uploadAsync(
      `${API_BASE}${INTAKE_BASE}/multipart/part?${query}`,
      tmp,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: await uploadHeaders(),
      },
    );
    if (res.status < 200 || res.status >= 300) throw uploadErrorFrom(res.status, res.body);
    const data = JSON.parse(res.body) as { partNumber: number; etag: string };
    if (!data.etag) throw new UploadError('bad_response', 'A part upload returned no etag.');
    return data.etag;
  } finally {
    await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => undefined);
  }
}
