-- Creator content controls: "has ever been Blu" tracking and per-title download.
-- ever_blu: set to 1 the first time a title is Blu and never cleared, so a title
-- that was Blu in the past cannot be hard-deleted (only made private / removed).
-- allow_download: per FREE title, whether viewers may download/share the video
-- off Sweam. Forced off for Blu content. Off by default.
ALTER TABLE titles ADD COLUMN ever_blu INTEGER NOT NULL DEFAULT 0;
ALTER TABLE titles ADD COLUMN allow_download INTEGER NOT NULL DEFAULT 0;
UPDATE titles SET ever_blu = 1 WHERE is_blu = 1;
