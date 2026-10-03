-- Sweam Blu Fund + creator monetization defaults.
--
-- content_default: the Free/Blu pre-selection applied to a creator's NEW uploads
-- (existing titles are untouched; the per-title 30-day switch cooldown still
-- governs changes). dob + blu_fund_attested_at back the 18+ eligibility check:
-- both must be present (and the DOB >= 18) for the age criterion to be met.

ALTER TABLE creator_profiles ADD COLUMN content_default TEXT NOT NULL DEFAULT 'free';
ALTER TABLE creator_profiles ADD COLUMN dob TEXT;
ALTER TABLE creator_profiles ADD COLUMN blu_fund_attested_at TEXT;
