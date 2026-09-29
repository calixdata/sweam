-- 16+ age attestation, audience/genre/sub-genre taxonomy, adaptation rights,
-- and platform-wide @usernames for every account.

-- ---------------------------------------------------------------------------
-- Usernames: every account gets a unique public @username. Existing creators
-- keep their handle as their username; everyone else gets a generated one they
-- can change in settings. Also record the 16+ age attestation (grandfathered).
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN age_confirmed INTEGER NOT NULL DEFAULT 0;

UPDATE users SET age_confirmed = 1;

UPDATE users
  SET username = (SELECT cp.handle FROM creator_profiles cp WHERE cp.user_id = users.id)
  WHERE EXISTS (SELECT 1 FROM creator_profiles cp WHERE cp.user_id = users.id);

UPDATE users
  SET username = 'u_' || lower(hex(randomblob(6)))
  WHERE username IS NULL;

CREATE UNIQUE INDEX idx_users_username ON users (username COLLATE NOCASE);

-- ---------------------------------------------------------------------------
-- Taxonomy: audience tier + multi-select genres + sub-genres, stored as JSON
-- arrays. The existing single `genre` column stays as the primary genre (it
-- drives cards, the poster hue, and browse filtering) and its CHECK is intact.
-- ---------------------------------------------------------------------------
ALTER TABLE titles ADD COLUMN audiences TEXT NOT NULL DEFAULT '[]';
ALTER TABLE titles ADD COLUMN genres TEXT NOT NULL DEFAULT '[]';
ALTER TABLE titles ADD COLUMN subgenres TEXT NOT NULL DEFAULT '[]';

UPDATE titles SET genres = json_array(genre) WHERE genres = '[]';

ALTER TABLE submissions ADD COLUMN audiences TEXT NOT NULL DEFAULT '[]';
ALTER TABLE submissions ADD COLUMN genres TEXT NOT NULL DEFAULT '[]';
ALTER TABLE submissions ADD COLUMN subgenres TEXT NOT NULL DEFAULT '[]';

UPDATE submissions SET genres = json_array(genre) WHERE genres = '[]';

-- ---------------------------------------------------------------------------
-- Adaptation of third-party published work: a yes/no on submission, plus proof
-- of rights, identification, and an attestation/hold-harmless when yes.
-- ---------------------------------------------------------------------------
ALTER TABLE submissions ADD COLUMN is_adaptation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN adaptation_source TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN rights_proof_url TEXT;
ALTER TABLE submissions ADD COLUMN id_proof_url TEXT;
ALTER TABLE submissions ADD COLUMN adaptation_attested INTEGER NOT NULL DEFAULT 0;
