import type { Env } from '../env';

/**
 * A minimal Stripe client over the REST API using fetch, so the Worker needs no
 * SDK. Everything is gated by `stripeConfigured`: until STRIPE_SECRET_KEY is
 * set, the billing routes refuse cleanly rather than calling Stripe.
 *
 * Model: Blu subscriptions are Checkout subscriptions with a Connect destination
 * charge to the creator's connected account and a 20% application fee (Sweam's
 * cut); scout all-access is a plain Sweam subscription. A webhook reconciles the
 * `blu_subscriptions` / `scout_all_access` tables from Stripe events.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export function stripeConfigured(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function webUrl(env: Env): string {
  return (env.PUBLIC_WEB_URL ?? 'https://sweam.co').replace(/\/+$/, '');
}

/** Flatten a nested object into Stripe's bracketed form-encoding. */
function toForm(obj: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') {
          parts.push(...toForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (v && typeof v === 'object') {
      parts.push(...toForm(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts;
}

async function stripeRequest<T>(
  env: Env,
  method: 'POST' | 'GET',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new Error('stripe_not_configured');
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body ? toForm(body).join('&') : undefined,
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `Stripe request failed (${res.status}).`);
  }
  return data as T;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/** A Checkout subscription for a creator's Blu, with a Connect destination + 20% fee. */
export function createBluCheckout(
  env: Env,
  opts: {
    customerEmail: string;
    priceCents: number;
    creatorName: string;
    creatorAccountId: string;
    subscriberId: string;
    creatorId: string;
    handle: string;
  },
): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>(env, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    customer_email: opts.customerEmail,
    success_url: `${webUrl(env)}/c/${opts.handle}?blu=success`,
    cancel_url: `${webUrl(env)}/c/${opts.handle}?blu=cancel`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: opts.priceCents,
          recurring: { interval: 'month' },
          product_data: { name: `Sweam Blu — ${opts.creatorName}` },
        },
      },
    ],
    subscription_data: {
      application_fee_percent: 20,
      transfer_data: { destination: opts.creatorAccountId },
      metadata: { kind: 'blu', subscriberId: opts.subscriberId, creatorId: opts.creatorId, priceCents: opts.priceCents },
    },
    metadata: { kind: 'blu', subscriberId: opts.subscriberId, creatorId: opts.creatorId },
  });
}

/** A Checkout subscription for scout all-access (kept by Sweam, no destination). */
export function createScoutCheckout(
  env: Env,
  opts: { customerEmail: string; priceCents: number; userId: string },
): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>(env, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    customer_email: opts.customerEmail,
    success_url: `${webUrl(env)}/scout?access=success`,
    cancel_url: `${webUrl(env)}/scout?access=cancel`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: opts.priceCents,
          recurring: { interval: 'month' },
          product_data: { name: 'Sweam Scout All-Access' },
        },
      },
    ],
    subscription_data: { metadata: { kind: 'scout', userId: opts.userId } },
    metadata: { kind: 'scout', userId: opts.userId },
  });
}

/** Create a Connect Express account for a creator to receive payouts. */
export function createConnectAccount(env: Env, email: string): Promise<{ id: string }> {
  return stripeRequest<{ id: string }>(env, 'POST', '/accounts', {
    type: 'express',
    email,
    capabilities: { transfers: { requested: true } },
  });
}

/** An onboarding link for a creator to finish connecting their Stripe account. */
export function createAccountLink(env: Env, accountId: string): Promise<{ url: string }> {
  return stripeRequest<{ url: string }>(env, 'POST', '/account_links', {
    account: accountId,
    refresh_url: `${webUrl(env)}/studio?connect=refresh`,
    return_url: `${webUrl(env)}/studio?connect=done`,
    type: 'account_onboarding',
  });
}

export function getConnectAccount(
  env: Env,
  accountId: string,
): Promise<{ id: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean }> {
  return stripeRequest(env, 'GET', `/accounts/${accountId}`);
}

/** A Stripe Billing Portal link so a subscriber can manage or cancel. */
export function createBillingPortal(env: Env, customerId: string): Promise<{ url: string }> {
  return stripeRequest<{ url: string }>(env, 'POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: `${webUrl(env)}/me/subscriptions`,
  });
}

/** Verify the Stripe-Signature header (v1 HMAC-SHA256 over `${t}.${payload}`). */
export async function verifyWebhook(env: Env, payload: string, sigHeader: string | null): Promise<boolean> {
  if (!env.STRIPE_WEBHOOK_SECRET || !sigHeader) return false;
  const fields = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx), p.slice(idx + 1)];
    }),
  );
  const t = fields['t'];
  const v1 = fields['v1'];
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
