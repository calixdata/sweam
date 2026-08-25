-- Sweam demo seed.
--
-- Safe to re-run: clears existing rows first (child tables before parents).
--
-- Demo media are the Blender Foundation open movies (CC-BY, (c) Blender
-- Foundation | blender.org), served from Google's public sample bucket so the
-- player works out of the box with real, licensed video. The creator, viewer,
-- and scout accounts around them are fictional demo data.
--
-- Every demo account uses the password: SweamDemo1!
--
-- title_stats rows are synthetic lifetime aggregates chosen to make the
-- discovery ranking demonstrable (Sintel's small devoted audience outranks
-- Big Buck Bunny's large indifferent one). Retention curves are computed from
-- the tracked viewer accounts below, so one-sheets show real curves from a
-- small tracked cohort alongside the larger synthetic lifetime counters.
--
-- title_stats_daily rows use date('now', ...) offsets so the fastest-growing
-- and genre-breakout boards stay meaningful no matter when the seed runs:
-- Tears of Steel is mid-launch spike, Sintel is accelerating week over week,
-- Big Buck Bunny is big but flat-to-declining.

DELETE FROM submissions;
DELETE FROM comment_reports;
DELETE FROM comments;
DELETE FROM follows;
DELETE FROM payout_requests;
DELETE FROM ad_impressions;
DELETE FROM ads;
DELETE FROM notifications;
DELETE FROM rate_limits;
DELETE FROM strikes;
DELETE FROM takedowns;
DELETE FROM reports;
DELETE FROM admins;
DELETE FROM scout_interests;
DELETE FROM onesheet_views;
DELETE FROM title_stats_daily;
DELETE FROM likes;
DELETE FROM watchlist;
DELETE FROM progress;
DELETE FROM title_stats;
DELETE FROM episodes;
DELETE FROM titles;
DELETE FROM sessions;
DELETE FROM scout_profiles;
DELETE FROM creator_profiles;
DELETE FROM users;

INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES
  ('usr_ana',   'ana@demo.sweam',   'Ana Voss',    'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-07-20T14:00:00.000Z'),
  ('usr_nova',  'nova@demo.sweam',  'Nova Reyes',  'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-07-21T09:30:00.000Z'),
  ('usr_mira',  'mira@demo.sweam',  'Mira Chen',   'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-01T18:45:00.000Z'),
  ('usr_sam',   'sam@demo.sweam',   'Sam Park',    'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-10T11:00:00.000Z'),
  ('usr_scout', 'scout@demo.sweam', 'Riley Grant', 'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-15T10:00:00.000Z'),
  ('usr_scout2', 'westgate@demo.sweam', 'Jordan Wells', 'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-24T09:00:00.000Z'),
  ('usr_admin', 'admin@demo.sweam', 'Alex Ondo', 'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-07-15T09:00:00.000Z');

-- Admins are provisioned here or by operations:
--   npx wrangler d1 execute sweam-db --local --command "INSERT INTO admins (user_id, created_at) VALUES ('<id>', strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
INSERT INTO admins (user_id, created_at) VALUES
  ('usr_admin', '2026-07-15T09:05:00.000Z');

-- Tracked viewer cohort: exists to make retention curves real. Not intended
-- as sign-in demo accounts, but the shared demo password works for them too.
INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES
  ('usr_v01', 'viewer01@seed.sweam', 'Viewer One',   'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:00:00.000Z'),
  ('usr_v02', 'viewer02@seed.sweam', 'Viewer Two',   'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:01:00.000Z'),
  ('usr_v03', 'viewer03@seed.sweam', 'Viewer Three', 'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:02:00.000Z'),
  ('usr_v04', 'viewer04@seed.sweam', 'Viewer Four',  'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:03:00.000Z'),
  ('usr_v05', 'viewer05@seed.sweam', 'Viewer Five',  'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:04:00.000Z'),
  ('usr_v06', 'viewer06@seed.sweam', 'Viewer Six',   'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:05:00.000Z'),
  ('usr_v07', 'viewer07@seed.sweam', 'Viewer Seven', 'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:06:00.000Z'),
  ('usr_v08', 'viewer08@seed.sweam', 'Viewer Eight', 'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:07:00.000Z'),
  ('usr_v09', 'viewer09@seed.sweam', 'Viewer Nine',  'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:08:00.000Z'),
  ('usr_v10', 'viewer10@seed.sweam', 'Viewer Ten',   'pbkdf2$100000$2h1iQtgV/bqgPcq6niESmw==$46b133w/oul9xoXowCpOixI+jFjru/zxNlF/7dzBhSw=', '2026-08-11T10:09:00.000Z');

INSERT INTO creator_profiles (user_id, handle, bio, verified, created_at) VALUES
  ('usr_ana',  'anavoss',   'Animator turned director. Two features on Sweam and counting.', 1, '2026-07-20T14:05:00.000Z'),
  ('usr_nova', 'novareyes', 'Shorts, sketches, and the occasional accidental masterpiece.',  0, '2026-07-21T09:35:00.000Z'),
  ('usr_mira', 'miradocs',  'Curating open cinema and documenting how it gets made.',        0, '2026-08-01T18:50:00.000Z');

-- One approved demo scout, plus a pending application so the admin console
-- has something to decide on first run. Approvals now happen in /admin.
INSERT INTO scout_profiles (user_id, org_name, org_url, contact_email, status, created_at, decided_at) VALUES
  ('usr_scout', 'Northlight Studios', 'https://northlight.example', 'scouting@northlight.example', 'approved', '2026-08-15T10:05:00.000Z', '2026-08-16T09:00:00.000Z'),
  ('usr_scout2', 'Westgate Media', NULL, 'content@westgate.example', 'pending', '2026-08-24T09:10:00.000Z', NULL);

-- Elephants Dream deliberately stays scoutable = 0 to demonstrate the opt-in
-- gate: it appears in the public catalog but in no scout surface.
INSERT INTO titles (id, creator_id, kind, name, slug, synopsis, genre, advisory, poster_url, published, scoutable, published_at, created_at) VALUES
  ('ttl_bbb', 'usr_nova', 'short', 'Big Buck Bunny', 'big-buck-bunny',
   'A giant rabbit with a heart bigger than himself meets three bullying rodents, and plans a comedy of payback. The Blender Foundation''s beloved open short.',
   'Comedy', 'TV-G', NULL, 1, 1, '2026-07-28T16:00:00.000Z', '2026-07-28T15:00:00.000Z'),
  ('ttl_ed', 'usr_nova', 'short', 'Elephants Dream', 'elephants-dream',
   'Two strangers explore a strange industrial world of machines that may not exist at all. The first open movie ever made.',
   'Sci-Fi', 'TV-PG', NULL, 1, 0, '2026-08-05T16:00:00.000Z', '2026-08-05T15:00:00.000Z'),
  ('ttl_sintel', 'usr_ana', 'film', 'Sintel', 'sintel',
   'A lonely young woman crosses mountains and seasons searching for the dragon she once rescued. A short film about how far devotion can carry you.',
   'Drama', 'TV-PG', NULL, 1, 1, '2026-08-12T16:00:00.000Z', '2026-08-12T15:00:00.000Z'),
  ('ttl_tos', 'usr_ana', 'film', 'Tears of Steel', 'tears-of-steel',
   'Forty years after a heartbreak on a bridge in Amsterdam, a group of scientists tries to rewrite the memory that broke the world.',
   'Sci-Fi', 'TV-14', NULL, 1, 1, '2026-08-22T16:00:00.000Z', '2026-08-22T15:00:00.000Z'),
  ('ttl_anthology', 'usr_mira', 'series', 'Open Cinema Anthology', 'open-cinema-anthology',
   'A curated season of landmark open movies, presented as an anthology with notes on how independent crews made them.',
   'Animation', 'TV-PG', NULL, 1, 1, '2026-08-24T16:00:00.000Z', '2026-08-24T15:00:00.000Z');

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

-- Daily counters, last 14 days relative to whenever this seed runs.
-- Recent week (offsets -6..0) vs prior week (-13..-7):
--   Big Buck Bunny 196 vs 224 (big, declining), Sintel 60 vs 30 (doubling),
--   Tears of Steel 12 vs 0 (launch spike), Anthology 6 vs 0 (day-old),
--   Elephants Dream flat 3/day (and not scoutable anyway).
INSERT INTO title_stats_daily (title_id, day, impressions, plays, completes, likes, watch_seconds) VALUES
  ('ttl_bbb', date('now', '-13 days'), 95, 33, 11, 3, 5900),
  ('ttl_bbb', date('now', '-12 days'), 92, 32, 11, 4, 5700),
  ('ttl_bbb', date('now', '-11 days'), 90, 31, 10, 3, 5600),
  ('ttl_bbb', date('now', '-10 days'), 95, 33, 11, 2, 5900),
  ('ttl_bbb', date('now',  '-9 days'), 92, 32, 10, 3, 5700),
  ('ttl_bbb', date('now',  '-8 days'), 90, 31, 10, 3, 5600),
  ('ttl_bbb', date('now',  '-7 days'), 92, 32, 11, 2, 5700),
  ('ttl_bbb', date('now',  '-6 days'), 84, 29, 10, 3, 5200),
  ('ttl_bbb', date('now',  '-5 days'), 81, 28,  9, 2, 5000),
  ('ttl_bbb', date('now',  '-4 days'), 84, 29, 10, 2, 5200),
  ('ttl_bbb', date('now',  '-3 days'), 78, 27,  9, 3, 4900),
  ('ttl_bbb', date('now',  '-2 days'), 81, 28,  9, 2, 5000),
  ('ttl_bbb', date('now',  '-1 days'), 78, 27,  9, 2, 4900),
  ('ttl_bbb', date('now'),             81, 28,  9, 3, 5000),
  ('ttl_sintel', date('now', '-13 days'),  5,  3,  2, 1,  2100),
  ('ttl_sintel', date('now', '-12 days'),  5,  3,  2, 1,  2100),
  ('ttl_sintel', date('now', '-11 days'),  6,  4,  3, 1,  2800),
  ('ttl_sintel', date('now', '-10 days'),  6,  4,  3, 1,  2800),
  ('ttl_sintel', date('now',  '-9 days'),  8,  5,  4, 2,  3500),
  ('ttl_sintel', date('now',  '-8 days'),  8,  5,  4, 1,  3500),
  ('ttl_sintel', date('now',  '-7 days'),  9,  6,  5, 2,  4200),
  ('ttl_sintel', date('now',  '-6 days'),  9,  6,  5, 2,  4200),
  ('ttl_sintel', date('now',  '-5 days'), 11,  7,  6, 2,  4900),
  ('ttl_sintel', date('now',  '-4 days'), 12,  8,  6, 3,  5600),
  ('ttl_sintel', date('now',  '-3 days'), 14,  9,  7, 3,  6300),
  ('ttl_sintel', date('now',  '-2 days'), 15, 10,  8, 3,  7000),
  ('ttl_sintel', date('now',  '-1 days'), 17, 11,  9, 4,  7700),
  ('ttl_sintel', date('now'),             14,  9,  7, 3,  6300),
  ('ttl_ed', date('now', '-13 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now', '-12 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now', '-11 days'), 8, 3, 1, 1, 600),
  ('ttl_ed', date('now', '-10 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now',  '-9 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now',  '-8 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now',  '-7 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now',  '-6 days'), 8, 3, 1, 1, 600),
  ('ttl_ed', date('now',  '-5 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now',  '-4 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now',  '-3 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now',  '-2 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now',  '-1 days'), 8, 3, 1, 0, 600),
  ('ttl_ed', date('now'),             8, 3, 1, 0, 600),
  ('ttl_tos', date('now', '-2 days'), 10, 2, 1, 1,  900),
  ('ttl_tos', date('now', '-1 days'), 15, 4, 2, 1, 1800),
  ('ttl_tos', date('now'),            20, 6, 2, 2, 2600),
  ('ttl_anthology', date('now', '-1 days'),  8, 2, 1, 1, 1200),
  ('ttl_anthology', date('now'),            12, 4, 2, 1, 2400);

-- Tracked viewer positions. max_position_s drives the retention curves;
-- completed reflects max_position_s / duration >= 0.9.
INSERT INTO progress (user_id, episode_id, position_s, max_position_s, duration_s, completed, updated_at) VALUES
  ('usr_sam', 'ep_bbb',    213, 213, 596, 0, '2026-08-24T21:12:00.000Z'),
  ('usr_sam', 'ep_sintel', 140, 140, 888, 0, '2026-08-23T20:40:00.000Z'),
  ('usr_v01', 'ep_bbb', 596, 596, 596, 1, '2026-08-18T20:00:00.000Z'),
  ('usr_v02', 'ep_bbb', 596, 596, 596, 1, '2026-08-18T20:05:00.000Z'),
  ('usr_v03', 'ep_bbb', 550, 550, 596, 1, '2026-08-19T20:00:00.000Z'),
  ('usr_v04', 'ep_bbb', 400, 400, 596, 0, '2026-08-19T20:05:00.000Z'),
  ('usr_v05', 'ep_bbb', 300, 300, 596, 0, '2026-08-20T20:00:00.000Z'),
  ('usr_v06', 'ep_bbb', 180, 180, 596, 0, '2026-08-20T20:05:00.000Z'),
  ('usr_v07', 'ep_bbb', 120, 120, 596, 0, '2026-08-21T20:00:00.000Z'),
  ('usr_v08', 'ep_bbb',  60,  60, 596, 0, '2026-08-21T20:05:00.000Z'),
  ('usr_v09', 'ep_bbb',  90,  90, 596, 0, '2026-08-22T20:00:00.000Z'),
  ('usr_v10', 'ep_bbb', 596, 596, 596, 1, '2026-08-22T20:05:00.000Z'),
  ('usr_v01', 'ep_sintel', 888, 888, 888, 1, '2026-08-19T21:00:00.000Z'),
  ('usr_v02', 'ep_sintel', 888, 888, 888, 1, '2026-08-20T21:00:00.000Z'),
  ('usr_v03', 'ep_sintel', 888, 888, 888, 1, '2026-08-21T21:00:00.000Z'),
  ('usr_v04', 'ep_sintel', 850, 850, 888, 1, '2026-08-22T21:00:00.000Z'),
  ('usr_v05', 'ep_sintel', 800, 800, 888, 1, '2026-08-23T21:00:00.000Z'),
  ('usr_v06', 'ep_sintel', 600, 600, 888, 0, '2026-08-24T21:00:00.000Z'),
  ('usr_v01', 'ep_tos', 734, 734, 734, 1, '2026-08-23T22:00:00.000Z'),
  ('usr_v02', 'ep_tos', 300, 300, 734, 0, '2026-08-24T22:00:00.000Z'),
  ('usr_v03', 'ep_tos', 700, 700, 734, 1, '2026-08-24T22:30:00.000Z'),
  ('usr_v04', 'ep_anth_1', 654, 654, 654, 1, '2026-08-24T23:00:00.000Z'),
  ('usr_v05', 'ep_anth_1', 200, 200, 654, 0, '2026-08-24T23:10:00.000Z'),
  ('usr_v04', 'ep_anth_2', 596, 596, 596, 1, '2026-08-25T00:00:00.000Z'),
  ('usr_v06', 'ep_ed', 654, 654, 654, 1, '2026-08-20T19:00:00.000Z'),
  ('usr_v07', 'ep_ed', 100, 100, 654, 0, '2026-08-21T19:00:00.000Z');

INSERT INTO watchlist (user_id, title_id, added_at) VALUES
  ('usr_sam', 'ttl_tos', '2026-08-23T20:45:00.000Z');

INSERT INTO likes (user_id, title_id, created_at) VALUES
  ('usr_sam', 'ttl_bbb',    '2026-08-24T21:15:00.000Z'),
  ('usr_ana', 'ttl_bbb',    '2026-08-01T10:00:00.000Z'),
  ('usr_sam', 'ttl_sintel', '2026-08-23T21:00:00.000Z');

-- One turn of the scout loop, so Studio analytics shows both sides on first run.
INSERT INTO onesheet_views (id, scout_user_id, title_id, viewed_at) VALUES
  ('osv_seed_1', 'usr_scout', 'ttl_sintel', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'));

INSERT INTO scout_interests (id, scout_user_id, title_id, note, created_at) VALUES
  ('int_seed_1', 'usr_scout', 'ttl_sintel',
   'Strong finish rate for a debut drama. We are assembling a slate of independent animated features and would like to talk.',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'));

-- An open report so the moderation queue has a live example, and the
-- notification Ana would have received for the seeded interest above.
INSERT INTO reports (id, title_id, reporter_id, reason, note, status, created_at) VALUES
  ('rep_seed_1', 'ttl_ed', 'usr_v07', 'other',
   'The audio drops out around the halfway mark. Might be a broken upload.',
   'open', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'));

INSERT INTO notifications (id, user_id, kind, body, link, read, created_at) VALUES
  ('ntf_seed_1', 'usr_ana', 'scout_interest',
   'Northlight Studios expressed interest in Sintel. Their contact details are in your analytics.',
   '/studio/t/ttl_sintel/analytics', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'));

-- ---------------------------------------------------------------------------
-- Monetization: house ads and a synthetic-but-consistent impressions ledger.
-- The house ads reuse the CC-BY Blender films as stand-in creative. Ledger
-- amounts follow the real math exactly: revenue = cpm_cents millicents per
-- impression, creator share 55% (1200 -> 660, 1500 -> 825). Recursive CTEs
-- keep the seed compact while producing real per-impression rows spread over
-- the last 14 days.
-- ---------------------------------------------------------------------------

INSERT INTO ads (id, sponsor, headline, media_url, click_url, duration_s, cpm_cents, active, created_at) VALUES
  ('ad_house_1', 'Sweam', 'Discover your next favorite creator',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
   '/discover', 10, 1200, 1, '2026-08-01T12:00:00.000Z'),
  ('ad_house_2', 'Sweam Studio', 'Publish your film where discovery is fair',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
   '/studio', 12, 1500, 1, '2026-08-01T12:05:00.000Z');

WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 2500)
INSERT INTO ad_impressions (id, ad_id, title_id, creator_id, viewer, revenue_millicents, creator_millicents, created_at)
SELECT lower(hex(randomblob(16))), 'ad_house_1', 'ttl_sintel', 'usr_ana',
  CASE WHEN x % 3 = 0 THEN 'anon' ELSE 'user' END, 1200, 660,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (x % 14) || ' days')
FROM seq;

WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 800)
INSERT INTO ad_impressions (id, ad_id, title_id, creator_id, viewer, revenue_millicents, creator_millicents, created_at)
SELECT lower(hex(randomblob(16))), 'ad_house_1', 'ttl_tos', 'usr_ana',
  CASE WHEN x % 4 = 0 THEN 'anon' ELSE 'user' END, 1200, 660,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (x % 3) || ' days')
FROM seq;

WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 3000)
INSERT INTO ad_impressions (id, ad_id, title_id, creator_id, viewer, revenue_millicents, creator_millicents, created_at)
SELECT lower(hex(randomblob(16))), 'ad_house_2', 'ttl_bbb', 'usr_nova',
  CASE WHEN x % 2 = 0 THEN 'anon' ELSE 'user' END, 1500, 825,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (x % 14) || ' days')
FROM seq;

-- Mira is below the monetization thresholds (1 follower, under 1,000 watch
-- minutes), so her impressions accrue no creator share: the platform records
-- the gross, her earnings page shows live progress toward eligibility.
WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 400)
INSERT INTO ad_impressions (id, ad_id, title_id, creator_id, viewer, revenue_millicents, creator_millicents, created_at)
SELECT lower(hex(randomblob(16))), 'ad_house_1', 'ttl_anthology', 'usr_mira',
  CASE WHEN x % 3 = 0 THEN 'anon' ELSE 'user' END, 1200, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (x % 2) || ' days')
FROM seq;

-- Nova already has a payout awaiting review, so the admin monetization page
-- has a live decision on first run. Ana is above the $10 minimum and can
-- request one; Mira demonstrates the eligibility gate above.
INSERT INTO payout_requests (id, creator_id, amount_millicents, status, requested_at) VALUES
  ('pay_seed_1', 'usr_nova', 1000000, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'));

-- ---------------------------------------------------------------------------
-- Community: follows, comment threads (including a removed-parent placeholder
-- and a reported comment for the admin queue), and a follower notification.
-- ---------------------------------------------------------------------------

INSERT INTO follows (follower_id, creator_id, created_at) VALUES
  ('usr_sam', 'usr_ana',  '2026-08-20T10:00:00.000Z'),
  ('usr_sam', 'usr_mira', '2026-08-23T10:00:00.000Z'),
  ('usr_v01', 'usr_ana',  '2026-08-19T10:00:00.000Z'),
  ('usr_v02', 'usr_ana',  '2026-08-20T11:00:00.000Z'),
  ('usr_v03', 'usr_ana',  '2026-08-21T11:00:00.000Z'),
  ('usr_v04', 'usr_ana',  '2026-08-22T11:00:00.000Z'),
  ('usr_v01', 'usr_nova', '2026-08-18T09:00:00.000Z'),
  ('usr_v02', 'usr_nova', '2026-08-19T09:00:00.000Z'),
  ('usr_v03', 'usr_nova', '2026-08-20T09:00:00.000Z'),
  ('usr_v04', 'usr_nova', '2026-08-21T09:00:00.000Z'),
  ('usr_v05', 'usr_nova', '2026-08-21T09:30:00.000Z'),
  ('usr_v06', 'usr_nova', '2026-08-22T09:00:00.000Z');

INSERT INTO comments (id, title_id, author_id, parent_id, body, status, created_at) VALUES
  ('cmt_sintel_1', 'ttl_sintel', 'usr_sam', NULL,
   'That final shot stayed with me for days. The pacing in the middle act is fearless.',
   'visible', '2026-08-23T21:10:00.000Z'),
  ('cmt_sintel_2', 'ttl_sintel', 'usr_ana', 'cmt_sintel_1',
   'Thank you, Sam. The middle act was the hardest cut we made.',
   'visible', '2026-08-24T08:00:00.000Z'),
  ('cmt_sintel_3', 'ttl_sintel', 'usr_v02', NULL,
   'Watched it twice in one evening. The dragon reveal earns every second of buildup.',
   'visible', '2026-08-24T20:15:00.000Z'),
  ('cmt_bbb_1', 'ttl_bbb', 'usr_v05', NULL,
   'Still the best revenge arc in animation.',
   'visible', '2026-08-22T18:00:00.000Z'),
  ('cmt_bbb_2', 'ttl_bbb', 'usr_v08', NULL,
   'First!', 'removed_by_creator', '2026-08-22T18:05:00.000Z'),
  ('cmt_bbb_3', 'ttl_bbb', 'usr_v06', 'cmt_bbb_2',
   'The butterfly scene gets me every time.',
   'visible', '2026-08-22T19:00:00.000Z'),
  ('cmt_bbb_4', 'ttl_bbb', 'usr_v09', NULL,
   'Check out my channel for free movie downloads!!!',
   'visible', '2026-08-24T12:00:00.000Z');

INSERT INTO comment_reports (id, comment_id, reporter_id, reason, status, created_at) VALUES
  ('crep_seed_1', 'cmt_bbb_4', 'usr_v07', 'spam', 'open',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'));

INSERT INTO notifications (id, user_id, kind, body, link, read, created_at) VALUES
  ('ntf_seed_2', 'usr_sam', 'new_episode',
   'Mira Chen published Open Cinema Anthology.',
   '/t/open-cinema-anthology', 0, '2026-08-24T16:05:00.000Z');

-- A pending content submission so the admin intake queue has a live decision.
INSERT INTO submissions (id, user_id, title_name, kind, genre, synopsis, work_url, rights_confirmed, status, created_at) VALUES
  ('sub_seed_1', 'usr_v10', 'Midnight Frequencies', 'documentary', 'Documentary',
   'A 40-minute documentary about pirate radio operators broadcasting after dark from rooftops across three cities. Finished, color-graded, with licensed music.',
   'https://example.com/screeners/midnight-frequencies', 1, 'pending',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'));
