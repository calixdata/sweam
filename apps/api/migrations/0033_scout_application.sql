-- Richer Scout applications + automated provisional approval.
-- A valid application (work-domain email + accepted terms + card on file via
-- Stripe Checkout) auto-grants access: the webhook sets status='approved' with
-- provisional=1. Admins can clear provisional (full confirm) or revoke (rejected).
ALTER TABLE scout_profiles ADD COLUMN first_name TEXT;
ALTER TABLE scout_profiles ADD COLUMN last_name TEXT;
ALTER TABLE scout_profiles ADD COLUMN position TEXT;
ALTER TABLE scout_profiles ADD COLUMN work_email TEXT;
ALTER TABLE scout_profiles ADD COLUMN terms_accepted_at TEXT;
-- Auto-approved on application and not yet manually confirmed by an admin.
ALTER TABLE scout_profiles ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;
-- One of the first 50 scouts: membership is free for the trial window.
ALTER TABLE scout_profiles ADD COLUMN beta_free INTEGER NOT NULL DEFAULT 0;
