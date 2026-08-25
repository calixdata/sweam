# Sweam

**Free streaming built for independent creators. Watch like a streaming service. Break out like a social feed.**

[![CI](https://github.com/calixdata/sweam/actions/workflows/ci.yml/badge.svg)](https://github.com/calixdata/sweam/actions/workflows/ci.yml)

Sweam is a full-stack streaming platform where the core catalog is creator-made: short films, binge series, sketch runs, and documentaries. It pairs the lean-back catalog experience of an ad-supported streamer (think Tubi) with the open, anyone-can-publish pipeline of a social platform (think TikTok), and it makes one promise neither of them makes: **equal visibility, enforced by a published algorithm.**

---

## The problem

Independent filmmakers and video creators are producing catalog-grade work, and there is nowhere that treats it like a catalog.

1. **Short-form feeds bury long-form work.** A six-episode series posted to a social feed is six disconnected uploads fighting an algorithm tuned for 30-second retention. There are no seasons, no resume, no "next episode", and the third episode dies because the second one was posted on a Tuesday.

2. **The big streamers are a closed door.** Netflix, Hulu, and Prime license through studios, agents, and aggregators. A finished, excellent indie series has no submission button. The gap between "popular on social" and "picked up by a network" is crossed by luck and connections, not by the work.

3. **Open platforms distribute by audience size, not by work quality.** Where creators *can* publish long-form (YouTube), discovery compounds existing reach: recommendations feed the already-fed. A new creator's excellent film and an established creator's mediocre one do not compete on the same terms, and everyone knows it.

## The gap

Nothing in the market combines all four of these:

| | Open to any creator | Catalog structure (series, seasons, resume) | Equal-visibility discovery | Free to watch |
| --- | :---: | :---: | :---: | :---: |
| TikTok | Yes | No | No (reach compounds) | Yes |
| YouTube | Yes | Partial (playlists) | No (reach compounds) | Yes |
| Tubi | No (licensed only) | Yes | n/a | Yes |
| Netflix | No | Yes | n/a | No |
| **Sweam** | **Yes** | **Yes** | **Yes, published algorithm** | **Yes** |

That empty quadrant is where a generation of creators currently lives: too long-form for the feeds, too independent for the streamers.

## How Sweam fills it

**1. Catalog-grade presentation for creator work.** Every upload lives inside a real title: films, series with seasons and episodes, shorts, documentaries, each with synopsis, genre, content advisory, captions, resume positions, and a watchlist. A creator's series behaves exactly like a network's series.

**2. Glass-box, equal-visibility discovery.** The ranking is small enough to read, public in this repo, and unit-tested for its fairness claims ([apps/api/src/lib/ranking.ts](apps/api/src/lib/ranking.ts)):

- **Quality (55%)** is measured *per viewer*, not in absolute volume: a Bayesian-smoothed finish rate blended with a like rate. Thirty devoted viewers outrank three thousand indifferent ones.
- **Exploration (30%)** is a UCB-style bonus that guarantees low-exposure titles get impressions, and fades only as a title actually receives its audition. New creators cannot be buried; established creators cannot squat on reach.
- **Freshness (15%)** gives releases a short window with a 10-day half-life.

Follower counts are not an input. The Discover feed shows every title's ranking reason to viewers ("Viewers finish this one", "New voice getting its first audience"), because a fairness promise you cannot inspect is a slogan.

**3. Built to be scouted.** Every title accumulates transparent momentum stats (plays, finish rate, likes, watch time). The roadmap's scout portal gives networks and studios a ranked view of breakout work, so "discovered by Hulu" becomes a product feature instead of a fluke.

**4. Accessibility as a feature, not a retrofit.** Captions are first-class metadata with a one-click transcript link. The player uses native controls (the most screen-reader-friendly option that exists), navigation is landmark-structured with skip links and focus management, and cards are real text rather than text baked into artwork.

---

## What is in this repo (v0.1)

A working vertical slice, end to end:

- **API** ([apps/api](apps/api)): Cloudflare Worker (Hono + TypeScript) with D1 (SQLite) and R2.
  - Session auth: PBKDF2 passwords, hashed session tokens, HttpOnly cookies
  - Catalog home rails, search, title pages, watch payloads
  - Discovery ranking with impression accounting
  - Watch progress beacons that maintain plays / finishes / watch-time counters
  - Creator Studio: profiles, titles, episodes, publish gating, likes, watchlists
  - Direct-to-R2 uploads (streamed, type- and size-gated)
  - **Real byte-range media serving** (RFC 9110 single ranges: `bytes=a-b`, `a-`, `-n`) so seeking and resume work like a streaming service, because that is what streaming is
- **Web** ([apps/web](apps/web)): React + Vite + TypeScript. Home rails with continue-watching, Discover with visible ranking reasons, title and watch pages, search, watchlist, sign-in/up, and the full Studio flow
- **Shared** ([packages/shared](packages/shared)): one set of types and constants consumed by both sides
- **Tests** ([apps/api/test](apps/api/test)): the ranking fairness properties, range parser edge cases, auth crypto round-trips, validation schemas, and slug rules
- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): lint, typecheck, test, build on every push

## Getting started

Prerequisites: Node 22+ and npm (Wrangler 4 requires Node 22). No Cloudflare account is needed for local development; D1 and R2 run as local simulations.

```bash
npm install
npm run db:reset   # apply migrations and seed the local D1 database
npm run dev        # API on http://127.0.0.1:8787, web on http://localhost:5173
```

Open http://localhost:5173. The web dev server proxies `/api` and `/media` to the Worker, so everything is same-origin with zero CORS configuration.

### Demo accounts

The seed creates a small catalog around the Blender Foundation open movies plus four demo accounts, all with the password `SweamDemo1!`:

| Email | Role |
| --- | --- |
| `sam@demo.sweam` | Viewer with continue-watching history and a watchlist |
| `ana@demo.sweam` | Creator `@anavoss` (Sintel, Tears of Steel) |
| `nova@demo.sweam` | Creator `@novareyes` (Big Buck Bunny, Elephants Dream) |
| `mira@demo.sweam` | Creator `@miradocs` (Open Cinema Anthology, a 3-episode series) |

The seeded stats are chosen to make the fairness mechanics visible: open Discover and you will see Sintel (90 plays, devoted audience) outrank Big Buck Bunny (2,100 plays, indifferent audience), with the newest titles carried by the exploration and freshness terms.

### Verify everything

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Repository layout

```
apps/
  api/            Cloudflare Worker: routes, ranking, auth, media serving
    migrations/   D1 schema
    seed.sql      Demo catalog and accounts
    test/         Vitest unit tests for the core logic
  web/            React app: catalog, Discover, player, Studio
packages/
  shared/         Types and constants used by both apps
docs/
  ARCHITECTURE.md System design, data model, request flows, security notes
  ROADMAP.md      Where this goes next
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit, the data model, the ranking math, and the security posture
- [docs/ROADMAP.md](docs/ROADMAP.md): transcoding and HLS, the scout portal, moderation, monetization
- [CONTRIBUTING.md](CONTRIBUTING.md): standards for changes

## Content credits

The demo catalog uses the Blender Foundation open movies: Big Buck Bunny, Elephants Dream, Sintel, and Tears of Steel ((c) Blender Foundation, [blender.org](https://www.blender.org/about/projects/), CC-BY). The creator accounts around them are fictional seed data. The "Sweam" name and logo are placeholder branding for a portfolio project.

## License

MIT. See [LICENSE](LICENSE).
