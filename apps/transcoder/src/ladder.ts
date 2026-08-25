/**
 * The rendition ladder. Standard HLS practice: encode every rung at or below
 * the source's height so the player can adapt to bandwidth, and never upscale.
 */

export interface Rendition {
  name: string;
  height: number;
  videoBitrateK: number;
  audioBitrateK: number;
}

export const LADDER: readonly Rendition[] = [
  { name: '1080p', height: 1080, videoBitrateK: 5000, audioBitrateK: 160 },
  { name: '720p', height: 720, videoBitrateK: 2800, audioBitrateK: 128 },
  { name: '480p', height: 480, videoBitrateK: 1400, audioBitrateK: 96 },
  { name: '360p', height: 360, videoBitrateK: 800, audioBitrateK: 64 },
];

/**
 * Rungs at or below the source height. A source smaller than the smallest
 * rung still gets one rendition (the smallest, capped by scale=-2:min(...))
 * so every upload ends up as adaptive HLS rather than a passthrough special
 * case.
 */
export function renditionsFor(sourceHeight: number): Rendition[] {
  const fitting = LADDER.filter((rendition) => rendition.height <= sourceHeight);
  if (fitting.length > 0) return fitting;
  const smallest = LADDER[LADDER.length - 1];
  return smallest ? [smallest] : [];
}
