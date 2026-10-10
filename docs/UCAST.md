# UCast: recasting polls

UCast is Sweam's fancast room, built as polls. A poll is an older film, TV
series, song, musical or music video with a fixed list of roles. Members
submit one ballot each (who they would cast per role) and "agree" with other
members' picks. Every poll shows its closing date; results are posted within
48 hours of closing. Members can request a poll; every request is checked for
duplicates and reviewed by a Sweam/UCast admin before it opens. The room is
hosted by Sweam's own account, @ucast (official, verified).

**The product is the data.** Scouts (studios, networks, labels) get every
poll's full results: ballots per performer, share of ballots, agreements,
live while a poll runs and final when it closes, with CSV export. That is
what UCast sells to media and film companies.

## House rules, enforced in code

- Text only. A ballot is roles and names; there is no image or media field.
  No faces, no AI likenesses or cloned voices. Covers are admin-set art.
- The disclaimer appears on every UCast page:
  "Fan concept. Not a real project. No artist attached. No AI faces or voices."
- Classics only: five years old or older (`UCAST_MIN_WORK_AGE_YEARS`).
- One ballot per member per poll; resubmitting replaces it (and drops the
  agreements the old picks had gathered). Each role once per ballot.
- Agreements only on open polls and never on your own picks.
- Nothing opens without an admin: a request stays `pending` (visible only to
  its requester and admins) until an admin opens it with roles and a window,
  or rejects it with a note. The member is notified either way.
- Moderation is never silent: an admin removal notifies the author
  (notification kind `ucast`). Blocks apply.
- Rate limits: 5 requests, 40 ballots, 300 agreements per member per day or
  hour (`RATE_LIMITS.ucast*`). Official accounts are exempt, as everywhere.

## Poll life cycle

`pending` -> `open` (from `opens_at` to `closes_at`) -> `closed` -> `results`.
The phase is derived, never stored (`lib/ucast.ts` `pollPhase`): an open row
before `opens_at` is "scheduled"; past `closes_at` it is closed; results are
public once an admin posts them, or automatically 48 hours after closing
(`UCAST_RESULTS_WITHIN_HOURS`), whichever comes first. While a poll is open the
public sees live standings; while it is closed and unposted, standings are
withheld from the public (admins and scouts still see them).

## De-duplication

Two layers, both in the request path (`POST /api/ucast/requests`) and in the
preview (`POST /api/ucast/requests/check`):

1. **Deterministic** (`findDuplicates`): the same slug (title + year + kind)
   is the same work; otherwise a Dice score over title tokens with
   prefix-tolerant matching ("Lil Shop of Horror" matches "Little Shop of
   Horrors"), weighted by year gap and kind.
2. **AI** (`lib/ucastAi.ts`): when `ANTHROPIC_API_KEY` is set, Claude reads the
   request against the room's polls and adds what word overlap misses
   (nicknames, subtitles, stage show versus film). It can only raise
   candidates that exist; any failure degrades to the fuzzy result.

An exact or near-certain match is refused (`duplicate_poll`). A likely match
is refused until the member confirms it is a different work
(`possible_duplicate`, with the candidates). Whatever was flagged is written
to `dedupe_note` for the admin.

## Data model (migration 0039)

| Table | What it holds |
| --- | --- |
| `ucast_works` | One poll: kind, title, year, hook, `cover_url`, `status` (pending/open/closed/rejected), `official`, requester and notes, `opens_at`, `closes_at`, `results_at`, `results_note`. Slug is deterministic (`ucastWorkSlug`). |
| `ucast_roles` | The poll's roles in order, with the original performer. Set by the admin on approval (requesters may suggest them). |
| `ucast_recasts` | One member's ballot (unique per poll and member). |
| `ucast_picks` | The role -> performer rows of a ballot (unique per ballot and role). |
| `ucast_votes` | One agreement per member per pick. |

The migration also creates `@ucast` (`usr_ucast`, `ucast@sweam.co`, official,
verified, no password: claim via the password-reset email) and seeds 21 launch
polls with 107 roles, open for 30 days from 2026-10-10, plus the host's own
ballot on Little Shop of Horrors (1986).

## API

Public and member (`/api/ucast`):

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /` | anyone | The board grouped by phase: open, closing this week, awaiting results, results, scheduled. |
| `GET /polls/:slug` | anyone | The poll, its roles, results or live standings, every visible ballot, the viewer's own ballot. |
| `POST /requests/check` | member | Duplicate preview for a title, year and kind. |
| `POST /requests` | member | Request a poll (with optional suggested roles). 409 on duplicates. |
| `GET /requests/mine` | member | The member's requests and their phase. |
| `PUT` / `DELETE /polls/:slug/ballot` | member | Submit or replace the ballot; withdraw it. Open polls only. |
| `PUT` / `DELETE /picks/:id/vote` | member | Agree, or take it back. |
| `DELETE /ballots/:id` | author or admin | Remove a ballot. |
| `GET /scout`, `GET /scout/:slug`, `GET /scout/:slug/results.csv` | scout | Every poll's full results, and CSV. |

Admin (`/api/admin/ucast`, admins only):

| Method and path | Does |
| --- | --- |
| `GET /` | Every request and poll with requester, notes, dedupe result and roles. |
| `POST /:id/decide` | Open (roles, `closesAt`, optional `opensAt`, hook, cover, note) or reject (note). |
| `PATCH /:id` | Edit window, hook, cover, roles; `closeNow`. |
| `POST /:id/results` | Post results now with a note (closed polls only). |
| `POST /` | Open a poll directly as @ucast. |
| `PUT /cover/:filename` | Upload a cover (JPEG, PNG, WebP, 8 MB) to R2; returns the `/media` URL. |

## Web

- `/ucast`: the board with "How it works", a kind filter, and sections in
  reading order (closing this week, open, closed awaiting results, latest
  results, opening soon). Cards carry the cover, kind, phase pill, closing
  date with days left, roles and ballots, and one action.
- `/ucast/p/:slug`: cover, status strip (phase, closes, results by, ballots,
  roles), then three sections in order: your ballot, standings or results,
  ballots from the room (with Agree).
- `/ucast/request`: the request form with the duplicate check and the
  member's own requests.
- `/ucast/results`: every posted result.
- `/admin/ucast`: requests queue (roles editor, window, cover upload, note,
  open or reject), polls (edit, close now, post results), open a poll as @ucast.
- `/scout/ucast`: every poll, expandable results table, CSV download. Linked
  from the Scout portal.

The UCast mark and favicon live at `apps/web/public/brand/ucast-*.svg`; UCast
pages swap the tab icon while open. The mobile app has no UCast screens yet.
