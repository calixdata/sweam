import type { SessionUser } from '@sweam/shared';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ENVIRONMENT: 'development' | 'production';
  /** Shared secret authenticating transcoder workers to /api/transcode. */
  TRANSCODER_TOKEN: string;
  /** Static-asset binding for the built web app; only present on the deploy. */
  ASSETS?: Fetcher;
  /**
   * Verbatiim (film and clips engine). All three are secrets: set with
   * `wrangler secret put`, or in apps/api/.dev.vars for local dev (gitignored).
   * The Studio panel says "not connected" until all three exist.
   */
  VERBATIIM_API_URL?: string;
  VERBATIIM_API_KEY?: string;
  VERBATIIM_WEBHOOK_SECRET?: string;
}

/** Hono generic: bindings plus the per-request variables middleware attaches. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionUser | null;
  };
};
