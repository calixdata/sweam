import { Link } from 'react-router-dom';
import {
  CREATOR_REVENUE_SHARE,
  MIN_PAYOUT_MILLICENTS,
  MONETIZATION_THRESHOLDS,
  formatMillicents,
} from '@sweam/shared';
import { CONTACT, LegalDoc, OPERATOR, SERVICE } from './LegalDoc';
import type { LegalSection } from './LegalDoc';

const SHARE_PERCENT = Math.round(CREATOR_REVENUE_SHARE * 100);
const WATCH_MINUTES = Math.round(MONETIZATION_THRESHOLDS.minWatchSeconds / 60).toLocaleString();
const MIN_PAYOUT = formatMillicents(MIN_PAYOUT_MILLICENTS);

const sections: LegalSection[] = [
  {
    id: 'who',
    heading: '1. Who this covers',
    body: (
      <p>
        This Creator Agreement applies when you publish work on {SERVICE} through the Studio or
        submit work for inclusion. It adds to the <Link to="/legal/terms">Terms of Service</Link>;
        where they conflict on creator matters, this agreement controls.
      </p>
    ),
  },
  {
    id: 'ownership',
    heading: '2. You keep ownership',
    body: (
      <p>
        You own your work. You grant {OPERATOR} the non-exclusive, worldwide, royalty-free license
        described in the <Link to="/legal/terms">Terms</Link> to host, encode, stream, and promote
        it while it is on {SERVICE}. The license is non-exclusive, so you remain free to distribute
        your work anywhere else, and it ends when you remove the work or close your account, apart
        from copies the law requires us to keep or that were already delivered to viewers.
      </p>
    ),
  },
  {
    id: 'your-promises',
    heading: '3. What you promise',
    body: (
      <ul>
        <li>You hold, or have cleared, all rights needed to stream the work, including music and any third-party material.</li>
        <li>The work is yours and finished: no reposts, no rips, no misrepresented metadata.</li>
        <li>You give an honest viewer rating and describe it accurately, and follow the <Link to="/legal/community-guidelines">Community Guidelines</Link> and <Link to="/legal/ai">AI Disclosure</Link>.</li>
        <li>The work contains no forbidden content. You accept that submitting or uploading explicit, pornographic, or otherwise forbidden content results in a <strong>permanent account ban</strong>.</li>
        <li>You will not manipulate views, finish rates, followers, or earnings.</li>
      </ul>
    ),
  },
  {
    id: 'adaptations',
    heading: '4. Adapting a published work',
    body: (
      <>
        <p>
          If your work adapts a third-party published work (a book, script, article, song, or other
          copyrighted material you did not create), you must say so when you submit and provide, for{' '}
          {OPERATOR}&rsquo;s review, proof that you hold or have licensed the rights to adapt it,
          together with identification.
        </p>
        <p>
          By submitting an adaptation you attest that the information and documents you provide are
          true and that you hold all rights necessary to adapt and stream the work. You agree to{' '}
          <strong>
            indemnify and hold {OPERATOR} and {SERVICE} harmless
          </strong>{' '}
          from any claim, loss, or liability arising from the work or your rights to it. Submitting
          an adaptation you are not authorized to use is grounds for removal and a permanent account
          ban.
        </p>
      </>
    ),
  },
  {
    id: 'revenue-share',
    heading: '5. The revenue share',
    body: (
      <p>
        {SERVICE} is free to viewers and supported by advertising. You earn a{' '}
        <strong>{SHARE_PERCENT}%</strong> share of the ad revenue generated on your titles. It is one
        published split, the same for every creator, with no negotiation. Earnings are tracked in an
        exact, integer-precision ledger and shown on your earnings page in the Studio.
      </p>
    ),
  },
  {
    id: 'eligibility',
    heading: '6. When earnings start',
    body: (
      <>
        <p>Your {SHARE_PERCENT}% share begins to accrue once your account meets every one of these, and while it stays in good standing:</p>
        <ul>
          <li>{MONETIZATION_THRESHOLDS.minFollowers} followers;</li>
          <li>{WATCH_MINUTES} watch-minutes across your published titles;</li>
          <li>
            {MONETIZATION_THRESHOLDS.minPublishedTitles} published title
            {MONETIZATION_THRESHOLDS.minPublishedTitles === 1 ? '' : 's'};
          </li>
          <li>an account in good standing (not suspended).</li>
        </ul>
        <p>
          Ads may run on your titles before you are eligible, but the creator share accrues only once
          every threshold is met, evaluated at each ad served. Your earnings page shows your progress
          toward each one. The full policy, with how these compare to YouTube, TikTok, Meta, Tubi,
          and Netflix, is in the public{' '}
          <a href="https://github.com/calixdata/sweam/blob/main/docs/CREATOR-PROGRAM.md">
            Creator Program document
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'payouts',
    heading: '7. Payouts',
    body: (
      <p>
        You can request a payout once your available balance reaches <strong>{MIN_PAYOUT}</strong>,
        far below the higher floors common elsewhere. You are responsible for the taxes on your
        earnings, and we may need valid tax and payment details before releasing a payout. Payment
        processing is handled by a third-party provider; the specific provider and payout timing are
        being finalized and will be confirmed in the Studio before payouts open.
      </p>
    ),
  },
  {
    id: 'scouts',
    heading: '8. Scouts and outside deals',
    body: (
      <p>
        You can opt a title into the scout portal, where approved networks and buyers see its
        performance and your public bio. If a scout expresses interest, we pass you the contact
        details they volunteered. Any deal you make with a network is between you and them:{' '}
        {OPERATOR} is not a party to it and <strong>takes no cut</strong>. Equal visibility for every
        creator is the point of the portal.
      </p>
    ),
  },
  {
    id: 'removal',
    heading: '9. Removal, takedowns, and strikes',
    body: (
      <p>
        Work that violates the <Link to="/legal/terms">Terms</Link>, the{' '}
        <Link to="/legal/community-guidelines">Community Guidelines</Link>, or a valid copyright
        notice may be removed, and strikes may be issued. Three active strikes suspend publishing and
        uploads. Removal stops future earnings on that work; earnings already, properly accrued to
        your ledger are not clawed back except in cases of fraud or manipulation.
      </p>
    ),
  },
  {
    id: 'relationship',
    heading: '10. Our relationship',
    body: (
      <p>
        You are an independent creator, not an employee or agent of {OPERATOR}, and this agreement
        does not create a partnership. We do not guarantee any level of audience, revenue, or
        placement. Discovery is earned through what audiences watch.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: '11. Changes to the program',
    body: (
      <p>
        We may adjust the program, including thresholds or the split, as {SERVICE} grows. Material
        changes will be reflected here and in the public Creator Program document, with notice where
        appropriate. Continuing to publish after a change means you accept it.
      </p>
    ),
  },
];

export function CreatorAgreement() {
  return (
    <LegalDoc
      title="Creator Agreement"
      contact={CONTACT.support}
      summary={
        <>
          The deal for creators on {SERVICE}, in plain terms: you keep ownership, you earn a{' '}
          {SHARE_PERCENT}% share of ad revenue, and discovery is equal by design. This is the fuller
          version of what the Submit page summarizes.
        </>
      }
      sections={sections}
    />
  );
}
