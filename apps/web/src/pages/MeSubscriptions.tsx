import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MySubscriptions, ScoutMembership } from '@sweam/shared';
import { SCOUT_BETA_FREE_LIMIT, formatUsdCents } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { BluBadge } from '../components/BluBadge';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

/** "January 3, 2027" from an ISO timestamp. */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Manage subscriptions: the viewer's active Sweam Blu subscriptions and, for an
 * approved scout, the Scout membership (which already includes every creator's
 * Blu content), with a link into the Stripe Billing Portal to update a card or
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

  const membership = subs.scoutMembership;
  // The Stripe portal needs a Stripe customer: a Blu subscription or a scout card on file.
  const canManageInStripe = subs.blu.length > 0 || Boolean(membership?.hasCard);

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
        Your Sweam Blu subscriptions and Scout membership. Blu charges are final and
        non-refundable; cancelling stops the next renewal and your access runs to the end of the
        period you already paid for.
      </p>

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}

      {membership && (
        <section aria-labelledby="subs-scout">
          <h2 id="subs-scout">Scout membership</h2>
          <ScoutMembershipStatus membership={membership} />
        </section>
      )}

      <section aria-labelledby="subs-blu">
        <h2 id="subs-blu" className="blu-heading">
          <BluBadge height={20} decorative /> Creator subscriptions
        </h2>
        {membership?.active && (
          <p>
            Your Scout membership includes every creator&apos;s Sweam Blu content, so you do not
            need individual creator subscriptions.
          </p>
        )}
        {subs.blu.length === 0 ? (
          !membership?.active && (
            <p>
              You have no Sweam Blu subscriptions. Blu content shows a{' '}
              <BluBadge height={14} decorative /> badge; subscribe from a creator&apos;s page to
              watch it.
            </p>
          )
        ) : (
          <ul className="subs-list">
            {subs.blu.map((sub) => (
              <li key={sub.creatorId}>
                <span>
                  <Link to={`/c/${sub.handle}`}>
                    {sub.displayName} (@{sub.handle})
                  </Link>{' '}
                  at {formatUsdCents(sub.priceCents)}/month
                </span>
                {sub.currentPeriodEnd && (
                  <span className="field-hint"> renews {formatDay(sub.currentPeriodEnd)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!membership && (
        <section aria-labelledby="subs-scout-info">
          <h2 id="subs-scout-info">Scout membership</h2>
          <p>
            For networks, studios, and aggregators: the scout portal plus all-access to every
            creator&apos;s Blu content for one monthly fee. Apply from the{' '}
            <Link to="/scout">scout portal</Link>.
          </p>
        </section>
      )}

      {canManageInStripe && (
        <div className="title-actions">
          <button type="button" className="button" onClick={() => void manage()} disabled={busy}>
            {busy ? 'Opening…' : 'Manage or cancel in Stripe'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The membership facts for an approved scout, plus the one action that fits its state. */
function ScoutMembershipStatus({ membership }: { membership: ScoutMembership }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const price = formatUsdCents(membership.priceCents);

  async function addCard() {
    setBusy(true);
    setNotice('');
    try {
      const { url } = await apiSend<{ url: string }>('POST', '/api/stripe/scout');
      window.location.href = url;
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not start checkout.');
      setBusy(false);
    }
  }

  if (!membership.active) {
    const text =
      membership.reason === 'past_due'
        ? 'Not active: your last payment failed. Update your card in Stripe to restore the scout portal and your Blu access.'
        : membership.reason === 'ended'
          ? `Not active: your free period has ended. Add a card to continue at ${price} per month.`
          : membership.reason === 'canceled'
            ? `Not active: the membership was canceled. Start it again for ${price} per month.`
            : `Not active yet. Add a card to start your membership at ${price} per month.`;
    return (
      <>
        <p className="status" role="status">
          {text}
        </p>
        {membership.reason !== 'past_due' && (
          <div className="title-actions">
            <button type="button" className="button" onClick={() => void addCard()} disabled={busy}>
              {busy ? 'Starting…' : 'Add a card'}
            </button>
          </div>
        )}
        {notice && (
          <p className="status status-error" role="alert">
            {notice}
          </p>
        )}
      </>
    );
  }

  let billing: string;
  if (membership.inFreePeriod && membership.freeUntil) {
    billing = membership.hasCard
      ? `Free until ${formatDay(membership.freeUntil)} as one of the first ${SCOUT_BETA_FREE_LIMIT} Scouts, then ${price} per month on your card on file. Cancel at least 24 business hours before then to avoid the charge.`
      : `Free until ${formatDay(membership.freeUntil)} as one of the first ${SCOUT_BETA_FREE_LIMIT} Scouts. No card is on file: add one before then to keep your access. It is not charged until the free period ends; membership is ${price} per month after that.`;
  } else if (membership.hasCard) {
    billing = membership.currentPeriodEnd
      ? `Renews ${formatDay(membership.currentPeriodEnd)} at ${price} per month. Cancel at least 24 business hours before then to avoid the next charge.`
      : `${price} per month, charged to the card on file.`;
  } else {
    billing = 'Complimentary membership.';
  }

  return (
    <>
      <p className="status status-ok" role="status">
        Active. Your Scout membership includes the scout portal and all-access to every
        creator&apos;s Sweam Blu content; there is no separate Blu fee for scouts.
      </p>
      <p>{billing}</p>
      {membership.inFreePeriod && !membership.hasCard && (
        <div className="title-actions">
          <button type="button" className="button" onClick={() => void addCard()} disabled={busy}>
            {busy ? 'Starting…' : 'Add a card'}
          </button>
        </div>
      )}
      {notice && (
        <p className="status status-error" role="alert">
          {notice}
        </p>
      )}
    </>
  );
}
