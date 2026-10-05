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
  /**
   * Global failed-login cap across ALL IPs, to blunt a DISTRIBUTED brute-force
   * where many IPs each stay under the per-IP cap. Only failures increment it,
   * and it is checked BEFORE the password verify. The threshold is set well
   * above what the whole userbase would ever fail in 15 minutes; raise it as the
   * userbase grows. Trade-off: at scale this could briefly 429 all sign-ins
   * during an attack (a chosen availability-vs-abuse trade, per Calix).
   */
  loginFailGlobal: { name: 'login-fail-global', limit: 100, windowS: 15 * 60 },
  /** Verification-token submissions per IP (token-guessing brake). */
  verifyIp: { name: 'verify-ip', limit: 20, windowS: 15 * 60 },
  /** Password-reset requests per IP and per account (email-bombing brake). */
  pwResetIp: { name: 'pwreset-ip', limit: 5, windowS: 60 * 60 },
  pwResetEmail: { name: 'pwreset-email', limit: 5, windowS: 60 * 60 },
  /** Reset-token submissions per IP (token-guessing brake). */
  pwResetSubmitIp: { name: 'pwreset-submit-ip', limit: 20, windowS: 15 * 60 },
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
  /** Instant clips posted per day: generous for real use, a brake on spam. */
  clip: { name: 'clip', limit: 20, windowS: 24 * 60 * 60 },
  /** Verbatiim film jobs a creator may start per day (each one renders a whole episode). */
  verbatiim: { name: 'verbatiim', limit: 10, windowS: 24 * 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Start of the fixed window containing nowMs, in epoch seconds. */
export function windowStartS(nowMs: number, windowS: number): number {
  return Math.floor(nowMs / 1000 / windowS) * windowS;
}

/**
 * Increment this subject's counter for the current window and return the new
 * count, without enforcing the limit. Use this to record an event (e.g. a failed
 * login) that should count toward a budget checked elsewhere. The first hit of a
 * new window prunes that bucket's stale windows, so the table stays bounded.
 */
export async function recordRateLimit(
  db: D1Database,
  rule: RateLimitRule,
  subject: string,
  nowMs = Date.now(),
): Promise<number> {
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
  return row?.count ?? 0;
}

/** Read a subject's count for the current window without incrementing it. */
export async function countRateLimit(
  db: D1Database,
  rule: RateLimitRule,
  subject: string,
  nowMs = Date.now(),
): Promise<number> {
  const bucket = `${rule.name}:${subject}`;
  const window = windowStartS(nowMs, rule.windowS);
  const row = await db
    .prepare('SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?')
    .bind(bucket, window)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Count this request against the rule's budget; 429 when the budget is spent.
 */
export async function enforceRateLimit(
  db: D1Database,
  rule: RateLimitRule,
  subject: string,
  nowMs = Date.now(),
): Promise<void> {
  const count = await recordRateLimit(db, rule, subject, nowMs);
  if (count > rule.limit) {
    fail(429, 'rate_limited', 'Too many requests. Wait a bit and try again.');
  }
}

/** The single global bucket subject for platform-wide failed-login accounting. */
export const GLOBAL_SUBJECT = 'all';

/**
 * Blunt a distributed brute-force: if failed logins across ALL IPs have exceeded
 * the global cap this window, reject before doing any password work. Checked at
 * the top of sign-in, before the per-account verify.
 */
export async function enforceGlobalLoginCap(db: D1Database, nowMs = Date.now()): Promise<void> {
  const fails = await countRateLimit(db, RATE_LIMITS.loginFailGlobal, GLOBAL_SUBJECT, nowMs);
  if (fails >= RATE_LIMITS.loginFailGlobal.limit) {
    fail(429, 'rate_limited', 'Too many sign-in attempts right now. Please try again shortly.');
  }
}

/** Record one failed login toward the global distributed-attack cap. */
export async function recordLoginFailure(db: D1Database, nowMs = Date.now()): Promise<void> {
  await recordRateLimit(db, RATE_LIMITS.loginFailGlobal, GLOBAL_SUBJECT, nowMs);
}

/** Best-available client address; local dev has no CF header. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'dev';
}
