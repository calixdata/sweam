import { Link } from 'react-router-dom';
import { CREATOR_REVENUE_SHARE } from '@sweam/shared';
import { CONTACT, GOVERNING_STATE, LegalDoc, MailLink, OPERATOR, SERVICE } from './LegalDoc';
import type { LegalSection } from './LegalDoc';

const SHARE_PERCENT = Math.round(CREATOR_REVENUE_SHARE * 100);

const sections: LegalSection[] = [
  {
    id: 'agreement',
    heading: '1. Agreement to these terms',
    body: (
      <>
        <p>
          {SERVICE} is a free, ad-supported streaming service operated by {OPERATOR} ("{OPERATOR}",
          "we", "us"). These Terms of Service are a binding agreement between you and {OPERATOR}. By
          creating an account, watching, or otherwise using {SERVICE}, you agree to these Terms, the{' '}
          <Link to="/legal/privacy">Privacy Policy</Link>, the{' '}
          <Link to="/legal/community-guidelines">Community Guidelines</Link>, and, if you publish
          work, the <Link to="/legal/creator-agreement">Creator Agreement</Link>. If you do not
          agree, do not use {SERVICE}.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    heading: '2. Who can use Sweam',
    body: (
      <>
        <p>
          {SERVICE} is intended for adults. You must be <strong>18 or older</strong> to create an
          account or use the service. By using {SERVICE} you represent that you are 18 or older and
          that you are able to enter into this agreement. The catalog includes mature titles, and
          not all content is suitable for every viewer.
        </p>
        <p>
          You are responsible for activity under your account and for keeping your credentials
          secure. Provide accurate information, keep it current, and do not share your account or
          use someone else's.
        </p>
      </>
    ),
  },
  {
    id: 'service',
    heading: '3. What Sweam provides',
    body: (
      <>
        <p>
          {SERVICE} is a catalog of films, series, shorts, and documentaries, including work from
          independent creators, presented for free with advertising. Titles are surfaced through a
          transparent discovery system that ranks on how audiences actually finish work rather than
          on follower counts. How that works is described in the public{' '}
          <a href="https://github.com/calixdata/sweam/blob/main/docs/ARCHITECTURE.md">
            architecture notes
          </a>
          .
        </p>
        <p>
          {SERVICE} is under active development. We may add, change, suspend, or remove features,
          titles, or the service itself at any time, and availability is not guaranteed.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    heading: '4. Accounts and access',
    body: (
      <>
        <p>
          Some features (your watchlist, publishing through the Studio, the scout portal,
          notifications) require an account. We keep you signed in with a single essential session
          cookie; the <Link to="/legal/cookies">Cookie Policy</Link> explains it.
        </p>
        <p>
          You may stop using {SERVICE} at any time. We may suspend or close an account that violates
          these Terms, the <Link to="/legal/community-guidelines">Community Guidelines</Link>, or
          the law, or where we reasonably need to protect viewers, creators, or the service. Where a
          creator accrues repeated policy strikes, publishing and uploads are suspended as described
          in the Community Guidelines.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    heading: '5. Acceptable use',
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>upload or share content you do not have the rights to, or that is unlawful;</li>
          <li>
            harass, threaten, or harm others, or post content prohibited by the{' '}
            <Link to="/legal/community-guidelines">Community Guidelines</Link>;
          </li>
          <li>
            interfere with the service, probe or breach its security, or access it with bots,
            scrapers, or automated means except a public search engine indexing the site;
          </li>
          <li>
            misrepresent your identity or affiliation, or manipulate views, finish rates, likes,
            followers, or earnings;
          </li>
          <li>reverse engineer or resell the service except where that restriction is unlawful.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'your-content',
    heading: '6. Content you submit',
    body: (
      <>
        <p>
          You keep ownership of everything you submit, whether that is a title, an episode, a
          comment, a creator bio, or a submission for review. You are responsible for your content
          and for having the rights to it.
        </p>
        <p>
          To operate {SERVICE} we need your permission to host and show your content. By submitting
          content you grant {OPERATOR} a worldwide, non-exclusive, royalty-free license to host,
          store, reproduce, encode, adapt for delivery, publicly perform, and display that content
          for the purpose of running and promoting {SERVICE}. This license ends when you remove the
          content or close your account, except for copies kept as required by law or already served
          to viewers. If you publish titles, the fuller terms, including the {SHARE_PERCENT}% revenue
          share, are in the <Link to="/legal/creator-agreement">Creator Agreement</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'our-ip',
    heading: '7. Sweam’s intellectual property',
    body: (
      <p>
        The {SERVICE} name, logo, software, design, and the compilation of the catalog belong to{' '}
        {OPERATOR} or its licensors and are protected by law. These Terms do not give you rights in
        our brand or software beyond using the service as intended. If you send us feedback or
        suggestions, we may use them without obligation to you.
      </p>
    ),
  },
  {
    id: 'copyright',
    heading: '8. Copyright and takedowns',
    body: (
      <>
        <p>
          {OPERATOR} respects copyright and responds to valid notices under the U.S. Digital
          Millennium Copyright Act (DMCA). If you believe content on {SERVICE} infringes your
          copyright, send a notice to <MailLink address={CONTACT.dmca} /> that includes: your
          contact details; identification of the work; the {SERVICE} URL of the material; a
          statement of good-faith belief that the use is unauthorized; a statement, under penalty of
          perjury, that your notice is accurate and you are authorized to act; and your signature.
        </p>
        <p>
          We remove or disable material in response to valid notices, notify the affected creator,
          and accept counter-notices. We record copyright strikes and terminate repeat infringers.
        </p>
      </>
    ),
  },
  {
    id: 'ads-earnings',
    heading: '9. Advertising and earnings',
    body: (
      <p>
        {SERVICE} is free to watch and supported by advertising. Creators who meet the published
        eligibility thresholds earn a {SHARE_PERCENT}% share of the ad revenue their titles generate,
        paid through the ledger described in the{' '}
        <Link to="/legal/creator-agreement">Creator Agreement</Link> and the public{' '}
        <a href="https://github.com/calixdata/sweam/blob/main/docs/CREATOR-PROGRAM.md">
          Creator Program document
        </a>
        . Earnings depend on real viewership and advertiser demand and are not guaranteed. We do not
        sell your personal data to advertisers; advertising on {SERVICE} is not behaviorally
        targeted using tracking cookies.
      </p>
    ),
  },
  {
    id: 'disclaimers',
    heading: '10. Disclaimers',
    body: (
      <p>
        {SERVICE} is provided "as is" and "as available", without warranties of any kind, whether
        express or implied, including merchantability, fitness for a particular purpose, and
        non-infringement, to the fullest extent permitted by law. We do not warrant that the service
        will be uninterrupted, secure, or error-free, or that any content is accurate or will remain
        available.
      </p>
    ),
  },
  {
    id: 'liability',
    heading: '11. Limitation of liability',
    body: (
      <p>
        To the fullest extent permitted by law, {OPERATOR} and its people will not be liable for any
        indirect, incidental, special, consequential, or punitive damages, or for lost profits,
        revenue, data, or goodwill, arising from your use of {SERVICE}. Our total liability for any
        claim relating to the service is limited to the greater of the amount you paid us in the
        twelve months before the claim (which for a free service is typically zero) or one hundred
        U.S. dollars. Some jurisdictions do not allow these limits, so they may not fully apply to
        you.
      </p>
    ),
  },
  {
    id: 'indemnity',
    heading: '12. Indemnification',
    body: (
      <p>
        You agree to indemnify and hold {OPERATOR} harmless from claims, damages, and reasonable
        legal costs arising out of content you submit, your use of {SERVICE}, or your breach of
        these Terms, to the extent permitted by law.
      </p>
    ),
  },
  {
    id: 'governing-law',
    heading: '13. Governing law and disputes',
    body: (
      <p>
        These Terms are governed by the laws of the State of {GOVERNING_STATE}, without regard to
        its conflict-of-laws rules. Before filing anything, contact us at{' '}
        <MailLink address={CONTACT.legal} /> so we can try to resolve the matter informally. The
        specific dispute-resolution and venue provisions are among the items pending counsel review
        noted at the top of this page.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: '14. Changes to these terms',
    body: (
      <p>
        We may update these Terms as {SERVICE} evolves. If we make a material change we will update
        the date and, where appropriate, give notice in the app. Continuing to use {SERVICE} after a
        change means you accept the updated Terms.
      </p>
    ),
  },
];

export function Terms() {
  return (
    <LegalDoc
      title="Terms of Service"
      contact={CONTACT.legal}
      summary={
        <>
          These terms govern your use of {SERVICE}, the free streaming service {OPERATOR} runs for
          viewers and independent creators. They are written to be read: plain language first,
          detail where it matters.
        </>
      }
      sections={sections}
    />
  );
}
