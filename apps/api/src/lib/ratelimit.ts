import { fail } from './http';

/**
 * Fixed-window rate limiting backed by D1. One counter row per (bucket,
 * window); incrementing and reading is a single upsert, and D1's single
 * primary makes the count globally consistent. Fixed windows allow up to 2x
 * the limit across a window boundary, which is an acceptable trade for
 * abuse-control purposes and documented in ARCHITECTURE.md.
 */

export interface RateLimitRule {
  /** Bucket namespace; the caller appends the subject key. */
  name: string;
  limit: number;
  windowS: number;
}

/** The abuse surfaces and their budgets. */
export const RATE_LIMITS = {
  /** Credential guessing against one account. */
  signinEmail: { name: 'signin-email', limit: 10, windowS: 15 * 60 },
  /** Credential stuffing from one address. */
  signinIp: { name: 'signin-ip', limit: 30, windowS: 15 * 60 },
  signupIp: { name: 'signup-ip', limit: 5, windowS: 60 * 60 },
  report: { name: 'report', limit: 10, windowS: 24 * 60 * 60 },
  /** Anonymous beacons arrive at most every 10s; 60 per 5 minutes is 2x headroom. */
  anonView: { name: 'view', limit: 60, windowS: 5 * 60 },
  scoutApply: { name: 'scout-apply', limit: 3, windowS: 24 * 60 * 60 },
  /** Single-PUT uploads and multipart inits; parts are bounded by their init. */
  upload: { name: 'upload', limit: 30, windowS: 60 * 60 },
  /** Pre-roll impression beacons; a human watches far fewer prerolls than this. */
  adImpression: { name: 'ad-impression', limit: 30, windowS: 5 * 60 },
  comment: { name: 'comment', limit: 20, windowS: 60 * 60 },
  submission: { name: 'submission', limit: 3, windowS: 24 * 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Start of the fixed window containing nowMs, in epoch seconds. */
export function windowStartS(nowMs: number, windowS: number): number {
  return Math.floor(nowMs / 1000 / windowS) * windowS;
}

/**
 * Count this request against the rule's budget; 429 when the budget is spent.
 * The first hit of a new window prunes that bucket's stale windows, so the
 * table stays bounded without a scheduler.
 */
export async function enforceRateLimit(
  db: D1Database,
  rule: RateLimitRule,
  subject: string,
  nowMs = Date.now(),
): Promise<void> {
  const bucket = `${rule.name}:${subject}`;
  const window = windowStartS(nowMs, rule.windowS);

  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(bucket, window)
    .first<{ count: number }>();

  if (row?.count === 1) {
    await db
      .prepare('DELETE FROM rate_limits WHERE bucket = ? AND window_start < ?')
      .bind(bucket, window)
      .run();
  }

  if ((row?.count ?? 0) > rule.limit) {
    fail(429, 'rate_limited', 'Too many requests. Wait a bit and try again.');
  }
}

/** Best-available client address; local dev has no CF header. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'dev';
}
