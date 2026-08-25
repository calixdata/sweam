# The Sweam Creator Program

How Sweam earns, how creators earn, and who is eligible. Every number on this
page is enforced by code in this repository, and the market context comes from
the published rules of the platforms creators actually compare us against
(sources at the bottom; figures as published August 2026).

## How Sweam earns

Sweam is AVOD: free to watch, revenue from advertising sold against playback,
the Tubi half of the thesis. Today that is pre-roll inventory (viewer-initiated,
skippable after five seconds, one per title per session); the roadmap adds
mid-roll for long-form, sponsored rails, and FAST-style channels. Sweam keeps
45% of attributable ad revenue and pays 55% to the creator of the title the ad
ran against.

Two models we studied and deliberately rejected:

- **Netflix-style flat-fee licensing** (upfront payment for exclusive rights,
  often under $10,000 for independent films): predictable for the platform,
  but it caps a breakout title's upside at the moment of acquisition, and it
  gatekeeps the catalog behind an acquisitions desk.
- **Negotiated, unpublished revenue shares** (the common Tubi and FAST-carriage
  arrangement, where splits vary per deal and there is no public rate card):
  flexible for the platform, but the information asymmetry always favors the
  house.

Sweam's position: **one published split, the same for everyone, frozen into the
ledger at serve time.** Nobody negotiates a better deal, and nobody gets a
worse one.

## How creators earn

- **The split: 55% of attributable ad revenue.** This matches YouTube's
  long-form Partner Program split (55/45), the most creator-favorable published
  benchmark among the major platforms; TikTok's Creator Rewards and YouTube
  Shorts instead pay from pooled funds at effective RPMs of roughly $0.40 to
  $2.00, and Twitch starts subscriptions at 50/50 with 70/30 earned only above
  sustained thresholds.
- **Attribution is per impression.** An ad served against your title writes one
  ledger row with your share computed and frozen at that moment (integer
  millicents; later pricing changes never rewrite history). This is direct
  attribution, not a pooled fund: your title's audience, your revenue.
- **Payout minimum: $10.00** of available earnings, one open request at a
  time. Benchmarks: YouTube/AdSense $100, Meta roughly $25 to $100 by program,
  TikTok Creator Rewards around $10. We sit at the indie-friendly end on
  purpose.
- Payout requests are reviewed by an admin; movement of real money (and tax
  onboarding) arrives with the payment-provider integration and is tracked as
  ledger state until then, stated plainly.

## Monetization eligibility

Every major platform gates monetization on the same four dimensions. Published
examples, as of August 2026:

| Platform | Audience minimum | Engagement minimum | Standing and content rules |
| --- | --- | --- | --- |
| YouTube Partner Program (full ads) | 1,000 subscribers | 4,000 public watch hours in 12 months, or 10M Shorts views in 90 days | No active strikes; monetization policies; region; (announced for new applicants from Feb 2027: 8,000 hours or 20M Shorts views) |
| YouTube (fan-funding tier) | 500 subscribers | 3,000 watch hours in 12 months or 3M Shorts views in 90 days, plus 3 uploads in 90 days | Same |
| TikTok Creator Rewards | 10,000 followers | 100,000 video views in 30 days; videos over 1 minute for the higher tier | 18+; good standing; originality scoring; personal/creator accounts only |
| Meta (Facebook Content Monetization) | Roughly 5,000 to 10,000 followers by region/era | Up to 600,000 minutes viewed in 60 days | 18+; professional mode; ~30-day account age; originality emphasized |
| Twitch (Plus Program splits) | Sustained concurrent viewership / Plus Points | 100 points for 60/40, 300 for 70/30 | Standing; paid recurring subs only count |

Sweam launches with the same **structure** at day-one scale, with the growth
path published up front instead of moved quietly later:

| Requirement | Launch value (enforced today) | Growth target (as the platform matures) |
| --- | --- | --- |
| Followers | 5 | 500 |
| Watch time on your published titles | 1,000 minutes (lifetime) | 50,000 minutes |
| Published titles | 1 | 3 |
| Account standing | No suspension (three active strikes in 90 days suspends monetization along with publishing) | Same |

Mechanics, all enforced in code:

- Eligibility is evaluated automatically at every ad serve. Ineligible
  creators' titles still play ads (as on YouTube, where ads can run on
  non-monetized content with no revenue share); the creator's share begins
  accruing the moment the thresholds are met, and your earnings page shows
  live progress toward each one.
- Strikes pause accrual; revocation or expiry (90 days) resumes it. Nothing
  retroactive in either direction.
- Threshold changes apply from a stated date, never retroactively to already
  accrued earnings.

## Content inclusion: how titles get on Sweam

Two doors, mirroring what worked in the market: YouTube's open self-serve and
Tubi/Netflix's curated intake.

1. **Studio (self-serve).** Approved creators publish directly: catalog-grade
   metadata (kind, genre, advisory, captions), the transcode pipeline, and the
   equal-visibility discovery ranking documented in ARCHITECTURE.md.
2. **Submissions (curated intake).** Anyone can submit finished work for
   review at `/submit` with a link to a screener. A human reviews every
   submission; acceptance invites the submitter to create a creator profile
   and publish through the Studio.

What review looks for, in order: you hold the rights (confirmed at submission,
misrepresentation is a strike and removal under the DMCA process); the work is
original and finished (every platform we studied now scores originality and
demotes repost accounts; Sweam simply requires it); it fits a catalog category
(film, series, short, documentary) with honest metadata; and it clears the
content policies enforced by the moderation system (reports, takedowns,
strikes).

What review does not consider: follower counts elsewhere, agents, or
distributors. Discovery on Sweam is impressions-normalized; the whole point is
that a first-time filmmaker and an established one compete on finish rate.

## Sources

- YouTube Partner Program overview and eligibility: https://support.google.com/youtube/answer/72851 and https://www.youtube.com/creators/earn/youtube-partner-program/
- YouTube partner earnings and splits: https://support.google.com/youtube/answer/72902 and https://blog.youtube/news-and-events/youtube-partner-program-updates-2027-new-opportunities-earn/
- TikTok Creator Rewards eligibility: https://www.tiktok.com/discover/creator-rewards-program-eligibility-requirements-guidelines
- Meta / Facebook content monetization requirements: https://multilogin.com/blog/facebook-content-monetization/ and https://artha.link/blog/facebook-monetization-requirements/
- Twitch Plus Program splits: https://influencermarketinghub.com/twitch-partner-plus/ and https://streamernews.gg/guides/twitch-revenue-split-explained/
- Tubi content deal structures: https://ifilmthings.com/how-does-tubi-pay-filmmakers/ and https://vitrina.ai/blog/tubi-content-acquisition-unraveling-the-streaming-giants-strategy-vitrina-ai/
- Netflix licensing model and indie acquisition: https://www.filmtake.com/streaming/unveiling-netflixs-new-content-strategy-opening-doors-to-external-licensing/ and https://www.manhattansociety.com/how-much-netflix-pays-for-movies/
- Roku inventory-split model: https://developer.roku.com/docs/features/monetization/video-advertisements.md
- Payout minimums: https://mediacube.io/en-US/blog/how-to-withdraw-money-from-youtube and https://www.podcastvideos.com/articles/creator-platform-payouts-onlyfans-patreon-youtube/
