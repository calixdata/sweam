# Sweam roadmap

Shipped so far: v0.1 (the working vertical slice: catalog, discovery, playback, Studio, uploads, range serving) and v0.3 (the scout portal, built ahead of v0.2 because it closes the loop on the platform thesis and did not depend on the media pipeline).

## v0.2: Real media pipeline (next up)

- Transcode-on-upload (queue + ffmpeg worker, or Cloudflare Stream) producing HLS ladders instead of serving source MP4s
- Poster/thumbnail generation and storage
- Multipart uploads past the 512 MB single-PUT cap, with resumable upload state
- Anonymous view beacons so signed-out plays count in stats (privacy-preserving, no identity)

## v0.3: The scout portal (shipped)

The feature that closes the loop on the platform thesis: a vetted, ranked view for networks and studios. Shipped: momentum leaderboards (fastest-growing, finish-rate leaders, genre breakouts), per-title one-sheets with daily series and audience retention curves, per-title creator opt-in with logged one-sheet views, the interest loop, and the creator analytics page sharing the same data. Still open from this phase:

- Scout approval in-product (currently a manual operations step; lands with the v0.4 admin console)
- Notifications to creators on new one-sheet views and interest
- Retention rollups per episode so curves stay cheap at scale

## v0.4: Trust, safety, and community

Prerequisites for any real audience:

- Report flow, moderation queue, strike system, DMCA takedown pipeline
- Email verification and password reset
- Rate limiting and abuse controls on auth, uploads, and beacons
- Comments with moderation, creator follows, and new-episode notifications

## v0.5: Sustainability

- AVOD: pre-roll slots with a published creator revenue share (the Tubi half of the thesis)
- Creator payouts and tax onboarding
- Optional fan support (tips, early access) without paywalling the catalog

## Continuing threads

- Accessibility: audio description tracks as first-class metadata alongside captions; transcript pages rendered as HTML, not just WebVTT downloads
- Recommendations v2: per-viewer taste signals layered on top of the equal-visibility base, with the same glass-box rule (every placement carries a reason)
- Mobile apps (Capacitor wrapper first, matching the PWA-quality bar)
- Internationalization of UI and caption metadata
