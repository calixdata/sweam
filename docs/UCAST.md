# UCast: the recasting room

UCast is Sweam's fancast room. A member takes an older film, TV series, song,
musical or music video and names who they would cast in each role for a remake
or rendition today. Other members post their own casts for the same work and
vote ("agree") on individual picks. The room is hosted by Sweam's own account,
@ucast, which is official and verified and posts the open calls.

## House rules, enforced in code

- Text only. A recast is roles and names; there is no image or media field.
  No key art, no faces, no AI likenesses or cloned voices.
- The same disclaimer appears on the board and on every work page:
  "Fan concept. Not a real project. No artist attached. No AI faces or voices."
- Classics only: a work must be at least five years old
  (`UCAST_MIN_WORK_AGE_YEARS`). The API refuses newer years with `too_recent`.
- One opinion per role per recast (`duplicate_role`); a second opinion is a
  second recast. Up to 12 roles per recast.
- Moderation is never silent: an admin removal notifies the author
  (notification kind `ucast`). Authors can remove their own recasts.
- Blocks apply: a member never sees recasts by someone they blocked.
- Rate limits: 10 works opened, 15 recasts and 300 votes per member per day
  or hour (see `RATE_LIMITS.ucast*`). Official accounts are exempt, as everywhere.

## Data model (migration 0039)

| Table | What it holds |
| --- | --- |
| `ucast_works` | One row per title + year + kind. `slug` is deterministic (`lib/ucast.ts` `ucastWorkSlug`), so two members opening the same work land on one board. `official = 1` marks an open call posted by @ucast. |
| `ucast_recasts` | One member's full cast for a work, with `headline`, `note` and a `status` (`visible`, `removed_by_author`, `removed_by_admin`). |
| `ucast_picks` | The role → performer rows inside a recast, in order. |
| `ucast_votes` | One "agree" per member per pick. |

The migration also creates the `@ucast` account (`usr_ucast`, `ucast@sweam.co`,
official, verified, no password: claim it through the password-reset email, the
same way as `@sweam`) and seeds 21 open calls plus the house Little Shop of
Horrors (1986) cast from the Recast Room kit.

## API

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /api/ucast?kind=` | anyone | The board: open calls, then every work with its recast count. |
| `POST /api/ucast/works` | member | Open a work. 200 with `created: false` when its slug already exists. |
| `GET /api/ucast/works/:slug` | anyone | The work, the per-role consensus (`buildRoleConsensus`), and every visible recast with picks, votes and `votedByMe`. |
| `POST /api/ucast/works/:slug/recasts` | member | Post a cast (recast + picks in one D1 batch). |
| `DELETE /api/ucast/recasts/:id` | author or admin | Remove a recast. Outsiders get a 404, not a 403. |
| `PUT` / `DELETE /api/ucast/picks/:id/vote` | member | Agree, or take it back. Idempotent. |
| `GET /api/ucast/me` | member | The member's own recasts. |

## Web

`/ucast` is the board (open calls, "open a work of your own", everything in
the room, filter by kind). `/ucast/w/:slug` is a work page: consensus per
role, every recast as a table (role, originally, recast as, why, agree), and
the "Add your cast" form with dynamic role rows. Every vote button carries an
accessible name ("Agree with X as Y") and `aria-pressed`.

The mobile app does not have UCast screens yet; the API is ready for them.
