-- A pinned "featured" title for the home hero, plus an optional wide hero image
-- per title (the poster is 2:3; the hero art is landscape).

ALTER TABLE titles ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE titles ADD COLUMN hero_url TEXT;
