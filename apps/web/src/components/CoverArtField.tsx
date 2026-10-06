import { useId, useState } from 'react';
import { UPLOAD_SPECS } from '@sweam/shared';
import { ApiError } from '../api';
import { uploadMedia } from '../upload';

/** Read an image file's pixel size without uploading it. */
function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

/**
 * Cover art upload for a title, an episode, or a clip. Validates the file
 * before uploading, shows what is currently attached (as text, plus a small
 * preview), and hands back the stored /media URL.
 */
export function CoverArtField({
  label,
  value,
  onChange,
  required = false,
  portrait = true,
  base = '/api/studio/upload',
  disabled = false,
  hint,
}: {
  label: string;
  /** The current artwork URL, or '' when none. */
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  /** Enforce the 2:3 minimum size (titles); episode and clip art is free-form. */
  portrait?: boolean;
  /** Uploader base path: Studio by default, the intake for clips. */
  base?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const spec = UPLOAD_SPECS.poster;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > spec.maxBytes) {
      setError(`That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${spec.maxLabel}.`);
      return;
    }
    setBusy(true);
    try {
      if (portrait) {
        const { width, height } = await imageDimensions(file);
        if (width < spec.minWidth || height < spec.minHeight) {
          setError(
            `Cover art must be at least ${spec.minWidth} x ${spec.minHeight}px. Yours is ${width} x ${height}px.`,
          );
          return;
        }
      }
      const { url } = await uploadMedia(file, (p) => setStatus(p.message), base);
      onChange(url);
      setStatus(`Attached: ${file.name}`);
    } catch (err) {
      setStatus('');
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? ' (required)' : ' (optional)'}
      </label>
      <input
        id={id}
        type="file"
        accept={spec.accept}
        disabled={disabled || busy}
        aria-describedby={`${id}-hint ${id}-state`}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <p className="field-hint" id={`${id}-hint`}>
        {hint ??
          (portrait
            ? `${spec.formats}, up to ${spec.maxLabel}, ${spec.aspect}, at least ${spec.minWidth} x ${spec.minHeight}px. This is the artwork viewers see.`
            : `${spec.formats}, up to ${spec.maxLabel}.`)}
      </p>
      <div className="cover-preview" id={`${id}-state`}>
        {value ? (
          <>
            <img src={value} alt="" />
            <span className="status status-ok" role="status">
              {status || 'Cover art attached.'}
            </span>
            {!required && (
              <button
                type="button"
                className="button button-quiet"
                disabled={disabled || busy}
                onClick={() => {
                  onChange('');
                  setStatus('');
                }}
              >
                Remove
              </button>
            )}
          </>
        ) : (
          <span className="field-hint" role="status">
            {busy ? status || 'Uploading…' : 'No cover art yet.'}
          </span>
        )}
      </div>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
