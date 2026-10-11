import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { ApiError, apiUpload } from '../api';
import { ErrorNote } from './Status';

/** Covers render at 16:9 everywhere (cards and the poll page), so this is the one size to make. */
export const UCAST_COVER_HINT =
  'Ideal size 1280 by 720 pixels (16:9, landscape). Minimum 800 by 450. JPEG or WebP under 300 KB, PNG also accepted, up to 8 MB. The image is shown edge to edge, so keep faces and titles away from the outer 5 percent.';

/**
 * The one cover control for UCast polls, used on the admin console and on the
 * poll page itself (admins only). Picking a file uploads it straight away and
 * hands the stored URL to the caller, which saves it on the poll.
 */
export function UcastCoverField({
  id,
  value,
  onChange,
  saving,
}: {
  id: string;
  value: string | null;
  onChange: (url: string | null) => void;
  saving?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const { url } = await apiUpload(file, '/api/admin/ucast/cover');
      onChange(url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      // Let the same file be picked again after a failure or a removal.
      event.target.value = '';
    }
  }
  return (
    <div className="field">
      <label htmlFor={id}>{value ? 'Replace the cover image' : 'Add a cover image'} (jogs the memory of who, what and when)</label>
      <input id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} disabled={busy || saving} aria-describedby={`${id}-hint`} />
      <p className="field-hint" id={`${id}-hint`}>{UCAST_COVER_HINT}</p>
      <p className="field-hint" role="status">
        {value ? (
          <>
            <img src={value} alt="" className="ucast-admin-cover" /> Cover set.{' '}
            <button type="button" className="button button-quiet" disabled={busy || saving} onClick={() => onChange(null)}>
              Remove cover
            </button>
          </>
        ) : (
          'No cover yet.'
        )}
        {busy && ' Uploading…'}
        {saving && ' Saving…'}
      </p>
      {err && <ErrorNote message={err} />}
    </div>
  );
}
