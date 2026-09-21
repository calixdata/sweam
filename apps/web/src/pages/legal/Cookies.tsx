import { Link } from 'react-router-dom';
import { resetConsent, setConsent, useConsent } from '../../consent';
import { CONTACT, LegalDoc, OPERATOR, SERVICE } from './LegalDoc';
import type { LegalSection } from './LegalDoc';

/** Live consent control, embedded in the "Your choice" section of this page. */
function ConsentControls() {
  const consent = useConsent();
  const status = !consent
    ? 'You have not chosen yet, so analytics is off.'
    : consent.analytics
      ? 'Analytics is currently allowed. Thank you.'
      : 'Analytics is currently declined.';

  return (
    <div className="consent-controls">
      <p className="status" role="status">
        {status}
      </p>
      <div className="consent-controls-buttons">
        <button
          type="button"
          className="button"
          onClick={() => setConsent(true)}
          aria-pressed={consent?.analytics === true}
        >
          Allow analytics
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => setConsent(false)}
          aria-pressed={consent?.analytics === false}
        >
          Decline analytics
        </button>
        {consent && (
          <button type="button" className="button button-quiet" onClick={resetConsent}>
            Reset choice
          </button>
        )}
      </div>
    </div>
  );
}

const sections: LegalSection[] = [
  {
    id: 'summary',
    heading: '1. The short version',
    body: (
      <p>
        {SERVICE} uses <strong>one essential cookie</strong> to keep you signed in and,{' '}
        <strong>only with your permission</strong>, cookieless analytics we run ourselves. There are
        no advertising cookies and no third-party trackers.
      </p>
    ),
  },
  {
    id: 'essential',
    heading: '2. Essential cookie',
    body: (
      <>
        <p>This cookie is required for the service and is not subject to consent:</p>
        <ul>
          <li>
            <strong>Name:</strong> <code>sweam_session</code>
          </li>
          <li>
            <strong>Purpose:</strong> keeps you signed in. It holds a random session token and no
            personal information.
          </li>
          <li>
            <strong>Duration:</strong> up to 30 days, and it is cleared when you sign out.
          </li>
          <li>
            <strong>Protections:</strong> first-party, marked HttpOnly (not readable by JavaScript),
            SameSite=Lax, and sent only over HTTPS in production.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'local-storage',
    heading: '3. Local storage',
    body: (
      <>
        <p>
          {SERVICE} also uses your browser's local storage, which is not a cookie and is never sent
          to a server, for small conveniences:
        </p>
        <ul>
          <li>
            your cookie choice on this page, so we do not ask again on every visit;
          </li>
          <li>
            minor interface state, such as remembering an in-progress upload in the Studio.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'analytics',
    heading: '4. Analytics (consent required)',
    body: (
      <p>
        When you allow analytics, {SERVICE} measures traffic with its own first-party system at
        analytics.sweam.co. It sets <strong>no cookies at all</strong> and stores no personal data;
        the <Link to="/legal/privacy">Privacy Policy</Link> describes exactly what it records and how
        the daily, salted visitor count works. It stays off until you allow it, and a Do-Not-Track or
        Global Privacy Control signal keeps it off regardless.
      </p>
    ),
  },
  {
    id: 'no-third-party',
    heading: '5. No third-party or advertising cookies',
    body: (
      <p>
        Advertising on {SERVICE} is not targeted with tracking cookies, and we do not embed
        third-party analytics, social, or ad-network trackers. If that ever changes, this policy and
        the consent banner will change with it, and your existing choice will be honored.
      </p>
    ),
  },
  {
    id: 'your-choice',
    heading: '6. Your choice',
    body: (
      <>
        <p>Change your analytics choice at any time here:</p>
        <ConsentControls />
        <p>
          You can also block or delete cookies in your browser settings; blocking the essential
          cookie will sign you out. The "Cookie settings" link in the footer reopens the banner.
        </p>
      </>
    ),
  },
];

export function Cookies() {
  return (
    <LegalDoc
      title="Cookie Policy"
      contact={CONTACT.privacy}
      summary={
        <>
          What {OPERATOR} stores in your browser for {SERVICE}, and how to control it. The goal is
          the smallest footprint that still lets the service work.
        </>
      }
      sections={sections}
    />
  );
}
