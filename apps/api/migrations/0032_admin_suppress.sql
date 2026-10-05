-- Admin suppression: a reversible investigation hold on a live title.
-- Suppressing sets suppressed = 1 and published = 0, so the title drops out of
-- every public surface (all of which filter published = 1). While suppressed the
-- creator cannot publish, unpublish, or delete it, and only admins can watch it.
-- Unsuppressing clears the flag and republishes it.
ALTER TABLE titles ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0;
