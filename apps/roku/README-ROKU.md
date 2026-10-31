# SweamTV for Roku

A native SceneGraph channel for the SweamTV catalog: pair with a code, browse
the AI-originals rails, and play HLS/MP4 with the paired account's session
(watch progress and resume are shared with sweam.co and the mobile app).

## What's inside

- `manifest` — channel metadata + the approved SweamTV kit art in `images/`
  (from `SWEAMTV/SWEAMTV LOGO/SweamTV-Kit-v1.1/08-TV-Platforms/Roku`; the
  store-listing poster `sweamtv-store-poster-540x405.jpg` stays in the kit).
- `source/main.brs` — entry point.
- `components/AppScene.*` — the whole flow: pairing (POST `/api/tv/pair/start`,
  poll `/api/tv/pair/poll`), home rails (GET `/api/tv/feed`), title detail
  (GET `/api/titles/:slug`), playback (GET `/api/watch/:id` + the same
  10-second progress beacons the website sends). The session token lives in
  the device registry and rides as `Authorization: Bearer` on `/api` and
  `/media` requests (the Video node sends it via `HttpHeaders`).
- `components/ApiTask.*` — one HTTPS JSON call per task.
- `components/PosterItem.*` — RowList poster cell.

Base URL is `https://sweam.co` (set in `AppScene.brs` `m.BASE`).

## Sideload (developer mode)

1. On the Roku remote: Home ×3, Up ×2, Right, Left, Right, Left, Right →
   enable Developer Mode, note the TV's IP and the dev password.
2. Build the zip (from the repo root):

   ```powershell
   cd "apps/roku"
   powershell -NoProfile -Command "Compress-Archive -Path manifest,source,components,images -DestinationPath out/sweamtv-roku.zip -Force"
   ```

3. Open `http://<roku-ip>` in a browser, sign in (`rokudev` / your dev
   password), upload `out/sweamtv-roku.zip`, Install. The channel appears as
   SweamTV.

## Publish to the Roku Channel Store

1. Create / sign in to the Roku developer account at developer.roku.com.
2. On the device, generate a signing key: telnet port 8080 → `genkey` (keep
   the password), then package the sideloaded channel from the Packager page
   of `http://<roku-ip>` → downloads a signed `.pkg`.
3. In the developer dashboard: Manage My Channels > Add Channel (Developer
   SDK), upload the `.pkg`, fill the listing (name SweamTV, category
   Movies & TV), attach store art, set the channel to free with no ads, and
   submit for certification.

## v1 limitations (deliberate)

- Captions are not yet wired on Roku (the web TV app has them); Roku needs a
  sidecar track format pass.
- No ads (chosen for launch) and no Blu content (the feed excludes it).
- Search and a Coming Soon screen are future work; the feed's rails carry
  release dates.
