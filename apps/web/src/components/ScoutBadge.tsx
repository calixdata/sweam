/**
 * The gold Sweam Scout account badge.
 *
 * Shown beside an approved scout account's name so creators (and the scout
 * themselves) can identify the role at a glance. The art is inlined rather than
 * loaded as an image so it scales crisply, needs no extra request, and can
 * carry its own accessible name. Sized in `em` via `.scout-badge` so it tracks
 * the surrounding text. No element `id` is used, so it is safe to render many
 * times on one page (e.g. a list of interested scouts).
 */
export function ScoutBadge({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `scout-badge ${className}` : 'scout-badge'}
      viewBox="0 0 176 64"
      role="img"
      aria-label="Scout account"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="176" height="64" rx="9" fill="#D8AD4F" />
      <g transform="translate(11.6 0) scale(.88 1)">
        <g fill="#0B1424" fillRule="evenodd" transform="matrix(1 0 -.212556 1 6.801792 0)">
          <path
            transform="translate(0 15)"
            d="M29 0H12C4 0 0 3.8 0 10C0 15.2 3.1 18.2 9 19.6L17 21.5C19.8 22.1 21 23.1 21 24.8C21 26.5 19.7 27.4 17 27.4H1V34H18C26 34 30 30.5 30 24C30 18.7 27 15.6 21 14.1L13 12.2C10.3 11.6 9 10.7 9 9C9 7.5 10.3 6.6 13 6.6H29Z"
          />
          <path
            transform="translate(35 15)"
            d="M30 0H16C5.5 0 0 5.5 0 17C0 28.5 5.5 34 16 34H30V26H17C11.5 26 9 23.3 9 17C9 10.7 11.5 8 17 8H30Z"
          />
          <path
            transform="translate(70 15)"
            d="M16 -.5C5 -.5 0 4.4 0 17C0 29.6 5 34.5 16 34.5C27 34.5 32 29.6 32 17C32 4.4 27 -.5 16 -.5ZM16 7.5C21.2 7.5 23 10.1 23 17C23 23.9 21.2 26.5 16 26.5C10.8 26.5 9 23.9 9 17C9 10.1 10.8 7.5 16 7.5Z"
          />
          <path
            transform="translate(107 15)"
            d="M0 0H9V21.2C9 25.1 10.5 26.8 14.5 26.8C18.5 26.8 20 25.1 20 21.2V0H29V21.8C29 30.7 24.4 34.5 14.5 34.5C4.6 34.5 0 30.7 0 21.8Z"
          />
          <path transform="translate(141 15)" d="M0 0H29V8H19V34H10V8H0Z" />
        </g>
      </g>
    </svg>
  );
}
