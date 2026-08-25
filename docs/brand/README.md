# Sweam brand assets

The Sweam wordmark: SWEAM in a heavy geometric cut, a blue-to-cyan sound-wave
ribbon beneath it, a play triangle in the A, and a gradient bowtie "M".

## Files

- **`sweam-wordmark.svg`** — the vector wordmark (source of truth). Transparent,
  scales to any size. Letters default to dark and flip to near-white under
  `prefers-color-scheme: dark`, so it reads on either background. The bowtie "M"
  twists in 3D and the wave drifts; both animations are held still under
  `prefers-reduced-motion: reduce`.
- **`sweam-mark.svg`** — the bowtie "M" alone, used as the app favicon.
- **`sweam-wordmark.png`** — the original raster wordmark (kept for the README
  banner and any place a static raster is needed).

## In the app

The web app renders the wordmark inline via
`apps/web/src/components/BrandWordmark.tsx`, not as an `<img>`: letters use
`currentColor` (white on the dark chrome), the wave and "M" carry the brand
gradient, and the "M" twists — faster on hover. All motion lives in
`apps/web/src/styles.css` behind one `prefers-reduced-motion` guard. It appears
at header size in the top bar and at hero size on the signed-out home page.

## Guidelines

- Accessible name is always "Sweam" (the wordmark art is aria-hidden where the
  surrounding link or heading already carries the name).
- Palette drawn from the mark: background `#0b0d12`, accent blue `#2f6df0`,
  highlight `#35c7f0`.
