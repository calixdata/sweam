-- Advertiser targeting. category labels each ad's advertiser vertical (Sweam's
-- inventory starts with streaming/entertainment advertisers); target_genre, when
-- set, restricts an ad to pre-rolls on titles of that genre (NULL = all genres).

ALTER TABLE ads ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE ads ADD COLUMN target_genre TEXT;
