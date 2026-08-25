import type { TranscodeJobClaim } from '@sweam/shared';

/** Thin client for the Worker's transcoder service API. */
export class SweamApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly workerId: string,
  ) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${init.method ?? 'GET'} ${path} failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return res;
  }

  async claim(): Promise<TranscodeJobClaim | null> {
    const res = await this.request('/api/transcode/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workerId: this.workerId }),
    });
    const data = (await res.json()) as { job: TranscodeJobClaim | null };
    return data.job;
  }

  /** Download a job source; resolves /media/... paths against the API origin. */
  async fetchSource(sourceUrl: string): Promise<ArrayBuffer> {
    const url = sourceUrl.startsWith('http') ? sourceUrl : `${this.baseUrl}${sourceUrl}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Source download failed (${res.status}): ${url}`);
    return res.arrayBuffer();
  }

  async uploadOutput(jobId: string, filename: string, data: Buffer, contentType: string): Promise<void> {
    await this.request(`/api/transcode/jobs/${jobId}/output/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'content-type': contentType, 'content-length': String(data.byteLength) },
      body: new Uint8Array(data),
    });
  }

  async complete(jobId: string, body: { durationS: number; master: string; poster: string | null }): Promise<void> {
    await this.request(`/api/transcode/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async fail(jobId: string, error: string): Promise<void> {
    await this.request(`/api/transcode/jobs/${jobId}/fail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: error.slice(0, 2000) }),
    });
  }
}

/** Content types for the files ffmpeg leaves in the output directory. */
export function outputContentType(filename: string): string | null {
  if (filename.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (filename.endsWith('.ts')) return 'video/mp2t';
  if (filename.endsWith('.m4s')) return 'video/iso.segment';
  if (filename.endsWith('.mp4')) return 'video/mp4';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  if (filename.endsWith('.png')) return 'image/png';
  return null;
}
