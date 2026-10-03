import { BLU_BADGE_LABEL } from '@sweam/shared';

/**
 * The Sweam Blu paid-content badge: white "BLU" lettering on royal blue
 * (#1759F5), 7:4. Inline SVG (from the vector master) so it stays crisp at any
 * size. Pass `decorative` when adjacent text already names Blu, so screen
 * readers do not announce it twice.
 */
export function BluBadge({ height = 20, decorative = false }: { height?: number; decorative?: boolean }) {
  const width = Math.round((height * 7) / 4);
  return (
    <svg
      className="blu-badge"
      width={width}
      height={height}
      viewBox="0 0 112 64"
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : BLU_BADGE_LABEL}
    >
      <rect width="112" height="64" rx="9" fill="#1759F5" />
      <g transform="translate(1.88 0) scale(.88 1)">
        <g fill="#FFFFFF" transform="matrix(1 0 -.212556 1 6.801792 0)">
          <path
            fillRule="evenodd"
            d="M15 15H30.5C38.5 15 42 18.4 42 24C42 27.7 40.2 30 36.8 31.5C41.3 32.9 43 35.4 43 39.5C43 45.8 38.8 49 30.3 49H15ZM24 21.5V29.5L33 25.5ZM24 35V42.5H30C33.2 42.5 34.5 41.2 34.5 38.7C34.5 36.3 33.2 35 30 35Z"
          />
          <path d="M49 15H58V41H74V49H49Z" />
          <path d="M79 15H88V36.2C88 40.1 89.5 41.8 93.5 41.8C97.5 41.8 99 40.1 99 36.2V15H108V36.8C108 45.7 103.4 49.5 93.5 49.5C83.6 49.5 79 45.7 79 36.8Z" />
        </g>
      </g>
    </svg>
  );
}
