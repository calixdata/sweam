import { Hono } from 'hono';
import { SCOUT_ALL_ACCESS_CENTS } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso } from '../lib/http';
import { notify } from '../lib/notify';
import { requireUser, currentUser } from '../lib/session';
import {
  createAccountLink,
  createBillingPortal,
  createBluCheckout,
  createConnectAccount,
  createScoutCheckout,
  getConnectAccount,
  stripeConfigured,
  verifyWebhook,
} from '../lib/stripe';

/**
 * Sweam Blu billing (phase 2). Everything is gated by stripeConfigured: until
 * the STRIPE_SECRET_KEY secret is set, these refuse with 503 stripe_not_configured
 * instead of calling Stripe. Blu subscriptions are Connect destination charges
 * to the creator (80%, Sweam keeps 20%); scout all-access is a Sweam subscription.
 */
export const stripeRoutes = new Hono<AppEnv>();

interface CreatorBillingRow {
  user_id: string;
  handle: string;
  display_name: string;
  blu_price_cents: number | null;
  stripe_account_id: string | null;
}

// Subscribe to a creator's Blu — returns a Stripe Checkout URL to redirect to.
stripeRoutes.post('/blu/:handle', requireUser, async (c) => {
  if (!stripeConfigured(c.env)) fail(503, 'stripe_not_configured', 'Payments are not set up yet.');
  const user = currentUser(c);
  const creator = await c.env.DB.prepare(
    `SELECT cp.user_id, cp.handle, cp.blu_price_cents, cp.stripe_account_id, u.display_name
     FROM creator_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.handle = ?`,
  )
    .bind(c.req.param('handle'))
    .first<CreatorBillingRow>();
  if (!creator) fail(404, 'creator_not_found', 'No creator with that handle.');
  if (creator.user_id === user.id) fail(400, 'self_subscribe', 'You cannot subscribe to yourself.');
  if (!creator.blu_price_cents) fail(409, 'no_blu', 'This creator has no Blu content yet.');
  if (!creator.stripe_account_id) fail(409, 'creator_not_payable', 'This creator has not set up payouts yet.');

  const existing = await c.env.DB.prepare(
    "SELECT 1 AS x FROM blu_subscriptions WHERE subscriber_id = ? AND creator_id = ? AND status = 'active'",
  )
    .bind(user.id, creator.user_id)
    .first();
  if (existing) fail(409, 'already_subscribed', 'You already subscribe to this creator.');

  const session = await createBluCheckout(c.env, {
    customerEmail: user.email,
    priceCents: creator.blu_price_cents,
    creatorName: creator.display_name,
    creatorAccountId: creator.stripe_account_id,
    subscriberId: user.id,
    creatorId: creator.user_id,
    handle: creator.handle,
  });
  return c.json({ url: session.url });
});

// Buy scout all-access.
stripeRoutes.post('/scout', requireUser, async (c) => {
  if (!stripeConfigured(c.env)) fail(503, 'stripe_not_configured', 'Payments are not set up yet.');
  const user = currentUser(c);
  const existing = await c.env.DB.prepare(
    "SELECT 1 AS x FROM scout_all_access WHERE user_id = ? AND status = 'active'",
  )
    .bind(user.id)
    .first();
  if (existing) fail(409, 'already_active', 'Your scout all-access is already active.');
  const session = await createScoutCheckout(c.env, {
    customerEmail: user.email,
    priceCents: SCOUT_ALL_ACCESS_CENTS,
    userId: user.id,
  });
  return c.json({ url: session.url });
});

// Creator: start (or resume) Stripe Connect onboarding to receive payouts.
stripeRoutes.post('/connect', requireUser, async (c) => {
  if (!stripeConfigured(c.env)) fail(503, 'stripe_not_configured', 'Payments are not set up yet.');
  const user = currentUser(c);
  const cp = await c.env.DB.prepare('SELECT stripe_account_id FROM creator_profiles WHERE user_id = ?')
    .bind(user.id)
    .first<{ stripe_account_id: string | null }>();
  if (!cp) fail(403, 'not_a_creator', 'Only creators can set up payouts.');
  let accountId = cp.stripe_account_id;
  if (!accountId) {
    const account = await createConnectAccount(c.env, user.email);
    accountId = account.id;
    await c.env.DB.prepare('UPDATE creator_profiles SET stripe_account_id = ? WHERE user_id = ?')
      .bind(accountId, user.id)
      .run();
  }
  const link = await createAccountLink(c.env, accountId);
  return c.json({ url: link.url });
});

// Creator: payout onboarding status.
stripeRoutes.get('/connect', requireUser, async (c) => {
  const user = currentUser(c);
  const cp = await c.env.DB.prepare('SELECT stripe_account_id FROM creator_profiles WHERE user_id = ?')
    .bind(user.id)
    .first<{ stripe_account_id: string | null }>();
  if (!cp?.stripe_account_id || !stripeConfigured(c.env)) {
    return c.json({ connected: false, payoutsEnabled: false });
  }
  try {
    const account = await getConnectAccount(c.env, cp.stripe_account_id);
    return c.json({
      connected: true,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    });
  } catch {
    return c.json({ connected: true, payoutsEnabled: false });
  }
});

// Subscriber: open the Stripe Billing Portal to manage or cancel.
stripeRoutes.post('/portal', requireUser, async (c) => {
  if (!stripeConfigured(c.env)) fail(503, 'stripe_not_configured', 'Payments are not set up yet.');
  const user = currentUser(c);
  const row = await c.env.DB.prepare(
    `SELECT stripe_customer_id FROM blu_subscriptions WHERE subscriber_id = ?1 AND stripe_customer_id IS NOT NULL
     UNION
     SELECT stripe_customer_id FROM scout_all_access WHERE user_id = ?1 AND stripe_customer_id IS NOT NULL
     LIMIT 1`,
  )
    .bind(user.id)
    .first<{ stripe_customer_id: string | null }>();
  if (!row?.stripe_customer_id) fail(409, 'no_subscriptions', 'You have no subscriptions to manage.');
  const portal = await createBillingPortal(c.env, row.stripe_customer_id);
  return c.json({ url: portal.url });
});

// Stripe webhook: reconcile blu_subscriptions / scout_all_access from events.
// No auth; the Stripe-Signature header is verified instead.
stripeRoutes.post('/webhook', async (c) => {
  const payload = await c.req.text();
  const ok = await verifyWebhook(c.env, payload, c.req.header('stripe-signature') ?? null);
  if (!ok) fail(400, 'bad_signature', 'Invalid webhook signature.');

  const event = JSON.parse(payload) as { type: string; data: { object: unknown } };
  const obj = event.data.object as {
    metadata?: Record<string, string>;
    subscription?: string;
    customer?: string;
    id?: string;
    status?: string;
    current_period_end?: number;
  };
  const now = nowIso();

  if (event.type === 'checkout.session.completed') {
    const md = obj.metadata ?? {};
    if (md.kind === 'blu' && md.subscriberId && md.creatorId) {
      await c.env.DB.prepare(
        `INSERT INTO blu_subscriptions
           (id, subscriber_id, creator_id, status, price_cents, current_period_end, created_at, stripe_subscription_id, stripe_customer_id)
         VALUES (?, ?, ?, 'active', ?, NULL, ?, ?, ?)
         ON CONFLICT (subscriber_id, creator_id) DO UPDATE SET
           status = 'active', price_cents = excluded.price_cents,
           stripe_subscription_id = excluded.stripe_subscription_id,
           stripe_customer_id = excluded.stripe_customer_id, canceled_at = NULL`,
      )
        .bind(
          crypto.randomUUID(),
          md.subscriberId,
          md.creatorId,
          Number(md.priceCents ?? 0),
          now,
          obj.subscription ?? null,
          obj.customer ?? null,
        )
        .run();
      await notify(c.env.DB, md.creatorId, 'blu', 'You have a new Sweam Blu subscriber.', null);
    } else if (md.kind === 'scout' && md.userId) {
      await c.env.DB.prepare(
        `INSERT INTO scout_all_access
           (user_id, status, current_period_end, created_at, stripe_subscription_id, stripe_customer_id)
         VALUES (?, 'active', NULL, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           status = 'active', stripe_subscription_id = excluded.stripe_subscription_id,
           stripe_customer_id = excluded.stripe_customer_id, canceled_at = NULL`,
      )
        .bind(md.userId, now, obj.subscription ?? null, obj.customer ?? null)
        .run();
    }
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subId = obj.id ?? '';
    const status =
      event.type === 'customer.subscription.deleted'
        ? 'canceled'
        : obj.status === 'active' || obj.status === 'trialing'
          ? 'active'
          : obj.status === 'past_due'
            ? 'past_due'
            : 'canceled';
    const periodEnd = obj.current_period_end
      ? new Date(obj.current_period_end * 1000).toISOString()
      : null;
    const canceledAt = status === 'canceled' ? now : null;
    await c.env.DB.prepare(
      'UPDATE blu_subscriptions SET status = ?, current_period_end = ?, canceled_at = ? WHERE stripe_subscription_id = ?',
    )
      .bind(status, periodEnd, canceledAt, subId)
      .run();
    await c.env.DB.prepare(
      'UPDATE scout_all_access SET status = ?, current_period_end = ?, canceled_at = ? WHERE stripe_subscription_id = ?',
    )
      .bind(status, periodEnd, canceledAt, subId)
      .run();
  }

  return c.json({ received: true });
});
