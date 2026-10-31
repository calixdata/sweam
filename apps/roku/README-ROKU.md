# SweamTV for Roku

A native SceneGraph channel for the SweamTV catalog: pair with a code, browse
the AI-originals rails, and play HLS/MP4 with the paired account's session
(watch progress and resume are shared with sweam.co and the mobile app).

## What's inside

- `manifest` — channel metadata + the approved SweamTV kit art in `images/`
  (from `SWEAMTV/SWEAMTV LOGO/SweamTV-Kit-v1.1/08-TV-Platforms/Roku`; the
  store-listing poster `sweamtv-store-poster-540x405.jpg` stays in the kit).
- `source/main.brs` — entry point; forwards deep links to the scene (launch
  args at start, `roInput` events while running).
- `components/AppScene.*` — the whole flow: pairing (POST `/api/tv/pair/start`,
  poll `/api/tv/pair/poll`), home rails (GET `/api/tv/feed`), title detail
  (GET `/api/titles/:slug`), playback (GET `/api/watch/:id` + the same
  10-second progress beacons the website sends), captions, deep links. The
  session token lives in the device registry and rides as
  `Authorization: Bearer` on `/api` and `/media` requests (the Video node
  sends it via `HttpHeaders`).
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

## Certification

The two store-certification requirements that sideloading never needed are
in:

- **Closed captions.** The watch payload's `episode.captionsUrl` (a sidecar
  file under `/media`, same Bearer header) is attached to the ContentNode as
  a sideloaded `SubtitleTracks` entry (`eng` / "English") and selected via
  the Video node's `subtitleTrack`; in-stream HLS text tracks are picked up
  by Roku OS on its own. The channel never writes `globalCaptionMode`, so
  the viewer's system caption setting (Settings > Accessibility > Captions,
  or the `*` options menu during playback) decides whether captions render.
- **Deep linking.** `main.brs` takes `contentId` + `mediaType` from the
  launch args and, while running, from `roInput` events
  (`supports_input_launch=1`). Convention: **`contentId` is always an
  episode id**, for both supported mediaTypes — `episode` plays that
  episode, `series` enters the series at that episode (the watch payload's
  resume position and next-episode chaining take it from there; use the
  series' first episode id in feeds and dashboard samples). A link that
  arrives before the TV is paired shows pairing and plays right after; an
  unknown `contentId` or `mediaType` lands on the home screen, as Roku's
  cert criteria ask. Test against a sideloaded build with:

  ```bash
  curl -d '' 'http://<roku-ip>:8060/launch/dev?contentId=<episodeId>&mediaType=episode'
  ```

  ```bash
  curl -d '' 'http://<roku-ip>:8060/input?contentId=<episodeId>&mediaType=series'
  ```

Still to verify on hardware before submitting (BrightScript does not run off
the device): captions rendering from a `.vtt` sidecar (Roku's sideloaded-track
docs name srt/ttml/dfxp; the streaming specs also list side-loaded WebVTT —
if a real device won't render `.vtt`, serve an `.srt`/TTML variant for Roku),
and that the Video node sends the `HttpHeaders` Bearer token on the caption
fetch (captions under `/media` need it).

## v1 limitations (deliberate)

- No ads (chosen for launch) and no Blu content (the feed excludes it).
- Search and a Coming Soon screen are future work; the feed's rails carry
  release dates.
