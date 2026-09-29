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
  message: { to: string; subject: string; html: string; text: string },
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
