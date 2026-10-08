-- Image posts: a creator can post a still photo (captured or uploaded) as a
-- promotional item. It shows in the feed and on a watch page like a clip, but
-- it is never monetized: no pre-roll ads, no Blu, and it does not count toward
-- the monetization thresholds. titles.promo_only marks such titles.
ALTER TABLE episodes ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video'
  CHECK (media_type IN ('video', 'image'));
ALTER TABLE titles ADD COLUMN promo_only INTEGER NOT NULL DEFAULT 0;
