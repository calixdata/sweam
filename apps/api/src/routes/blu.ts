import { Hono } from 'hono';
import { BLU_SWITCH_COOLDOWN_DAYS, bluTierById } from '@sweam/shared';
import type { AppEnv } from '../env';
import { BLU_NOT_ELIGIBLE_MESSAGE, getBluOfferGate } from '../lib/blufund';
import { isOfficialAccount } from '../lib/official';
import { fail, nowIso, parseBody } from '../lib/http';
import { notify, notifyFollowers } from '../lib/notify';
import { requireUser, currentUser } from '../lib/session';
import { bluTitleSchema } from '../lib/validate';

/** Creator-side Sweam Blu controls: mark a title Free or Blu (preset price). */
export const bluRoutes = new Hono<AppEnv>();

bluRoutes.use('*', requireUser);

interface BluTitleRow {
  id: string;
  creator_id: string;
  name: string;
  slug: string;
  is_blu: number;
  blu_price_cents: number | null;
  blu_changed_at: string | null;
  promo_only: number;
}

/**
 * PUT /api/blu/titles/:id — set a title to Free or Blu.
 *
 * Guardrails: the choice is explicit (isBlu is required); a Blu price must be
 * one of the preset tiers; a Free<->Blu switch is rate-limited to once per
 * BLU_SWITCH_COOLDOWN_DAYS so creators cannot bait-and-switch paying viewers;
 * and switching notifies the people it affects.
 */
bluRoutes.put('/titles/:id', async (c) => {
  const user = currentUser(c);
  const titleId = c.req.param('id');
  const body = await parseBody(c, bluTitleSchema);

  const title = await c.env.DB.prepare(
    'SELECT id, creator_id, name, slug, is_blu, blu_price_cents, blu_changed_at, promo_only FROM titles WHERE id = ?',
  )
    .bind(titleId)
    .first<BluTitleRow>();
  if (!title) fail(404, 'title_not_found', 'No such title.');
  if (title.creator_id !== user.id) fail(403, 'not_your_title', 'You can only change your own titles.');
  // Photo posts are promotional only and can never be monetized.
  if (body.isBlu && title.promo_only === 1) {
    fail(400, 'promo_only', 'Photo posts are promotional and cannot be Sweam Blu.');
  }

  // Preset pricing only — no free-form prices.
  let priceCents: number | null = null;
  if (body.isBlu) {
    const tier = bluTierById(body.tierId ?? '');
    if (!tier) fail(400, 'invalid_tier', 'Choose a Blu price from the preset options.');
    priceCents = tier.priceCents;
  }

  const wasBlu = title.is_blu === 1;
  const switching = body.isBlu !== wasBlu;
  const changingTier = body.isBlu && wasBlu && priceCents !== title.blu_price_cents;

  if (!switching && !changingTier) {
    return c.json({ isBlu: wasBlu, bluPriceCents: title.blu_price_cents, changed: false });
  }

  // Turning a title Blu is gated until the creator is Fund-eligible (or Blu is
  // open to everyone); admins bypass. Changing the price of already-Blu content
  // is not re-gated.
  if (body.isBlu && switching) {
    const gate = await getBluOfferGate(c.env.DB, user.id, user.isAdmin);
    if (!gate.canOfferBlu) fail(403, 'blu_not_eligible', BLU_NOT_ELIGIBLE_MESSAGE);
  }

  // Smart switch-governance: a Free<->Blu flip is limited to once per cooldown
  // (official accounts excepted).
  if (switching && title.blu_changed_at && !(await isOfficialAccount(c.env.DB, user.id))) {
    const days = (Date.now() - Date.parse(title.blu_changed_at)) / 86_400_000;
    if (Number.isFinite(days) && days < BLU_SWITCH_COOLDOWN_DAYS) {
      const wait = Math.max(1, Math.ceil(BLU_SWITCH_COOLDOWN_DAYS - days));
      fail(
        429,
        'blu_cooldown',
        `You can switch a title between Free and Blu once every ${BLU_SWITCH_COOLDOWN_DAYS} days. Try again in ${wait} day${wait === 1 ? '' : 's'}.`,
      );
    }
  }

  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE titles SET is_blu = ?, blu_price_cents = ?, blu_changed_at = ?, ever_blu = MAX(ever_blu, ?) WHERE id = ?',
    ).bind(
      body.isBlu ? 1 : 0,
      priceCents,
      switching ? now : (title.blu_changed_at ?? now),
      body.isBlu ? 1 : 0,
      titleId,
    ),
    c.env.DB.prepare(
      `INSERT INTO blu_switch_log (id, title_id, actor_id, from_blu, to_blu, price_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), titleId, user.id, wasBlu ? 1 : 0, body.isBlu ? 1 : 0, priceCents, now),
  ]);

  // One Blu price per creator (a subscription unlocks all their Blu content):
  // the tier chosen here sets the creator's subscription price.
  if (body.isBlu && priceCents != null) {
    await c.env.DB.prepare('UPDATE creator_profiles SET blu_price_cents = ? WHERE user_id = ?')
      .bind(priceCents, user.id)
      .run();
  }

  // Notify the people a switch affects (a mere price change within Blu does not notify).
  if (switching) {
    if (body.isBlu) {
      // Free -> Blu: it is no longer free. Tell the creator's followers.
      await notifyFollowers(
        c.env.DB,
        user.id,
        'blu',
        `${title.name} is now Sweam Blu and no longer free. Subscribe to keep watching.`,
        `/t/${title.slug}`,
      );
    } else {
      // Blu -> Free: tell current subscribers it is now free for everyone.
      const { results } = await c.env.DB.prepare(
        "SELECT subscriber_id FROM blu_subscriptions WHERE creator_id = ? AND status = 'active'",
      )
        .bind(user.id)
        .all<{ subscriber_id: string }>();
      for (const r of results) {
        await notify(c.env.DB, r.subscriber_id, 'blu', `${title.name} is now free on Sweam.`, `/t/${title.slug}`);
      }
    }
  }

  return c.json({ isBlu: body.isBlu, bluPriceCents: priceCents, changed: true });
});
