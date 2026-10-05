import { useState } from 'react';

/** First letters of the first two words, for the fallback monogram. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((word) => word[0] ?? '').join('');
  return (letters || name.trim()[0] || '?').toUpperCase();
}

/**
 * A round profile picture with an initials fallback. `src` is a /media/... key
 * or an absolute URL; when it is absent or fails to load, the initials show.
 *
 * Decorative by default: the account name is almost always shown as text right
 * beside it, so the image is hidden from screen readers to avoid a redundant
 * announcement. Pass `label` only when the avatar stands on its own.
 */
export function Avatar({
  src,
  name,
  size = 36,
  label,
}: {
  src?: string | null;
  name: string;
  size?: number;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(src) && !failed;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {showImg ? (
        <img src={src ?? undefined} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="avatar-initials">{initialsOf(name)}</span>
      )}
    </span>
  );
}
