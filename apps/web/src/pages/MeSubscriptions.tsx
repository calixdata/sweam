import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MySubscriptions } from '@sweam/shared';
import { SCOUT_ALL_ACCESS_CENTS, formatUsdCents } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { BluBadge } from '../components/BluBadge';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

/**
 * Manage subscriptions: the viewer's active Sweam Blu subscriptions and scout
 * all-access, with a link into the Stripe Billing Portal to update a card or
 * cancel. Blu charges are final and non-refundable; cancelling stops the next
 * renewal and access lasts to the end of the paid period.
 */
export function MeSubscriptions() {
  usePageTitle('Subscriptions');
  const [subs, setSubs] = useState<MySubscriptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiGet<MySubscriptions>('/api/me/subscriptions')
      .then((data) => {
        if (!cancelled) setSubs(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your subscriptions.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!subs) return <Loading label="Loading your subscriptions" />;

  const hasAny = subs.blu.length > 0 || subs.scoutAllAccess.active;

  async function manage() {
    setBusy(true);
    setNotice('');
    try {
      const { url } = await apiSend<{ url: string }>('POST', '/api/stripe/portal');
      window.location.href = url;
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.code === 'stripe_not_configured'
          ? 'Billing management is not switched on yet.'
          : err instanceof ApiError
            ? err.message
            : 'Could not open the billing portal.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="page page-narrow">
      <h1>Subscriptions</h1>
      <p className="page-intro">
        Your Sweam Blu subscriptions and scout all-access. Blu charges are final and
        non-refundable; cancelling stops the next renewal and your access runs to the end of the
        period you already paid for.
      </p>

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}

      <section aria-labelledby="subs-blu">
        <h2 id="subs-blu" className="blu-heading">
          <BluBadge height={20} decorative /> Creator subscriptions
        </h2>
        {subs.blu.length === 0 ? (
          <p>
            You have no Sweam Blu subscriptions. Blu content shows a{' '}
            <BluBadge height={14} decorative /> badge; subscribe from a creator's page to watch it.
          </p>
        ) : (
          <ul className="subs-list">
            {subs.blu.map((sub) => (
              <li key={sub.creatorId}>
                <span>
                  <Link to={`/c/${sub.handle}`}>
                    {sub.displayName} (@{sub.handle})
                  </Link>{' '}
                  — {formatUsdCents(sub.priceCents)}/month
                </span>
                {sub.currentPeriodEnd && (
                  <span className="field-hint"> renews {sub.currentPeriodEnd.slice(0, 10)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="subs-scout">
        <h2 id="subs-scout">Scout all-access</h2>
        {subs.scoutAllAccess.active ? (
          <p className="status status-ok" role="status">
            Active — {formatUsdCents(SCOUT_ALL_ACCESS_CENTS)}/month unlocks every creator's Blu
            content.
            {subs.scoutAllAccess.currentPeriodEnd
              ? ` Renews ${subs.scoutAllAccess.currentPeriodEnd.slice(0, 10)}.`
              : ''}
          </p>
        ) : (
          <p>
            Not active. Scouts can unlock all Blu content for one flat fee from the{' '}
            <Link to="/scout">scout portal</Link>.
          </p>
        )}
      </section>

      {hasAny && (
        <div className="title-actions">
          <button type="button" className="button" onClick={() => void manage()} disabled={busy}>
            {busy ? 'Opening…' : 'Manage or cancel in Stripe'}
          </button>
        </div>
      )}
    </div>
  );
}
