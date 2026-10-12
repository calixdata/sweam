-- Licensed music library and audio provenance.
--
-- Sweam only ships music it may license: the library is public-domain recordings
-- (US military band recordings of public-domain compositions, or recordings the
-- performers released into the public domain), trimmed to 60 seconds. A clip
-- recorded in the app chooses a library track, keeps its own recorded sound, or
-- goes silent. A file uploaded from the device keeps whatever sound it has and
-- lands in the admin queue for a licensing check, where an admin can mute it.

CREATE TABLE music_tracks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  composer      TEXT NOT NULL,
  performer     TEXT NOT NULL,
  -- Where the recording came from (a URL an admin can check).
  source_url    TEXT NOT NULL,
  -- Only 'public-domain' today; the column exists so a licensed catalog can join later.
  license       TEXT NOT NULL DEFAULT 'public-domain' CHECK (license IN ('public-domain')),
  license_note  TEXT NOT NULL DEFAULT '',
  -- The trimmed track in R2 (/media/music/<id>.m4a), at most 60 seconds.
  url           TEXT NOT NULL,
  duration_s    INTEGER NOT NULL CHECK (duration_s > 0 AND duration_s <= 60),
  mood          TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- Where an episode's sound came from, and whether Sweam muted it.
--   original = the sound captured by the in-app recording
--   library  = a track from music_tracks replaced the recorded sound
--   none     = silent by the creator's choice
--   upload   = a file from the device with whatever sound it carried (reviewed)
ALTER TABLE episodes ADD COLUMN audio_source TEXT NOT NULL DEFAULT 'original'
  CHECK (audio_source IN ('original', 'library', 'none', 'upload'));
ALTER TABLE episodes ADD COLUMN music_track_id TEXT REFERENCES music_tracks(id) ON DELETE SET NULL;
ALTER TABLE episodes ADD COLUMN audio_muted_at TEXT;
ALTER TABLE episodes ADD COLUMN audio_muted_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- The licensing check on a clip's sound, alongside the content review.
--   none    = nothing to check (library track, silent, or in-app recorded sound)
--   needed  = an uploaded file with its own sound; an admin must listen
--   cleared = admin heard it and let it stand
--   muted   = admin muted it (a silent copy replaces the playback file)
ALTER TABLE clip_reviews ADD COLUMN audio_review TEXT NOT NULL DEFAULT 'none'
  CHECK (audio_review IN ('none', 'needed', 'cleared', 'muted'));

-- What the transcoder does with sound for this job.
--   keep    = carry the source audio through
--   mute    = drop all audio
--   replace = drop the source audio and lay the music track under the picture
ALTER TABLE transcode_jobs ADD COLUMN audio_mode TEXT NOT NULL DEFAULT 'keep'
  CHECK (audio_mode IN ('keep', 'mute', 'replace'));
ALTER TABLE transcode_jobs ADD COLUMN music_url TEXT;
-- Reported by the transcoder: whether the source file carried an audio stream.
ALTER TABLE transcode_jobs ADD COLUMN source_has_audio INTEGER;

CREATE INDEX idx_clip_reviews_audio ON clip_reviews (audio_review) WHERE audio_review = 'needed';
