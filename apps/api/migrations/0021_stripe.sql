-- Stripe wiring for Sweam Blu billing + Connect payouts (phase 2).
-- A creator connects a Stripe account to receive 80% payouts; subscriptions
-- and scout all-access store their Stripe ids so webhooks can reconcile them.
ALTER TABLE creator_profiles ADD COLUMN stripe_account_id TEXT;
-- One Blu subscription price per creator; subscribing unlocks all their Blu content.
ALTER TABLE creator_profiles ADD COLUMN blu_price_cents INTEGER;

ALTER TABLE blu_subscriptions ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE blu_subscriptions ADD COLUMN stripe_customer_id TEXT;

ALTER TABLE scout_all_access ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE scout_all_access ADD COLUMN stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_blu_subs_stripe ON blu_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_scout_stripe ON scout_all_access(stripe_subscription_id);
