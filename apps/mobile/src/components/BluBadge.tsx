import { Image } from 'expo-image';

const BADGE = require('../../assets/images/blu-badge.png');

/**
 * The Sweam Blu paid-content badge (white "BLU" on royal blue), 7:4. Pass
 * `label` to announce it to screen readers; leave it off (decorative) when
 * adjacent text already names Blu.
 */
export function BluBadge({ height = 20, label = false }: { height?: number; label?: boolean }) {
  const width = Math.round((height * 7) / 4);
  return (
    <Image
      source={BADGE}
      style={{ width, height }}
      contentFit="contain"
      accessible={label}
      accessibilityLabel={label ? 'Sweam Blu paid content' : undefined}
    />
  );
}
