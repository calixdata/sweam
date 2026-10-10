-- UCast: the fancast room. Members recast older films, TV series, songs,
-- musicals and music videos by naming who they would cast in each role, and
-- vote on each other's picks. Text only: no key art, no faces, no AI
-- likenesses. Sweam's own official account @ucast hosts the room and posts
-- the open calls.
--
-- ucast_works    the thing being recast (one row per title + year + kind)
-- ucast_recasts  one member's full cast for a work
-- ucast_picks    the role -> performer rows inside a recast
-- ucast_votes    "agree" votes on a single pick (one per member per pick)

CREATE TABLE ucast_works (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('film', 'tv', 'song', 'musical', 'music_video')),
  title       TEXT NOT NULL,
  year        INTEGER NOT NULL,
  hook        TEXT NOT NULL DEFAULT '',
  official    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_ucast_works_official ON ucast_works(official, created_at);
CREATE INDEX idx_ucast_works_kind ON ucast_works(kind, created_at);

CREATE TABLE ucast_recasts (
  id          TEXT PRIMARY KEY,
  work_id     TEXT NOT NULL REFERENCES ucast_works(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  headline    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'visible'
              CHECK (status IN ('visible', 'removed_by_author', 'removed_by_admin')),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_ucast_recasts_work ON ucast_recasts(work_id, status, created_at);
CREATE INDEX idx_ucast_recasts_author ON ucast_recasts(author_id, created_at);

CREATE TABLE ucast_picks (
  id                 TEXT PRIMARY KEY,
  recast_id          TEXT NOT NULL REFERENCES ucast_recasts(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL,
  role               TEXT NOT NULL,
  original_performer TEXT,
  pick               TEXT NOT NULL,
  note               TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_ucast_picks_recast ON ucast_picks(recast_id, position);

CREATE TABLE ucast_votes (
  pick_id    TEXT NOT NULL REFERENCES ucast_picks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pick_id, user_id)
);
CREATE INDEX idx_ucast_votes_user ON ucast_votes(user_id);

-- The room's host: Sweam's own account, official and verified. No password is
-- set; it is claimed through the password-reset email to its address, like
-- @sweam (migration 0035).
INSERT OR IGNORE INTO users
  (id, email, display_name, password_hash, created_at, email_verified, username, age_confirmed,
   official, verified, verified_at, is_demo)
VALUES
  ('usr_ucast', 'ucast@sweam.co', 'UCast', 'locked-claim-via-password-reset',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 'ucast', 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0);

-- Open calls posted by @ucast. Slugs follow lib/ucast.ts ucastWorkSlug():
-- slugified title, the year, and the kind unless it is a film.
INSERT OR IGNORE INTO ucast_works (id, slug, kind, title, year, hook, official, created_by, created_at) VALUES
  ('ucw_little_shop', 'little-shop-of-horrors-1986', 'film', 'Little Shop of Horrors', 1986,
   'Warner Bros. has owed us a remake for ten years. Cast it vocal-first.', 1, 'usr_ucast', '2026-10-09T00:00:00.000Z'),
  ('ucw_bodyguard', 'the-bodyguard-1992', 'film', 'The Bodyguard', 1992,
   'Rachel Marron is a pop superstar in danger. Cast the voice first.', 1, 'usr_ucast', '2026-10-09T00:00:01.000Z'),
  ('ucw_purple_rain', 'purple-rain-1984', 'film', 'Purple Rain', 1984,
   'A Minneapolis kid, a guitar, a father who could have been a star.', 1, 'usr_ucast', '2026-10-09T00:00:02.000Z'),
  ('ucw_coming_to_america', 'coming-to-america-1988', 'film', 'Coming to America', 1988,
   'Zamunda, Queens, and a barbershop full of legends.', 1, 'usr_ucast', '2026-10-09T00:00:03.000Z'),
  ('ucw_love_jones', 'love-jones-1997', 'film', 'Love Jones', 1997,
   'Chicago, a poetry night, the slowest burn in Black cinema.', 1, 'usr_ucast', '2026-10-09T00:00:04.000Z'),
  ('ucw_waiting_to_exhale', 'waiting-to-exhale-1995', 'film', 'Waiting to Exhale', 1995,
   'Four women, one Phoenix, a car that still has to burn.', 1, 'usr_ucast', '2026-10-09T00:00:05.000Z'),
  ('ucw_five_heartbeats', 'the-five-heartbeats-1991', 'film', 'The Five Heartbeats', 1991,
   'Five voices, one group, every temptation. Cast the harmony, not the faces.', 1, 'usr_ucast', '2026-10-09T00:00:06.000Z'),
  ('ucw_the_wiz', 'the-wiz-1978-musical', 'musical', 'The Wiz', 1978,
   'Ease on down with a cast for right now.', 1, 'usr_ucast', '2026-10-09T00:00:07.000Z'),
  ('ucw_dreamgirls', 'dreamgirls-2006-musical', 'musical', 'Dreamgirls', 2006,
   'Who sings And I Am Telling You today?', 1, 'usr_ucast', '2026-10-09T00:00:08.000Z'),
  ('ucw_moulin_rouge', 'moulin-rouge-2001-musical', 'musical', 'Moulin Rouge!', 2001,
   'Spectacular, spectacular: a Diamond Dogs lineup for today.', 1, 'usr_ucast', '2026-10-09T00:00:09.000Z'),
  ('ucw_carmen_jones', 'carmen-jones-1954-musical', 'musical', 'Carmen Jones', 1954,
   'Dandridge was dubbed. This Carmen sings every note herself.', 1, 'usr_ucast', '2026-10-09T00:00:10.000Z'),
  ('ucw_grease', 'grease-1978-musical', 'musical', 'Grease', 1978,
   'Rydell High with a doo-wop heart.', 1, 'usr_ucast', '2026-10-09T00:00:11.000Z'),
  ('ucw_endless_love', 'endless-love-1981-song', 'song', 'Endless Love', 1981,
   'Two voices, one duet. Who takes the Diana Ross part and who takes Lionel Richie''s?', 1, 'usr_ucast', '2026-10-09T00:00:12.000Z'),
  ('ucw_aint_no_mountain', 'ain-t-no-mountain-high-enough-1967-song', 'song', 'Ain''t No Mountain High Enough', 1967,
   'The most joyful duet Motown ever cut. One legend and one newcomer.', 1, 'usr_ucast', '2026-10-09T00:00:13.000Z'),
  ('ucw_closer_i_get', 'the-closer-i-get-to-you-1978-song', 'song', 'The Closer I Get to You', 1978,
   'A tribute as much as a recast: the Flack and Hathaway lineage.', 1, 'usr_ucast', '2026-10-09T00:00:14.000Z'),
  ('ucw_nothing_even_matters', 'nothing-even-matters-1998-song', 'song', 'Nothing Even Matters', 1998,
   'A tribute recast. Keep it gentle.', 1, 'usr_ucast', '2026-10-09T00:00:15.000Z'),
  ('ucw_shallow', 'shallow-2018-song', 'song', 'Shallow', 2018,
   'Who has the belt for the wordless bridge, and who has the barroom baritone?', 1, 'usr_ucast', '2026-10-09T00:00:16.000Z'),
  ('ucw_remember_the_time', 'remember-the-time-1992-music-video', 'music_video', 'Remember the Time', 1992,
   'A short film that ran on stunt casting. Keep that logic; recast the roles, not the man.', 1, 'usr_ucast', '2026-10-09T00:00:17.000Z'),
  ('ucw_telephone', 'telephone-2010-music-video', 'music_video', 'Telephone', 2010,
   'Two pop worlds, a prison yard and a diner. Who builds the visual world now?', 1, 'usr_ucast', '2026-10-09T00:00:18.000Z'),
  ('ucw_sister_sister', 'sister-sister-1994-tv', 'tv', 'Sister, Sister', 1994,
   'Real singing sisters as the twins?', 1, 'usr_ucast', '2026-10-09T00:00:19.000Z'),
  ('ucw_different_world', 'a-different-world-1987-tv', 'tv', 'A Different World', 1987,
   'Recasts the 1987 original only; not a comment on the new sequel series.', 1, 'usr_ucast', '2026-10-09T00:00:20.000Z');

-- The room's first recast: the flagship Little Shop of Horrors cast.
INSERT OR IGNORE INTO ucast_recasts (id, work_id, author_id, headline, note, status, created_at) VALUES
  ('ucr_little_shop_house', 'ucw_little_shop', 'usr_ucast',
   'Vocal-first, multi-generational: a funk legend next to two former teen idols.',
   'Mean Green Mother from Outer Space as a Gap Band funk record. Still casting Mr. Mushnik, Orin Scrivello DDS and the cameos: add your own cast below.',
   'visible', '2026-10-09T00:01:00.000Z');
INSERT OR IGNORE INTO ucast_picks (id, recast_id, position, role, original_performer, pick, note) VALUES
  ('ucp_ls_1', 'ucr_little_shop_house', 1, 'Seymour Krelborn', 'Rick Moranis', 'Justin Bieber', ''),
  ('ucp_ls_2', 'ucr_little_shop_house', 2, 'Audrey', 'Ellen Greene', 'Ariana Grande', ''),
  ('ucp_ls_3', 'ucr_little_shop_house', 3, 'Voice of Audrey II', 'Levi Stubbs', 'Charlie Wilson', 'Levi Stubbs of the Four Tops originated it in 1986.'),
  ('ucp_ls_4', 'ucr_little_shop_house', 4, 'Crystal', 'Tichina Arnold', 'Jazmine Sullivan', 'Crystal leads the sass, so the biggest voice.'),
  ('ucp_ls_5', 'ucr_little_shop_house', 5, 'Chiffon', 'Tisha Campbell', 'Coco Jones', 'The playful one; Jones has the comic timing.'),
  ('ucp_ls_6', 'ucr_little_shop_house', 6, 'Ronette', 'Michelle Weeks', 'Olivia Dean', 'The glue voice of the trio.');
