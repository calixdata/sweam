# Sweam brand assets

The Sweam wordmark, as designed: SWEAM with a blue-to-cyan wave, a play triangle
in the A, and a gradient bowtie M.

## Files

- **`sweam-wordmark.png`** — the original wordmark. Transparent background,
  dark (near-black) letters with blue accents. Use on light surfaces.
- **`sweam-wordmark-dark.png`** — the dark-UI rendition used by the app. The
  identical artwork with the near-black letters knocked out to near-white
  (`#eef1f7`) so it reads on the dark chrome; the blue accents are unchanged and
  the alpha (anti-aliased edges) is preserved. Nothing is reshaped — only the
  neutral-dark ink is recolored.

The dark rendition is generated from the original by recoloring only the
low-saturation dark pixels; see the note in the commit that added it.

## In the app

The web app shows the wordmark transparently with no backdrop: the header uses
`sweam-wordmark-dark.png` at ~42px, and the signed-out home shows it larger in
the hero. Accessible name is always "Sweam".

## Palette

Drawn from the mark: background `#0b0d12`, accent blue `#2f6df0`, highlight
`#35c7f0`.
