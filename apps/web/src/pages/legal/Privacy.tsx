import { Link } from 'react-router-dom';
import { MIN_AGE } from '@sweam/shared';
import { CONTACT, LegalDoc, MailLink, OPERATOR, SERVICE } from './LegalDoc';
import type { LegalSection } from './LegalDoc';

const sections: LegalSection[] = [
  {
    id: 'scope',
    heading: '1. Scope',
    body: (
      <p>
        This policy explains what {OPERATOR} collects when you use {SERVICE}, why, who it is shared
        with, and the choices you have. It covers the {SERVICE} website and service. It does not
        cover third-party sites a title or link may take you to.
      </p>
    ),
  },
  {
    id: 'what-we-collect',
    heading: '2. What we collect',
    body: (
      <>
        <p>We collect only what the service needs to work:</p>
        <ul>
          <li>
            <strong>Account:</strong> your email, display name, and a securely hashed password. We
            never store your password in readable form.
          </li>
          <li>
            <strong>Creator profile</strong> (if you publish): your handle, bio, and the titles,
            episodes, media, and metadata you upload.
          </li>
          <li>
            <strong>Activity:</strong> what you add to your watchlist, where you left off in an
            episode, and aggregate signals such as plays, completions, likes, follows, and comments.
            This drives continue-watching and discovery.
          </li>
          <li>
            <strong>Scout portal</strong> (if you request access): your organization name, an
            optional URL, and a contact email you choose to share so creators can reach you.
          </li>
          <li>
            <strong>Submissions and payouts:</strong> the details and screener link you provide when
            submitting work, and payout requests creators make against their earnings.
          </li>
          <li>
            <strong>Identity verification</strong> (only if you request the verified check): your
            legal name and the two documents you upload, a government-issued ID and a proof of
            address. They are used for that review alone, are visible only to the Sweam staff
            member reviewing them, and are deleted as soon as the request is decided; we keep the
            decision and date, not the documents.
          </li>
          <li>
            <strong>Technical:</strong> standard server logs (such as IP address and request time)
            kept briefly for security and reliability, and the privacy-first analytics described
            below.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'analytics',
    heading: '3. Cookieless analytics',
    body: (
      <>
        <p>
          With your consent, {SERVICE} measures traffic using our own first-party analytics at
          analytics.sweam.co. It is built to be private by design:
        </p>
        <ul>
          <li>no cookies, no cross-site tracking, and no third-party analytics provider;</li>
          <li>
            we do not store your IP address or user agent. To count returning visits for a day
            without identifying you, our server turns those values into a one-way hash using a salt
            that rotates every day and is never written down, so the count cannot be traced back to
            you or linked across days;
          </li>
          <li>we record only the page path, the referring site's host, and a coarse screen-size bucket;</li>
          <li>analytics stays off until you allow it, and a Do-Not-Track or Global Privacy Control
            signal turns it off regardless.</li>
        </ul>
        <p>
          You control this in the <Link to="/legal/cookies">Cookie Policy</Link> and the consent
          banner.
        </p>
      </>
    ),
  },
  {
    id: 'how-we-use',
    heading: '4. How we use it',
    body: (
      <ul>
        <li>to run {SERVICE}: sign you in, remember your watchlist and progress, and stream titles;</li>
        <li>to power transparent discovery and recommendations based on real finish rates;</li>
        <li>to calculate creator earnings and process payouts;</li>
        <li>to connect creators with scouts who express interest in titles the creator has opted to share;</li>
        <li>to keep {SERVICE} safe: moderation, handling reports and takedowns, and preventing abuse;</li>
        <li>to send you service notifications you can see in the app;</li>
        <li>to understand aggregate traffic (only with your analytics consent);</li>
        <li>to meet legal obligations and enforce our terms.</li>
      </ul>
    ),
  },
  {
    id: 'legal-bases',
    heading: '5. Legal bases (EEA/UK)',
    body: (
      <p>
        Where the GDPR or UK GDPR applies, we rely on: performance of our contract with you (running
        your account and the service); our legitimate interests (keeping the service secure,
        improving discovery, connecting creators and scouts) balanced against your rights; your
        consent (for analytics); and compliance with legal obligations.
      </p>
    ),
  },
  {
    id: 'sharing',
    heading: '6. When we share information',
    body: (
      <>
        <p>
          We do not sell your personal data. We share it only in these ways:
        </p>
        <ul>
          <li>
            <strong>Infrastructure:</strong> we host {SERVICE} on Cloudflare (compute, database, and
            media storage). They process data on our behalf under their terms.
          </li>
          <li>
            <strong>Scouts:</strong> when a creator marks a title as visible to scouts, approved
            scouts can see that title's performance stats and the creator's public bio. If a scout
            expresses interest, the contact email the scout volunteered is shared with that creator.
            We log scout views and show them to the creator.
          </li>
          <li>
            <strong>Advertisers:</strong> only aggregate, non-identifying figures (such as total
            impressions). Advertising on {SERVICE} is not behaviorally targeted with tracking
            cookies, and advertisers do not receive your identity.
          </li>
          <li>
            <strong>Legal and safety:</strong> where required by law or to protect people, creators,
            or the service.
          </li>
          <li>
            <strong>Business transfer:</strong> if {OPERATOR} is involved in a merger, acquisition,
            or asset sale, information may transfer as part of that deal, subject to this policy.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'retention',
    heading: '7. How long we keep it',
    body: (
      <p>
        We keep account and content data while your account is active and as needed to provide the
        service. Identity verification documents are deleted the moment the request is approved or
        rejected. Server logs are kept briefly for security. Analytics records are aggregate and hold
        no identifiers. When you delete content or close your account, we remove or de-identify your
        data within a reasonable period, except where we must keep records to comply with the law,
        resolve disputes, or enforce our agreements.
      </p>
    ),
  },
  {
    id: 'your-rights',
    heading: '8. Your choices and rights',
    body: (
      <>
        <p>
          You can view and update your account and creator profile in the app, manage analytics
          consent from the Cookie Policy, and control notifications. Depending on where you live, you
          may have the right to access, correct, delete, or export your personal data, and to object
          to or restrict certain processing.
        </p>
        <p>
          To make a request, email <MailLink address={CONTACT.privacy} />. We will verify and
          respond as the law requires. If you are in California, we do not sell or share your
          personal information as those terms are defined under the CCPA/CPRA, and we will not
          discriminate against you for exercising your rights.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    heading: '9. Security',
    body: (
      <p>
        We protect data in transit with encryption, hash passwords, and limit access. No online
        service is perfectly secure, but we work to protect your information and will notify you and
        the authorities where the law requires it after a breach.
      </p>
    ),
  },
  {
    id: 'children',
    heading: '10. Children',
    body: (
      <p>
        {SERVICE} is for people aged {MIN_AGE} and older. It is not directed to children, we do not
        accept content made for children under 13, and we do not knowingly collect personal data
        from anyone under {MIN_AGE}. If you believe someone under {MIN_AGE} has given us data,
        contact <MailLink address={CONTACT.privacy} /> and we will delete it.
      </p>
    ),
  },
  {
    id: 'international',
    heading: '11. International transfers',
    body: (
      <p>
        {SERVICE} runs on globally distributed infrastructure, so your data may be processed in
        countries other than your own, including the United States. Where required, we use
        appropriate safeguards for those transfers.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: '12. Changes to this policy',
    body: (
      <p>
        We will update this policy as the service changes and revise the date at the top. Material
        changes will be signalled in the app where appropriate.
      </p>
    ),
  },
];

export function Privacy() {
  return (
    <LegalDoc
      title="Privacy Policy"
      contact={CONTACT.privacy}
      summary={
        <>
          {SERVICE} is built to collect as little as it can and to keep what it collects private. No
          data selling, no third-party ad tracking, and analytics that stay off until you allow
          them.
        </>
      }
      sections={sections}
    />
  );
}
