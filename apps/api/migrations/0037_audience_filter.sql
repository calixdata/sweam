-- Audience filtering for For You and the feed.
--
-- A viewer can keep their For You and feed to women creators or to men
-- creators. Two signals back it:
--   users.sex            self-declared at sign-up (required, freely changeable).
--   users.verified_sex   the sex marker on the government ID an admin reviewed
--                        during identity verification. Null until recorded.
-- A viewer who turns on "verified accounts only" trusts verified_sex alone;
-- otherwise the filter falls back to the self-declared value. Nonbinary and
-- undisclosed accounts match neither the women nor the men filter.
--
-- users.feed_audience / feed_audience_verified hold the viewer's own choice.
ALTER TABLE users ADD COLUMN sex TEXT NOT NULL DEFAULT 'undisclosed'
  CHECK (sex IN ('female', 'male', 'nonbinary', 'undisclosed'));
ALTER TABLE users ADD COLUMN verified_sex TEXT
  CHECK (verified_sex IN ('female', 'male'));
ALTER TABLE users ADD COLUMN feed_audience TEXT NOT NULL DEFAULT 'all'
  CHECK (feed_audience IN ('all', 'women', 'men'));
ALTER TABLE users ADD COLUMN feed_audience_verified INTEGER NOT NULL DEFAULT 0;

-- The sex marker the reviewer reads off the ID, kept with the request.
ALTER TABLE identity_verifications ADD COLUMN sex TEXT
  CHECK (sex IN ('female', 'male'));
