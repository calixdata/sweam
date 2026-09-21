import { Link } from 'react-router-dom';
import { setConsent, useConsent } from '../consent';

/**
 * Consent banner for the one non-essential cookie category (first-party
 * analytics). It shows only until a choice is made, offers Decline and Allow
 * with equal weight (no dark patterns, nothing pre-selected), and links to the
 * full Cookie Policy. The essential sign-in cookie is never gated here. Once
 * decided it disappears; the footer's "Cookie settings" brings it back.
 */
export function CookieConsent() {
  const consent = useConsent();
  if (consent) return null;

  return (
    <section className="cookie-banner" role="region" aria-label="Cookie consent">
      <div className="cookie-banner-inner">
        <div className="cookie-banner-copy">
          <h2>Cookies on Sweam</h2>
          <p>
            Sweam uses one essential cookie to keep you signed in. With your permission we also
            collect privacy-first, cookieless analytics on our own servers — no third parties, no ad
            tracking, no selling data. See the{' '}
            <Link to="/legal/cookies">Cookie Policy</Link> for details.
          </p>
        </div>
        <div className="cookie-banner-actions">
          <button type="button" className="button button-quiet" onClick={() => setConsent(false)}>
            Decline analytics
          </button>
          <button type="button" className="button" onClick={() => setConsent(true)}>
            Allow analytics
          </button>
        </div>
      </div>
    </section>
  );
}
