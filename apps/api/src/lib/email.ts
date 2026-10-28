import type { Env } from '../env';

/**
 * Transactional email via Resend, called over fetch from the edge Worker (the
 * bundle stays hono + zod). Used for sign-up email verification. Sending is
 * gated on RESEND_API_KEY; the from address defaults to no-reply@sweam.co and
 * requires sweam.co to be a verified sending domain in Resend.
 */

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Sweam <no-reply@sweam.co>';

export function emailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export class EmailError extends Error {}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEmail(
  env: Env,
  message: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> },
): Promise<void> {
  if (!env.RESEND_API_KEY) throw new EmailError('Email sending is not configured.');
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || DEFAULT_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.headers ? { headers: message.headers } : {}),
      }),
    });
  } catch {
    throw new EmailError('Could not reach the email service.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new EmailError(`Email service returned ${res.status}. ${detail.slice(0, 200)}`);
  }
}

export interface BatchEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}

export interface BatchResult {
  ok: boolean;
  status: number;
  /** Resend message id per item (same order as the request), when sent. */
  ids: (string | null)[];
  /** Items Resend rejected individually (permissive validation). */
  itemErrors: { index: number; message: string }[];
  error: string | null;
  /** True for rate limits and provider outages: try again on the next tick. */
  retryable: boolean;
}

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';

/**
 * Resend's batch response lists ids for accepted emails. In permissive mode the
 * rejected ones are only in `errors` (by request index), so when `data` is
 * shorter than the request, its entries belong to the non-rejected indexes in
 * order.
 */
export function mapBatchIds(count: number, data: { id?: string }[], rejected: number[]): (string | null)[] {
  if (data.length === count) return data.map((d) => d.id ?? null);
  const skip = new Set(rejected);
  const ids: (string | null)[] = [];
  let next = 0;
  for (let i = 0; i < count; i++) {
    if (skip.has(i)) ids.push(null);
    else ids.push(data[next++]?.id ?? null);
  }
  return ids;
}

/**
 * Send up to 100 emails in one Resend request. Permissive validation keeps one
 * bad address from sinking the batch; the idempotency key makes a retry of the
 * same batch (same key, same payload) a no-op on Resend's side for 24 hours.
 */
export async function sendEmailBatch(env: Env, messages: BatchEmail[], idempotencyKey: string): Promise<BatchResult> {
  if (!env.RESEND_API_KEY) {
    return { ok: false, status: 0, ids: [], itemErrors: [], error: 'Email sending is not configured.', retryable: false };
  }
  if (messages.length === 0) return { ok: true, status: 200, ids: [], itemErrors: [], error: null, retryable: false };
  if (messages.length > 100) throw new EmailError('A Resend batch holds at most 100 emails.');
  const from = env.MAIL_FROM || DEFAULT_FROM;
  let res: Response;
  try {
    res = await fetch(RESEND_BATCH_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey.slice(0, 256),
        'x-batch-validation': 'permissive',
      },
      body: JSON.stringify(
        messages.map((m) => ({
          from,
          to: [m.to],
          reply_to: 'support@sweam.co',
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.headers ? { headers: m.headers } : {}),
          ...(m.tags ? { tags: m.tags } : {}),
        })),
      ),
    });
  } catch {
    return { ok: false, status: 0, ids: [], itemErrors: [], error: 'Could not reach the email service.', retryable: true };
  }
  const bodyText = await res.text().catch(() => '');
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 409 && /concurrent/i.test(bodyText));
    return { ok: false, status: res.status, ids: [], itemErrors: [], error: `Resend ${res.status}: ${bodyText.slice(0, 300)}`, retryable };
  }
  let parsed: { data?: { id?: string }[]; errors?: { index?: number; message?: string }[] } = {};
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    parsed = {};
  }
  const itemErrors = (parsed.errors ?? [])
    .filter((e) => typeof e.index === 'number')
    .map((e) => ({ index: e.index as number, message: e.message ?? 'Rejected by Resend.' }));
  const ids = mapBatchIds(messages.length, parsed.data ?? [], itemErrors.map((e) => e.index));
  return { ok: true, status: res.status, ids, itemErrors, error: itemErrors.length ? `${itemErrors.length} item(s) rejected` : null, retryable: false };
}

/** The sign-up verification email (subject, HTML, and plain-text parts). */
export function verificationEmail(
  link: string,
  displayName: string,
): { subject: string; html: string; text: string } {
  const name = escapeHtml(displayName);
  const subject = 'Verify your email for Sweam';
  const text =
    `Hi ${displayName},\n\n` +
    `Confirm your email to activate your Sweam account:\n${link}\n\n` +
    `This link expires in 24 hours. If you did not create a Sweam account, you can ignore this email.`;
  const html =
    `<!doctype html><html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#080e19;color:#f4f7ff;padding:24px">` +
    `<div style="max-width:480px;margin:0 auto;background:#111c2d;border:1px solid #293a52;border-radius:14px;padding:28px">` +
    `<h1 style="font-size:1.35rem;margin:0 0 12px">Confirm your email</h1>` +
    `<p style="color:#a5b5cd;margin:0 0 20px">Hi ${name}, confirm your email to activate your Sweam account.</p>` +
    `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#4de0f3;color:#061827;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px">Verify email</a></p>` +
    `<p style="color:#a5b5cd;font-size:0.85rem;margin:0">Or paste this link into your browser:<br><a href="${link}" style="color:#6fe1f2">${link}</a></p>` +
    `<p style="color:#a5b5cd;font-size:0.85rem;margin:16px 0 0">This link expires in 24 hours. If you did not create a Sweam account, you can ignore this email.</p>` +
    `</div></body></html>`;
  return { subject, html, text };
}

function noticeEmail(subject: string, heading: string, displayName: string, lines: string[]): { subject: string; html: string; text: string } {
  const name = escapeHtml(displayName);
  const text = `Hi ${displayName},\n\n${lines.join('\n\n')}\n\nQuestions: support@sweam.co`;
  const html =
    `<!doctype html><html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#080e19;color:#f4f7ff;padding:24px">` +
    `<div style="max-width:480px;margin:0 auto;background:#111c2d;border:1px solid #293a52;border-radius:14px;padding:28px">` +
    `<h1 style="font-size:1.35rem;margin:0 0 12px">${escapeHtml(heading)}</h1>` +
    `<p style="color:#a5b5cd;margin:0 0 14px">Hi ${name},</p>` +
    lines.map((l) => `<p style="color:#a5b5cd;margin:0 0 14px">${escapeHtml(l)}</p>`).join('') +
    `<p style="color:#a5b5cd;font-size:0.85rem;margin:16px 0 0">Questions: <a href="mailto:support@sweam.co" style="color:#6fe1f2">support@sweam.co</a></p>` +
    `</div></body></html>`;
  return { subject, html, text };
}

/** Tells an account owner that Sweam staff suspended, banned, or restored the account. */
export function accountStandingEmail(
  kind: 'suspended' | 'banned' | 'restored',
  displayName: string,
  reason: string | null,
  untilLabel: string | null,
): { subject: string; html: string; text: string } {
  const why = reason ? `Reason: ${reason}` : null;
  if (kind === 'restored') {
    return noticeEmail('Your Sweam account is active again', 'Your account is active again', displayName, [
      'Your Sweam account has been restored. You can sign in again, and your titles and comments are back.',
    ]);
  }
  if (kind === 'banned') {
    return noticeEmail('Your Sweam account has been banned', 'Your account has been banned', displayName, [
      'Your Sweam account has been permanently banned for breaking Sweam\'s rules. You can no longer sign in, and your titles and comments are no longer shown.',
      ...(why ? [why] : []),
      'If you think this is a mistake, reply to this email.',
    ]);
  }
  return noticeEmail('Your Sweam account has been suspended', 'Your account has been suspended', displayName, [
    `Your Sweam account has been suspended ${untilLabel ? `until ${untilLabel}` : 'until further notice'}. While it is suspended you cannot sign in, and your titles and comments are hidden.`,
    ...(why ? [why] : []),
    'If you think this is a mistake, reply to this email.',
  ]);
}

/** Tells an account owner that Sweam staff set a new password for them. */
export function passwordSetByStaffEmail(displayName: string): { subject: string; html: string; text: string } {
  return noticeEmail('Your Sweam password was changed', 'Your password was changed', displayName, [
    'Sweam staff set a new password for your account, and every device was signed out. Use the new password you were given to sign in.',
    'If you did not ask for this, reply to this email right away.',
  ]);
}

/** The password-reset email (subject, HTML, and plain-text parts). */
export function passwordResetEmail(
  link: string,
  displayName: string,
): { subject: string; html: string; text: string } {
  const name = escapeHtml(displayName);
  const subject = 'Reset your Sweam password';
  const text =
    `Hi ${displayName},\n\n` +
    `We received a request to reset your Sweam password. Set a new one here:\n${link}\n\n` +
    `This link expires in 1 hour. If you did not request this, you can ignore this email; your password will not change.`;
  const html =
    `<!doctype html><html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#080e19;color:#f4f7ff;padding:24px">` +
    `<div style="max-width:480px;margin:0 auto;background:#111c2d;border:1px solid #293a52;border-radius:14px;padding:28px">` +
    `<h1 style="font-size:1.35rem;margin:0 0 12px">Reset your password</h1>` +
    `<p style="color:#a5b5cd;margin:0 0 20px">Hi ${name}, we received a request to reset your Sweam password. Choose a new one:</p>` +
    `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#4de0f3;color:#061827;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px">Set a new password</a></p>` +
    `<p style="color:#a5b5cd;font-size:0.85rem;margin:0">Or paste this link into your browser:<br><a href="${link}" style="color:#6fe1f2">${link}</a></p>` +
    `<p style="color:#a5b5cd;font-size:0.85rem;margin:16px 0 0">This link expires in 1 hour. If you did not request this, ignore this email; your password will not change.</p>` +
    `</div></body></html>`;
  return { subject, html, text };
}

/** Sent to the NEW address to confirm an email change (subject, HTML, text parts). */
export function emailChangeVerification(
  link: string,
  displayName: string,
): { subject: string; html: string; text: string } {
  const name = escapeHtml(displayName);
  const subject = 'Confirm your new email for Sweam';
  const text =
    `Hi ${displayName},\n\n` +
    `Confirm this address to make it the email on your Sweam account:\n${link}\n\n` +
    `This link expires in 24 hours. If you did not request this change, you can ignore this email; your account email will not change.`;
  const html =
    `<!doctype html><html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#080e19;color:#f4f7ff;padding:24px">` +
    `<div style="max-width:480px;margin:0 auto;background:#111c2d;border:1px solid #293a52;border-radius:14px;padding:28px">` +
    `<h1 style="font-size:1.35rem;margin:0 0 12px">Confirm your new email</h1>` +
    `<p style="color:#a5b5cd;margin:0 0 20px">Hi ${name}, confirm this address to make it the email on your Sweam account.</p>` +
    `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#4de0f3;color:#061827;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px">Confirm new email</a></p>` +
    `<p style="color:#a5b5cd;font-size:0.85rem;margin:0">Or paste this link into your browser:<br><a href="${link}" style="color:#6fe1f2">${link}</a></p>` +
    `<p style="color:#a5b5cd;font-size:0.85rem;margin:16px 0 0">This link expires in 24 hours. If you did not request this change, ignore this email; your account email will not change.</p>` +
    `</div></body></html>`;
  return { subject, html, text };
}
