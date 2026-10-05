-- Scout membership = scout portal + all-access to Sweam Blu, one fee.
--
-- 1. The first-50 free period lives on the membership row (trial_end), so a
--    scout approved without a card can hold a free membership that ends by
--    itself, and a later checkout can carry the remaining free days over.
-- 2. Demo/seed accounts are flagged so paying scouts never see mock data on
--    the boards and seed viewers never show up in account search.
-- 3. Per-episode views read progress by episode; index it.
ALTER TABLE scout_all_access ADD COLUMN trial_end TEXT;
ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_demo = 1 WHERE email LIKE '%@demo.sweam' OR email LIKE '%@seed.sweam';
CREATE INDEX IF NOT EXISTS idx_progress_episode ON progress(episode_id);

-- Scouts approved before billing went live are among the first 50: their free
-- 3 months start now (billing launch), no card required until it ends. Demo
-- scouts and scouts who already hold a membership are skipped.
INSERT INTO scout_all_access (user_id, status, current_period_end, created_at, trial_end)
SELECT sp.user_id, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days')
FROM scout_profiles sp
JOIN users u ON u.id = sp.user_id
WHERE sp.status = 'approved' AND u.is_demo = 0
  AND NOT EXISTS (SELECT 1 FROM scout_all_access a WHERE a.user_id = sp.user_id)
ORDER BY sp.created_at
LIMIT 50;

UPDATE scout_profiles SET beta_free = 1
WHERE status = 'approved' AND beta_free = 0
  AND user_id IN (
    SELECT user_id FROM scout_all_access
    WHERE trial_end IS NOT NULL AND stripe_subscription_id IS NULL
  );
