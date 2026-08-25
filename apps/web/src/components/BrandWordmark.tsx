import { useId } from 'react';

/**
 * The Sweam wordmark, drawn as vector so it is transparent, scales without
 * blur, and exposes each part for motion. Letters use `currentColor` (set by
 * the parent), the wave and the bowtie "M" carry the brand gradient, and the
 * "M" twists in 3D. Animation and hover behavior live in styles.css so they
 * share one `prefers-reduced-motion` guard. Decorative here: the enclosing
 * link/section already carries the accessible name, so this is aria-hidden to
 * avoid a doubled announcement.
 */
export function BrandWordmark({ size = 'header' }: { size?: 'header' | 'hero' }) {
  const gradientId = useId();
  return (
    <svg
      className={`brand-wordmark brand-wordmark--${size}`}
      viewBox="0 0 740 260"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f6df0" />
          <stop offset="0.5" stopColor="#4b86ff" />
          <stop offset="1" stopColor="#35c7f0" />
        </linearGradient>
      </defs>

      <path
        className="sweam-wave"
        d="M46 216 C92 198 132 234 178 216 C224 198 264 234 310 216 C356 198 396 234 442 216 C480 202 506 214 520 210"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={12}
        strokeLinecap="round"
      />

      <g className="sweam-letters">
        <path d="M150 96 C150 70 121 60 96 62 C67 64 52 85 62 105 C71 122 99 125 113 129 C141 137 150 159 138 175 C122 193 88 189 66 177 C56 171 51 163 50 153" />
        <path d="M168 60 L196 188 L234 110 L272 188 L300 60" />
        <path d="M392 62 L328 62 L328 188 L392 188 M328 125 L384 125" />
        <path d="M414 188 L456 60 L498 188 M432 152 L480 152" />
      </g>

      <polygon className="sweam-play" points="444,106 444,140 470,123" fill={`url(#${gradientId})`} />

      <g className="sweam-m" fill={`url(#${gradientId})`}>
        <path d="M520 62 L591 124 L520 186 Z" />
        <path d="M662 62 L591 124 L662 186 Z" />
      </g>
    </svg>
  );
}
