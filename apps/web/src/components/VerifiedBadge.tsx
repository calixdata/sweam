import { BRAND_PINK, VERIFIED_BADGE_LABEL } from '@sweam/shared';

/**
 * The verified-account mark: a hot pink disc with a white check, shown next
 * to the name of an identity-verified account. Carries its own accessible
 * name; sized in em so it tracks the text beside it.
 */
export function VerifiedBadge({ size = '1em' }: { size?: string }) {
  return (
    <svg
      className="verified-badge"
      role="img"
      aria-label={VERIFIED_BADGE_LABEL}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      focusable="false"
    >
      <title>{VERIFIED_BADGE_LABEL}</title>
      <circle cx="12" cy="12" r="11" fill={BRAND_PINK} />
      <path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
