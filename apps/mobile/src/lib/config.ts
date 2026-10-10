/**
 * The app talks to the live Sweam API. Content (video) is auth-gated, so the
 * client sends a Bearer token; posters/images are public.
 */
/** Override for local work: EXPO_PUBLIC_API_BASE=http://localhost:8787 npx expo start */
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://sweam.co';
