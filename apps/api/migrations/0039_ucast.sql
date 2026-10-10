-- UCast: Sweam's recasting polls. A poll takes an older film, TV series, song,
-- musical or music video with a fixed list of roles; members submit one
-- ballot each (who they would cast per role) and agree with other members'
-- picks; the poll closes on a date set by an admin and results are posted
-- within 48 hours of closing. Members may REQUEST a poll; every request is
-- de-duplicated and reviewed by a Sweam/UCast admin before it opens. Text
-- only: no faces, no AI likenesses. Covers are set by admins. Results are the
-- product: scouts get every poll's full results.
--
-- ucast_works    one poll (title + year + kind): request -> open -> closed
-- ucast_roles    the roles of a poll, defined by the admin who opened it
-- ucast_recasts  one member's ballot for a poll (one per member per poll)
-- ucast_picks    the role -> performer rows inside a ballot
-- ucast_votes    "agree" votes on a single pick (one per member per pick)

CREATE TABLE ucast_works (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL CHECK (kind IN ('film', 'tv', 'song', 'musical', 'music_video')),
  title          TEXT NOT NULL,
  year           INTEGER NOT NULL,
  hook           TEXT NOT NULL DEFAULT '',
  cover_url      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'open', 'closed', 'rejected')),
  official       INTEGER NOT NULL DEFAULT 0,
  requested_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_note TEXT NOT NULL DEFAULT '',
  dedupe_note    TEXT NOT NULL DEFAULT '',
  admin_note     TEXT NOT NULL DEFAULT '',
  opens_at       TEXT,
  closes_at      TEXT,
  results_at     TEXT,
  results_note   TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  decided_at     TEXT
);
CREATE INDEX idx_ucast_works_status ON ucast_works(status, closes_at);
CREATE INDEX idx_ucast_works_requester ON ucast_works(requested_by, created_at);

CREATE TABLE ucast_roles (
  id                 TEXT PRIMARY KEY,
  work_id            TEXT NOT NULL REFERENCES ucast_works(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL,
  name               TEXT NOT NULL,
  original_performer TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_ucast_roles_work ON ucast_roles(work_id, position);

CREATE TABLE ucast_recasts (
  id          TEXT PRIMARY KEY,
  work_id     TEXT NOT NULL REFERENCES ucast_works(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'visible'
              CHECK (status IN ('visible', 'removed_by_author', 'removed_by_admin')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_ucast_recasts_ballot ON ucast_recasts(work_id, author_id);
CREATE INDEX idx_ucast_recasts_author ON ucast_recasts(author_id, created_at);

CREATE TABLE ucast_picks (
  id         TEXT PRIMARY KEY,
  recast_id  TEXT NOT NULL REFERENCES ucast_recasts(id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL REFERENCES ucast_roles(id) ON DELETE CASCADE,
  pick       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_ucast_picks_role ON ucast_picks(recast_id, role_id);
CREATE INDEX idx_ucast_picks_role_only ON ucast_picks(role_id);

CREATE TABLE ucast_votes (
  pick_id    TEXT NOT NULL REFERENCES ucast_picks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pick_id, user_id)
);
CREATE INDEX idx_ucast_votes_user ON ucast_votes(user_id);

-- The host: Sweam's own account, official and verified. No password is set;
-- it is claimed through the password-reset email to its address, like @sweam.
INSERT OR IGNORE INTO users
  (id, email, display_name, password_hash, created_at, email_verified, username, age_confirmed,
   official, verified, verified_at, is_demo)
VALUES
  ('usr_ucast', 'ucast@sweam.co', 'UCast', 'locked-claim-via-password-reset',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 'ucast', 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0);

-- The launch polls, posted by @ucast, open for 30 days from 2026-10-10.
-- Slugs follow lib/ucast.ts ucastWorkSlug(): title, year, and the kind unless film.
INSERT OR IGNORE INTO ucast_works
  (id, slug, kind, title, year, hook, status, official, requested_by, opens_at, closes_at, created_at, decided_at) VALUES
  ('ucw_little_shop', 'little-shop-of-horrors-1986', 'film', 'Little Shop of Horrors', 1986,
   'Warner Bros. has owed us a remake for ten years. Cast it vocal-first.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_bodyguard', 'the-bodyguard-1992', 'film', 'The Bodyguard', 1992,
   'Rachel Marron is a pop superstar in danger. Cast the voice first.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:01.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_purple_rain', 'purple-rain-1984', 'film', 'Purple Rain', 1984,
   'A Minneapolis kid, a guitar, a father who could have been a star.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:02.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_coming_to_america', 'coming-to-america-1988', 'film', 'Coming to America', 1988,
   'Zamunda, Queens, and a barbershop full of legends.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:03.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_love_jones', 'love-jones-1997', 'film', 'Love Jones', 1997,
   'Chicago, a poetry night, the slowest burn in Black cinema.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:04.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_waiting_to_exhale', 'waiting-to-exhale-1995', 'film', 'Waiting to Exhale', 1995,
   'Four women, one Phoenix, a car that still has to burn.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:05.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_five_heartbeats', 'the-five-heartbeats-1991', 'film', 'The Five Heartbeats', 1991,
   'Five voices, one group, every temptation. Cast the harmony, not the faces.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:06.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_the_wiz', 'the-wiz-1978-musical', 'musical', 'The Wiz', 1978,
   'Ease on down with a cast for right now.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:07.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_dreamgirls', 'dreamgirls-2006-musical', 'musical', 'Dreamgirls', 2006,
   'Who sings And I Am Telling You today?',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:08.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_moulin_rouge', 'moulin-rouge-2001-musical', 'musical', 'Moulin Rouge!', 2001,
   'Spectacular, spectacular: a Diamond Dogs lineup for today.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:09.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_carmen_jones', 'carmen-jones-1954-musical', 'musical', 'Carmen Jones', 1954,
   'Dandridge was dubbed. This Carmen sings every note herself.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:10.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_grease', 'grease-1978-musical', 'musical', 'Grease', 1978,
   'Rydell High with a doo-wop heart.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:11.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_endless_love', 'endless-love-1981-song', 'song', 'Endless Love', 1981,
   'Two voices, one duet. Who takes each part?',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:12.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_aint_no_mountain', 'ain-t-no-mountain-high-enough-1967-song', 'song', 'Ain''t No Mountain High Enough', 1967,
   'The most joyful duet Motown ever cut. One legend and one newcomer.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:13.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_closer_i_get', 'the-closer-i-get-to-you-1978-song', 'song', 'The Closer I Get to You', 1978,
   'A tribute as much as a recast: the Flack and Hathaway lineage.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:14.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_nothing_even_matters', 'nothing-even-matters-1998-song', 'song', 'Nothing Even Matters', 1998,
   'A tribute recast. Keep it gentle.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:15.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_shallow', 'shallow-2018-song', 'song', 'Shallow', 2018,
   'Who has the belt for the wordless bridge, and who has the barroom baritone?',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:16.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_remember_the_time', 'remember-the-time-1992-music-video', 'music_video', 'Remember the Time', 1992,
   'A short film that ran on stunt casting. Recast the roles, not the man.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:17.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_telephone', 'telephone-2010-music-video', 'music_video', 'Telephone', 2010,
   'Two pop worlds, a prison yard and a diner. Who builds the visual world now?',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:18.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_sister_sister', 'sister-sister-1994-tv', 'tv', 'Sister, Sister', 1994,
   'Real singing sisters as the twins?',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:19.000Z', '2026-10-10T00:00:00.000Z'),
  ('ucw_different_world', 'a-different-world-1987-tv', 'tv', 'A Different World', 1987,
   'Recasts the 1987 original only; not a comment on the new sequel series.',
   'open', 1, 'usr_ucast', '2026-10-10T04:00:00.000Z', '2026-11-09T04:59:59.000Z', '2026-10-10T00:00:20.000Z', '2026-10-10T00:00:00.000Z');

-- The roles of each launch poll (original performer where it is a role).
INSERT OR IGNORE INTO ucast_roles (id, work_id, position, name, original_performer) VALUES
  ('ucrl_ls_1', 'ucw_little_shop', 1, 'Seymour Krelborn', 'Rick Moranis'),
  ('ucrl_ls_2', 'ucw_little_shop', 2, 'Audrey', 'Ellen Greene'),
  ('ucrl_ls_3', 'ucw_little_shop', 3, 'Voice of Audrey II', 'Levi Stubbs'),
  ('ucrl_ls_4', 'ucw_little_shop', 4, 'Mr. Mushnik', 'Vincent Gardenia'),
  ('ucrl_ls_5', 'ucw_little_shop', 5, 'Orin Scrivello, DDS', 'Steve Martin'),
  ('ucrl_ls_6', 'ucw_little_shop', 6, 'Crystal', 'Tichina Arnold'),
  ('ucrl_ls_7', 'ucw_little_shop', 7, 'Chiffon', 'Tisha Campbell'),
  ('ucrl_ls_8', 'ucw_little_shop', 8, 'Ronette', 'Michelle Weeks'),
  ('ucrl_bg_1', 'ucw_bodyguard', 1, 'Rachel Marron', 'Whitney Houston'),
  ('ucrl_bg_2', 'ucw_bodyguard', 2, 'Frank Farmer', 'Kevin Costner'),
  ('ucrl_bg_3', 'ucw_bodyguard', 3, 'Nicki Marron', 'Michele Lamar Richards'),
  ('ucrl_bg_4', 'ucw_bodyguard', 4, 'Bill Devaney', 'Bill Cobbs'),
  ('ucrl_pr_1', 'ucw_purple_rain', 1, 'The Kid', 'Prince'),
  ('ucrl_pr_2', 'ucw_purple_rain', 2, 'Apollonia', 'Apollonia Kotero'),
  ('ucrl_pr_3', 'ucw_purple_rain', 3, 'Morris Day', 'Morris Day'),
  ('ucrl_pr_4', 'ucw_purple_rain', 4, 'Jerome Benton', 'Jerome Benton'),
  ('ucrl_pr_5', 'ucw_purple_rain', 5, 'Francis L.', 'Clarence Williams III'),
  ('ucrl_pr_6', 'ucw_purple_rain', 6, 'Wendy and Lisa', 'Wendy Melvoin and Lisa Coleman'),
  ('ucrl_ca_1', 'ucw_coming_to_america', 1, 'Prince Akeem', 'Eddie Murphy'),
  ('ucrl_ca_2', 'ucw_coming_to_america', 2, 'Semmi', 'Arsenio Hall'),
  ('ucrl_ca_3', 'ucw_coming_to_america', 3, 'King Jaffe Joffer', 'James Earl Jones'),
  ('ucrl_ca_4', 'ucw_coming_to_america', 4, 'Queen Aoleon', 'Madge Sinclair'),
  ('ucrl_ca_5', 'ucw_coming_to_america', 5, 'Lisa McDowell', 'Shari Headley'),
  ('ucrl_ca_6', 'ucw_coming_to_america', 6, 'Randy Watson', 'Eddie Murphy'),
  ('ucrl_lj_1', 'ucw_love_jones', 1, 'Darius Lovehall', 'Larenz Tate'),
  ('ucrl_lj_2', 'ucw_love_jones', 2, 'Nina Mosley', 'Nia Long'),
  ('ucrl_lj_3', 'ucw_love_jones', 3, 'Josie Nichols', 'Lisa Nicole Carson'),
  ('ucrl_lj_4', 'ucw_love_jones', 4, 'Savon Garrison', 'Isaiah Washington'),
  ('ucrl_lj_5', 'ucw_love_jones', 5, 'Hollywood', 'Bill Bellamy'),
  ('ucrl_we_1', 'ucw_waiting_to_exhale', 1, 'Savannah Jackson', 'Whitney Houston'),
  ('ucrl_we_2', 'ucw_waiting_to_exhale', 2, 'Bernadine Harris', 'Angela Bassett'),
  ('ucrl_we_3', 'ucw_waiting_to_exhale', 3, 'Robin Stokes', 'Lela Rochon'),
  ('ucrl_we_4', 'ucw_waiting_to_exhale', 4, 'Gloria Matthews', 'Loretta Devine'),
  ('ucrl_we_5', 'ucw_waiting_to_exhale', 5, 'Marvin King', 'Gregory Hines'),
  ('ucrl_fh_1', 'ucw_five_heartbeats', 1, 'Duck', 'Robert Townsend'),
  ('ucrl_fh_2', 'ucw_five_heartbeats', 2, 'Eddie King Jr.', 'Michael Wright'),
  ('ucrl_fh_3', 'ucw_five_heartbeats', 3, 'J.T.', 'Leon'),
  ('ucrl_fh_4', 'ucw_five_heartbeats', 4, 'Dresser', 'Harry J. Lennix'),
  ('ucrl_fh_5', 'ucw_five_heartbeats', 5, 'Choirboy', 'Tico Wells'),
  ('ucrl_fh_6', 'ucw_five_heartbeats', 6, 'Jimmy Potter', 'Chuck Patterson'),
  ('ucrl_fh_7', 'ucw_five_heartbeats', 7, 'Big Red', 'Hawthorne James'),
  ('ucrl_wz_1', 'ucw_the_wiz', 1, 'Dorothy', 'Diana Ross'),
  ('ucrl_wz_2', 'ucw_the_wiz', 2, 'Scarecrow', 'Michael Jackson'),
  ('ucrl_wz_3', 'ucw_the_wiz', 3, 'Tin Man', 'Nipsey Russell'),
  ('ucrl_wz_4', 'ucw_the_wiz', 4, 'Cowardly Lion', 'Ted Ross'),
  ('ucrl_wz_5', 'ucw_the_wiz', 5, 'The Wiz', 'Richard Pryor'),
  ('ucrl_wz_6', 'ucw_the_wiz', 6, 'Evillene', 'Mabel King'),
  ('ucrl_wz_7', 'ucw_the_wiz', 7, 'Glinda', 'Lena Horne'),
  ('ucrl_dg_1', 'ucw_dreamgirls', 1, 'Effie White', 'Jennifer Hudson'),
  ('ucrl_dg_2', 'ucw_dreamgirls', 2, 'Deena Jones', 'Beyoncé'),
  ('ucrl_dg_3', 'ucw_dreamgirls', 3, 'Lorrell Robinson', 'Anika Noni Rose'),
  ('ucrl_dg_4', 'ucw_dreamgirls', 4, 'Jimmy Early', 'Eddie Murphy'),
  ('ucrl_dg_5', 'ucw_dreamgirls', 5, 'Curtis Taylor Jr.', 'Jamie Foxx'),
  ('ucrl_dg_6', 'ucw_dreamgirls', 6, 'C.C. White', 'Keith Robinson'),
  ('ucrl_dg_7', 'ucw_dreamgirls', 7, 'Marty Madison', 'Danny Glover'),
  ('ucrl_mr_1', 'ucw_moulin_rouge', 1, 'Satine', 'Nicole Kidman'),
  ('ucrl_mr_2', 'ucw_moulin_rouge', 2, 'Christian', 'Ewan McGregor'),
  ('ucrl_mr_3', 'ucw_moulin_rouge', 3, 'Harold Zidler', 'Jim Broadbent'),
  ('ucrl_mr_4', 'ucw_moulin_rouge', 4, 'The Duke', 'Richard Roxburgh'),
  ('ucrl_mr_5', 'ucw_moulin_rouge', 5, 'Toulouse-Lautrec', 'John Leguizamo'),
  ('ucrl_mr_6', 'ucw_moulin_rouge', 6, 'The Argentinean', 'Jacek Koman'),
  ('ucrl_mr_7', 'ucw_moulin_rouge', 7, 'The Diamond Dogs (Lady Marmalade)', 'Christina Aguilera, Lil'' Kim, Mýa, P!nk'),
  ('ucrl_cj_1', 'ucw_carmen_jones', 1, 'Carmen Jones', 'Dorothy Dandridge'),
  ('ucrl_cj_2', 'ucw_carmen_jones', 2, 'Joe', 'Harry Belafonte'),
  ('ucrl_cj_3', 'ucw_carmen_jones', 3, 'Cindy Lou', 'Olga James'),
  ('ucrl_cj_4', 'ucw_carmen_jones', 4, 'Husky Miller', 'Joe Adams'),
  ('ucrl_cj_5', 'ucw_carmen_jones', 5, 'Frankie', 'Pearl Bailey'),
  ('ucrl_gr_1', 'ucw_grease', 1, 'Danny Zuko', 'John Travolta'),
  ('ucrl_gr_2', 'ucw_grease', 2, 'Sandy Olsson', 'Olivia Newton-John'),
  ('ucrl_gr_3', 'ucw_grease', 3, 'Betty Rizzo', 'Stockard Channing'),
  ('ucrl_gr_4', 'ucw_grease', 4, 'Kenickie', 'Jeff Conaway'),
  ('ucrl_gr_5', 'ucw_grease', 5, 'Frenchy', 'Didi Conn'),
  ('ucrl_gr_6', 'ucw_grease', 6, 'Teen Angel', 'Frankie Avalon'),
  ('ucrl_gr_7', 'ucw_grease', 7, 'Johnny Casino', 'Sha Na Na'),
  ('ucrl_el_1', 'ucw_endless_love', 1, 'The Diana Ross part', 'Diana Ross'),
  ('ucrl_el_2', 'ucw_endless_love', 2, 'The Lionel Richie part', 'Lionel Richie'),
  ('ucrl_el_3', 'ucw_endless_love', 3, 'Producer', 'Lionel Richie'),
  ('ucrl_am_1', 'ucw_aint_no_mountain', 1, 'The Tammi Terrell part', 'Tammi Terrell'),
  ('ucrl_am_2', 'ucw_aint_no_mountain', 2, 'The Marvin Gaye part', 'Marvin Gaye'),
  ('ucrl_ci_1', 'ucw_closer_i_get', 1, 'The Roberta Flack part', 'Roberta Flack'),
  ('ucrl_ci_2', 'ucw_closer_i_get', 2, 'The Donny Hathaway part', 'Donny Hathaway'),
  ('ucrl_nm_1', 'ucw_nothing_even_matters', 1, 'The Lauryn Hill part', 'Lauryn Hill'),
  ('ucrl_nm_2', 'ucw_nothing_even_matters', 2, 'The D''Angelo part', 'D''Angelo'),
  ('ucrl_sh_1', 'ucw_shallow', 1, 'The Lady Gaga part', 'Lady Gaga'),
  ('ucrl_sh_2', 'ucw_shallow', 2, 'The Bradley Cooper part', 'Bradley Cooper'),
  ('ucrl_rt_1', 'ucw_remember_the_time', 1, 'The Pharaoh', 'Eddie Murphy'),
  ('ucrl_rt_2', 'ucw_remember_the_time', 2, 'The Queen', 'Iman'),
  ('ucrl_rt_3', 'ucw_remember_the_time', 3, 'The hooded magician', 'Michael Jackson'),
  ('ucrl_rt_4', 'ucw_remember_the_time', 4, 'The servant', 'Magic Johnson'),
  ('ucrl_rt_5', 'ucw_remember_the_time', 5, 'The palace guard', 'Tom "Tiny" Lister Jr.'),
  ('ucrl_tp_1', 'ucw_telephone', 1, 'The Lady Gaga role', 'Lady Gaga'),
  ('ucrl_tp_2', 'ucw_telephone', 2, 'The Beyoncé role', 'Beyoncé'),
  ('ucrl_tp_3', 'ucw_telephone', 3, 'Prison guard', ''),
  ('ucrl_tp_4', 'ucw_telephone', 4, 'Diner waitress', ''),
  ('ucrl_tp_5', 'ucw_telephone', 5, 'The boyfriend', 'Tyrese Gibson'),
  ('ucrl_ss_1', 'ucw_sister_sister', 1, 'Tia Landry', 'Tia Mowry'),
  ('ucrl_ss_2', 'ucw_sister_sister', 2, 'Tamera Campbell', 'Tamera Mowry'),
  ('ucrl_ss_3', 'ucw_sister_sister', 3, 'Lisa Landry', 'Jackée Harry'),
  ('ucrl_ss_4', 'ucw_sister_sister', 4, 'Ray Campbell', 'Tim Reid'),
  ('ucrl_ss_5', 'ucw_sister_sister', 5, 'Roger Evans', 'Marques Houston'),
  ('ucrl_dw_1', 'ucw_different_world', 1, 'Whitley Gilbert', 'Jasmine Guy'),
  ('ucrl_dw_2', 'ucw_different_world', 2, 'Dwayne Wayne', 'Kadeem Hardison'),
  ('ucrl_dw_3', 'ucw_different_world', 3, 'Freddie Brooks', 'Cree Summer'),
  ('ucrl_dw_4', 'ucw_different_world', 4, 'Kim Reese', 'Charnele Brown'),
  ('ucrl_dw_5', 'ucw_different_world', 5, 'Ron Johnson', 'Darryl M. Bell'),
  ('ucrl_dw_6', 'ucw_different_world', 6, 'Colonel Taylor', 'Glynn Turman'),
  ('ucrl_dw_7', 'ucw_different_world', 7, 'Mr. Gaines', 'Lou Myers');

-- The host's own ballot on the flagship poll.
INSERT OR IGNORE INTO ucast_recasts (id, work_id, author_id, note, status, created_at, updated_at) VALUES
  ('ucr_little_shop_house', 'ucw_little_shop', 'usr_ucast',
   'Vocal-first and multi-generational: a funk legend next to two former teen idols. Mean Green Mother from Outer Space as a Gap Band funk record.',
   'visible', '2026-10-10T00:01:00.000Z', '2026-10-10T00:01:00.000Z');
INSERT OR IGNORE INTO ucast_picks (id, recast_id, role_id, pick, note) VALUES
  ('ucp_ls_1', 'ucr_little_shop_house', 'ucrl_ls_1', 'Justin Bieber', ''),
  ('ucp_ls_2', 'ucr_little_shop_house', 'ucrl_ls_2', 'Ariana Grande', ''),
  ('ucp_ls_3', 'ucr_little_shop_house', 'ucrl_ls_3', 'Charlie Wilson', 'Levi Stubbs of the Four Tops originated it in 1986.'),
  ('ucp_ls_6', 'ucr_little_shop_house', 'ucrl_ls_6', 'Jazmine Sullivan', 'Crystal leads the sass, so the biggest voice.'),
  ('ucp_ls_7', 'ucr_little_shop_house', 'ucrl_ls_7', 'Coco Jones', 'The playful one; Jones has the comic timing.'),
  ('ucp_ls_8', 'ucr_little_shop_house', 'ucrl_ls_8', 'Olivia Dean', 'The glue voice of the trio.');
