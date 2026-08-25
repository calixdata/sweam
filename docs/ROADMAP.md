# Sweam roadmap

Shipped so far: v0.1 (the working vertical slice: catalog, discovery, playback, Studio, uploads, range serving), v0.3 (the scout portal, built ahead of v0.2 because it closes the loop on the platform thesis), and v0.2 (the media pipeline).

## v0.2: Real media pipeline (shipped)

Shipped: the transcode queue (atomic claims, capped attempts, stale reclaim, supersede protection) with a portable Node + ffmpeg worker producing no-upscale HLS ladders and poster thumbnails; hls.js playback; resumable multipart uploads; and anonymous view beacons (random per-session id, no identity) feeding plays, finishes, and retention. Still open from this phase:

- Garbage collection for HLS outputs left by superseded or deleted jobs
- Upload progress at byte granularity (the client reports per-part today)
- Per-creator storage quotas before uploads are a public-abuse surface

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
