-- Sweam demo seed.
--
-- Safe to re-run: clears existing rows first (child tables before parents).
--
-- Demo media are the Blender Foundation open movies (CC-BY, (c) Blender
-- Foundation | blender.org), served from Google's public sample bucket so the
-- player works out of the box with real, licensed video. The creator accounts
-- around them are fictional demo data.
--
-- Every demo account uses the password: SweamDemo1!
--
-- title_stats rows are synthetic aggregates chosen to make the discovery
-- ranking demonstrable: Big Buck Bunny has reach but a mediocre finish rate,
-- Sintel has a small devoted audience (it should outrank Big Buck Bunny in
-- Discover), and the two newest entries show the freshness and exploration
-- terms working.

DELETE FROM likes;
DELETE FROM watchlist;
DELETE FROM progress;
DELETE FROM title_stats;
DELETE FROM episodes;
DELETE FROM titles;
DELETE FROM sessions;
DELETE FROM creator_profiles;
DELETE FROM users;

INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES
  ('usr_ana',  'ana@demo.sweam',  'Ana Voss',   'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-07-20T14:00:00.000Z'),
  ('usr_nova', 'nova@demo.sweam', 'Nova Reyes', 'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-07-21T09:30:00.000Z'),
  ('usr_mira', 'mira@demo.sweam', 'Mira Chen',  'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-01T18:45:00.000Z'),
  ('usr_sam',  'sam@demo.sweam',  'Sam Park',   'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-10T11:00:00.000Z');

INSERT INTO creator_profiles (user_id, handle, bio, verified, created_at) VALUES
  ('usr_ana',  'anavoss',   'Animator turned director. Two features on Sweam and counting.', 1, '2026-07-20T14:05:00.000Z'),
  ('usr_nova', 'novareyes', 'Shorts, sketches, and the occasional accidental masterpiece.',  0, '2026-07-21T09:35:00.000Z'),
  ('usr_mira', 'miradocs',  'Curating open cinema and documenting how it gets made.',        0, '2026-08-01T18:50:00.000Z');

INSERT INTO titles (id, creator_id, kind, name, slug, synopsis, genre, advisory, poster_url, published, published_at, created_at) VALUES
  ('ttl_bbb', 'usr_nova', 'short', 'Big Buck Bunny', 'big-buck-bunny',
   'A giant rabbit with a heart bigger than himself meets three bullying rodents, and plans a comedy of payback. The Blender Foundation''s beloved open short.',
   'Comedy', 'TV-G', NULL, 1, '2026-07-28T16:00:00.000Z', '2026-07-28T15:00:00.000Z'),
  ('ttl_ed', 'usr_nova', 'short', 'Elephants Dream', 'elephants-dream',
   'Two strangers explore a strange industrial world of machines that may not exist at all. The first open movie ever made.',
   'Sci-Fi', 'TV-PG', NULL, 1, '2026-08-05T16:00:00.000Z', '2026-08-05T15:00:00.000Z'),
  ('ttl_sintel', 'usr_ana', 'film', 'Sintel', 'sintel',
   'A lonely young woman crosses mountains and seasons searching for the dragon she once rescued. A short film about how far devotion can carry you.',
   'Drama', 'TV-PG', NULL, 1, '2026-08-12T16:00:00.000Z', '2026-08-12T15:00:00.000Z'),
  ('ttl_tos', 'usr_ana', 'film', 'Tears of Steel', 'tears-of-steel',
   'Forty years after a heartbreak on a bridge in Amsterdam, a group of scientists tries to rewrite the memory that broke the world.',
   'Sci-Fi', 'TV-14', NULL, 1, '2026-08-22T16:00:00.000Z', '2026-08-22T15:00:00.000Z'),
  ('ttl_anthology', 'usr_mira', 'series', 'Open Cinema Anthology', 'open-cinema-anthology',
   'A curated season of landmark open movies, presented as an anthology with notes on how independent crews made them.',
   'Animation', 'TV-PG', NULL, 1, '2026-08-24T16:00:00.000Z', '2026-08-24T15:00:00.000Z');

INSERT INTO episodes (id, title_id, season, episode, name, synopsis, video_url, captions_url, duration_s, created_at) VALUES
  ('ep_bbb', 'ttl_bbb', 1, 1, 'Big Buck Bunny',
   'The rabbit. The rodents. The reckoning.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
   '/captions/big-buck-bunny.en.vtt', 596, '2026-07-28T15:10:00.000Z'),
  ('ep_ed', 'ttl_ed', 1, 1, 'Elephants Dream',
   'Proog shows Emo the machine. Emo is not convinced it exists.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
   NULL, 654, '2026-08-05T15:10:00.000Z'),
  ('ep_sintel', 'ttl_sintel', 1, 1, 'Sintel',
   'A girl, a dragon, and a search that outlasts them both.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
   NULL, 888, '2026-08-12T15:10:00.000Z'),
  ('ep_tos', 'ttl_tos', 1, 1, 'Tears of Steel',
   'The bridge. The memory. The machine that replays both.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
   NULL, 734, '2026-08-22T15:10:00.000Z'),
  ('ep_anth_1', 'ttl_anthology', 1, 1, 'Where It Started: Elephants Dream',
   'The 2006 experiment that proved a volunteer crew could ship a film.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
   NULL, 654, '2026-08-24T15:10:00.000Z'),
  ('ep_anth_2', 'ttl_anthology', 1, 2, 'The Crowd Pleaser: Big Buck Bunny',
   'How a fluffy revenge comedy became open cinema''s biggest hit.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
   '/captions/big-buck-bunny.en.vtt', 596, '2026-08-24T15:11:00.000Z'),
  ('ep_anth_3', 'ttl_anthology', 1, 3, 'The Leap: Sintel',
   'The production that took open cinema from experiment to craft.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
   NULL, 888, '2026-08-24T15:12:00.000Z');

INSERT INTO title_stats (title_id, impressions, plays, completes, likes, watch_seconds) VALUES
  ('ttl_bbb',       5200, 2100,  700, 260, 610000),
  ('ttl_ed',         900,  240,   96,  30,  92000),
  ('ttl_sintel',     140,   90,   78,  41,  71000),
  ('ttl_tos',         60,   12,    5,   4,   6200),
  ('ttl_anthology',   30,    6,    3,   2,   4800);

INSERT INTO progress (user_id, episode_id, position_s, duration_s, completed, updated_at) VALUES
  ('usr_sam', 'ep_bbb',    213, 596, 0, '2026-08-24T21:12:00.000Z'),
  ('usr_sam', 'ep_sintel', 140, 888, 0, '2026-08-23T20:40:00.000Z');

INSERT INTO watchlist (user_id, title_id, added_at) VALUES
  ('usr_sam', 'ttl_tos', '2026-08-23T20:45:00.000Z');

INSERT INTO likes (user_id, title_id, created_at) VALUES
  ('usr_sam', 'ttl_bbb',    '2026-08-24T21:15:00.000Z'),
  ('usr_ana', 'ttl_bbb',    '2026-08-01T10:00:00.000Z'),
  ('usr_sam', 'ttl_sintel', '2026-08-23T21:00:00.000Z');
