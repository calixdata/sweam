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
  /**
   * Claude (Anthropic API) key for AI-assisted submission review. A secret; set
   * with `wrangler secret put ANTHROPIC_API_KEY`. The admin AI review is
   * unavailable until it exists. AI_REVIEW_MODEL overrides the default model.
   */
  ANTHROPIC_API_KEY?: string;
  AI_REVIEW_MODEL?: string;
  /**
   * Required only when ANTHROPIC_API_KEY is an org key not scoped to a single
   * workspace; sent as the anthropic-workspace-id header. Not needed for a
   * workspace-scoped key. Set with `wrangler secret put ANTHROPIC_WORKSPACE_ID`.
   */
  ANTHROPIC_WORKSPACE_ID?: string;
  /**
   * Resend API key for sign-up email verification. A secret; set with
   * `wrangler secret put RESEND_API_KEY`. Sign-ups are disabled until it is set.
   * MAIL_FROM overrides the from address (default: Sweam <no-reply@sweam.co>),
   * which must be on a verified sending domain in Resend.
   */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /**
   * Firebase service account JSON (the entire key file contents) used to send
   * FCM v1 push notifications to the mobile app. A secret; set with
   * `wrangler secret put FCM_SERVICE_ACCOUNT`. Push is silently skipped when unset.
   */
  FCM_SERVICE_ACCOUNT?: string;
}

/** Hono generic: bindings plus the per-request variables middleware attaches. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionUser | null;
  };
};
