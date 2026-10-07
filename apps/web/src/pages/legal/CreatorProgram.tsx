import { Link } from 'react-router-dom';
import { BLU_CREATOR_SHARE, CREATOR_REVENUE_SHARE, MONETIZATION_THRESHOLDS } from '@sweam/shared';
import { CONTACT, LegalDoc, SERVICE } from './LegalDoc';

/**
 * The Sweam Creator Program and Blu Creator Fund, on sweam.co. This is the
 * canonical public statement of how Sweam earns, how creators earn, the
 * eligibility thresholds, and how work gets on the catalog. Numbers are read
 * from the shared constants the API enforces, so the page cannot drift from
 * the code.
 */
export function CreatorProgram() {
  const adShare = Math.round(CREATOR_REVENUE_SHARE * 100);
  const bluShare = Math.round(BLU_CREATOR_SHARE * 100);
  const watchMinutes = Math.round(MONETIZATION_THRESHOLDS.minWatchSeconds / 60);
  return (
    <LegalDoc
      title="Creator Program and Blu Creator Fund"
      contact={CONTACT.support}
      updated="October 7, 2026"
      summary={
        <>
          How {SERVICE} earns, how creators earn, who is eligible, and how titles get on the catalog.
          Every number on this page is enforced by {SERVICE}&rsquo;s code, and the same split applies to
          everyone. There is no negotiated deal and no private rate card.
        </>
      }
      sections={[
        {
          id: 'how-sweam-earns',
          heading: '1. How Sweam earns',
          body: (
            <>
              <p>
                {SERVICE} is free to watch and supported by advertising sold against playback. Today
                that is pre-roll inventory: viewer-initiated, skippable after five seconds, one per
                title per session. The roadmap adds mid-roll for long-form, sponsored rails and
                channel-style programming.
              </p>
              <p>
                {SERVICE} keeps {100 - adShare}% of attributable ad revenue and pays {adShare}% to the
                creator of the title the ad ran against. For Sweam Blu, where a creator sets their own
                monthly price, the creator keeps {bluShare}% of every subscription.
              </p>
              <p>Two models we studied and deliberately rejected:</p>
              <ul>
                <li>
                  <strong>Flat-fee licensing</strong> (an upfront payment for exclusive rights, often
                  under $10,000 for an independent film). Predictable for the platform, but it caps a
                  breakout title&rsquo;s upside at the moment of acquisition and gatekeeps the catalog
                  behind an acquisitions desk.
                </li>
                <li>
                  <strong>Negotiated, unpublished revenue shares</strong> (the common ad-supported
                  streaming arrangement, where splits vary per deal and there is no public rate card).
                  Flexible for the platform, but the information asymmetry always favors the house.
                </li>
              </ul>
              <p>
                {SERVICE}&rsquo;s position: one published split, the same for everyone, frozen into the
                ledger at the moment each ad is served. Nobody negotiates a better deal, and nobody gets
                a worse one.
              </p>
            </>
          ),
        },
        {
          id: 'blu-creator-fund',
          heading: '2. The Blu Creator Fund: how creators earn',
          body: (
            <>
              <ul>
                <li>
                  <strong>The split: {adShare}% of attributable ad revenue.</strong> This matches the
                  most creator-favorable published long-form benchmark among the major platforms.
                  Pooled-fund programs on short-form platforms typically pay effective rates of roughly
                  $0.40 to $2.00 per thousand views, and live-streaming subscriptions commonly start at
                  50/50.
                </li>
                <li>
                  <strong>Attribution is per impression.</strong> An ad served against your title writes
                  one ledger row with your share computed and frozen at that moment. Later pricing
                  changes never rewrite history. This is direct attribution, not a pooled fund: your
                  title&rsquo;s audience, your revenue.
                </li>
                <li>
                  <strong>Sweam Blu subscriptions.</strong> If you place a title behind your own monthly
                  price, {bluShare}% of each subscription is yours. Blu titles are excluded from the
                  public swipe feed and from Discover, and subscribers reach them from your profile and
                  the catalog.
                </li>
                <li>
                  <strong>Payout minimum: $10.00</strong> of available earnings, one open request at a
                  time. Larger platforms commonly set this at $25 to $100. We sit at the independent
                  end on purpose.
                </li>
                <li>
                  Payout requests are reviewed by {SERVICE} staff. Movement of money, and tax
                  onboarding, run through the payment provider connected in your Studio earnings page,
                  and every allocation is tracked as ledger state until it is paid.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'eligibility',
          heading: '3. Monetization eligibility',
          body: (
            <>
              <p>
                Every major platform gates monetization on the same four dimensions: audience,
                engagement, published work, and account standing. {SERVICE} launches with the same
                structure at day-one scale, and publishes the growth path up front instead of moving
                it quietly later.
              </p>
              <table className="legal-table">
                <caption>Eligibility thresholds</caption>
                <thead>
                  <tr>
                    <th scope="col">Requirement</th>
                    <th scope="col">Launch value (enforced today)</th>
                    <th scope="col">Growth target (as the platform matures)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Followers</th>
                    <td>{MONETIZATION_THRESHOLDS.minFollowers.toLocaleString()}</td>
                    <td>500</td>
                  </tr>
                  <tr>
                    <th scope="row">Watch time on your published titles</th>
                    <td>{watchMinutes.toLocaleString()} minutes, lifetime</td>
                    <td>50,000 minutes</td>
                  </tr>
                  <tr>
                    <th scope="row">Published titles</th>
                    <td>{MONETIZATION_THRESHOLDS.minPublishedTitles}</td>
                    <td>3</td>
                  </tr>
                  <tr>
                    <th scope="row">Account standing</th>
                    <td>No suspension. Three active strikes in 90 days suspend monetization and publishing.</td>
                    <td>Same</td>
                  </tr>
                </tbody>
              </table>
              <p>Mechanics, all enforced in code:</p>
              <ul>
                <li>
                  Eligibility is evaluated automatically at every ad serve. Ineligible creators&rsquo;
                  titles still play ads; the creator&rsquo;s share begins accruing the moment every
                  threshold is met, and your earnings page shows live progress toward each one.
                </li>
                <li>
                  Strikes pause accrual. Revocation or expiry after 90 days resumes it. Nothing is
                  retroactive in either direction.
                </li>
                <li>
                  Threshold changes apply from a stated date, never retroactively to earnings already
                  accrued.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'getting-on-sweam',
          heading: '4. How titles get on Sweam',
          body: (
            <>
              <p>Two doors, mirroring what works in the market: open self-serve and curated intake.</p>
              <ol>
                <li>
                  <strong>Studio (self-serve).</strong> Approved creators publish directly with
                  catalog-grade metadata (kind, genre, advisory, captions, mandatory cover art), the
                  transcode pipeline, and the equal-visibility discovery ranking described in the{' '}
                  <Link to="/legal/ai">AI and ranking disclosure</Link>.
                </li>
                <li>
                  <strong>Submissions (curated intake).</strong> Anyone can submit finished work for
                  review at <Link to="/submit">Submit</Link>. A person reviews every submission.
                  Acceptance invites you to create a creator profile and publish through the Studio.
                </li>
              </ol>
              <p>What review looks for, in order:</p>
              <ul>
                <li>
                  You hold the rights, confirmed at submission. Misrepresentation is a strike and
                  removal under the DMCA process.
                </li>
                <li>
                  The work is original and finished. Every platform we studied now scores originality
                  and demotes repost accounts; {SERVICE} simply requires it.
                </li>
                <li>
                  It fits a catalog category (film, series, short, documentary) with honest metadata.
                </li>
                <li>
                  It clears the <Link to="/legal/community-guidelines">Community Guidelines</Link>,
                  enforced through reports, takedowns and strikes.
                </li>
              </ul>
              <p>
                What review does not consider: follower counts elsewhere, agents, or distributors.
                Discovery on {SERVICE} is impressions-normalized. A first-time filmmaker and an
                established one compete on finish rate.
              </p>
            </>
          ),
        },
        {
          id: 'related',
          heading: '5. Related documents',
          body: (
            <ul>
              <li>
                <Link to="/legal/creator-agreement">Creator Agreement</Link>: the contract between you
                and {SERVICE} when you publish.
              </li>
              <li>
                <Link to="/legal/terms">Terms of Service</Link> and{' '}
                <Link to="/legal/community-guidelines">Community Guidelines</Link>.
              </li>
              <li>
                <Link to="/legal/scout-terms">Scout Program Terms</Link>: how networks and studios
                discover titles on {SERVICE}.
              </li>
            </ul>
          ),
        },
      ]}
    />
  );
}
