import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BluConnectStatus, EarningsSummary } from '@sweam/shared';
import { formatMillicents } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { ErrorNote, Loading } from '../components/Status';
import { BluBadge } from '../components/BluBadge';
import { usePageTitle } from '../hooks';

export function StudioEarnings() {
  usePageTitle('Earnings');
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    try {
      setEarnings(await apiGet<EarningsSummary>('/api/studio/earnings'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load earnings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!earnings) return <Loading label="Loading earnings" />;

  const canRequest =
    earnings.availableMillicents >= earnings.minPayoutMillicents &&
    !earnings.payouts.some((payout) => payout.status === 'pending');

  async function requestPayout() {
    setNotice('');
    setRequesting(true);
    try {
      const result = await apiSend<{ amountMillicents: number }>('POST', '/api/studio/payouts');
      setNotice(`Payout of ${formatMillicents(result.amountMillicents)} requested. An admin will review it.`);
      await load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Payout request failed.');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="page page-narrow">
      <p>
        <Link to="/studio">Back to Studio</Link>
      </p>
      <h1>Earnings</h1>
      <p className="page-intro">
        Sweam is free to watch and ad-supported. Creators keep {earnings.creatorSharePercent}% of
        the ad revenue earned on their titles; the split is part of the platform, not a private
        deal.
      </p>

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}

      <BluPayoutsSection />

      <section aria-labelledby="earnings-eligibility">
        <h2 id="earnings-eligibility">Monetization eligibility</h2>
        {earnings.eligibility.eligible ? (
          <p className="status" role="status">
            You are monetizing: your {earnings.creatorSharePercent}% share accrues on every ad
            served against your titles.
          </p>
        ) : (
          <p className="status" role="status">
            Not monetizing yet. Ads may run on your titles, but your share starts accruing the
            moment every threshold below is met. The full policy is in the public Creator Program
            document.
          </p>
        )}
        <ul>
          <li>
            Followers: {earnings.eligibility.followers.actual.toLocaleString()} of{' '}
            {earnings.eligibility.followers.required.toLocaleString()} required —{' '}
            {earnings.eligibility.followers.met ? 'met' : 'not yet'}
          </li>
          <li>
            Watch time: {Math.round(earnings.eligibility.watchSeconds.actual / 60).toLocaleString()}{' '}
            of {Math.round(earnings.eligibility.watchSeconds.required / 60).toLocaleString()} minutes
            required — {earnings.eligibility.watchSeconds.met ? 'met' : 'not yet'}
          </li>
          <li>
            Published titles: {earnings.eligibility.publishedTitles.actual.toLocaleString()} of{' '}
            {earnings.eligibility.publishedTitles.required.toLocaleString()} required —{' '}
            {earnings.eligibility.publishedTitles.met ? 'met' : 'not yet'}
          </li>
          <li>
            Account standing:{' '}
            {earnings.eligibility.goodStanding ? 'good' : 'suspended (monetization paused)'}
          </li>
        </ul>
      </section>

      <section aria-labelledby="earnings-summary">
        <h2 id="earnings-summary">Balance</h2>
        <div className="table-scroll">
          <table className="studio-table">
            <caption className="visually-hidden">Earnings balance summary</caption>
            <tbody>
              <tr>
                <th scope="row">Available</th>
                <td>{formatMillicents(earnings.availableMillicents)}</td>
              </tr>
              <tr>
                <th scope="row">Pending payout</th>
                <td>{formatMillicents(earnings.pendingMillicents)}</td>
              </tr>
              <tr>
                <th scope="row">Paid out</th>
                <td>{formatMillicents(earnings.paidMillicents)}</td>
              </tr>
              <tr>
                <th scope="row">Lifetime earned</th>
                <td>{formatMillicents(earnings.lifetimeMillicents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="title-actions">
          <button type="button" className="button" disabled={!canRequest || requesting} onClick={requestPayout}>
            {requesting ? 'Requesting…' : `Request payout of ${formatMillicents(earnings.availableMillicents)}`}
          </button>
        </div>
        {!canRequest && (
          <p className="field-hint">
            Payouts unlock at {formatMillicents(earnings.minPayoutMillicents)} of available
            earnings, one open request at a time.
          </p>
        )}
      </section>

      <section aria-labelledby="earnings-per-title">
        <h2 id="earnings-per-title">By title</h2>
        {earnings.perTitle.length === 0 ? (
          <p>No ad impressions on your titles yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">Earnings per title</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Ad impressions</th>
                  <th scope="col">Earned</th>
                </tr>
              </thead>
              <tbody>
                {earnings.perTitle.map((row) => (
                  <tr key={row.titleName}>
                    <th scope="row">{row.titleName}</th>
                    <td>{row.impressions.toLocaleString()}</td>
                    <td>{formatMillicents(row.creatorMillicents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="earnings-daily">
        <h2 id="earnings-daily">Last 14 days</h2>
        {earnings.daily.length === 0 ? (
          <p>No recent activity.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">Daily earnings, oldest first</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Ad impressions</th>
                  <th scope="col">Earned</th>
                </tr>
              </thead>
              <tbody>
                {earnings.daily.map((row) => (
                  <tr key={row.day}>
                    <th scope="row">{row.day}</th>
                    <td>{row.impressions.toLocaleString()}</td>
                    <td>{formatMillicents(row.creatorMillicents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="earnings-payouts">
        <h2 id="earnings-payouts">Payout history</h2>
        {earnings.payouts.length === 0 ? (
          <p>No payout requests yet.</p>
        ) : (
          <ul>
            {earnings.payouts.map((payout) => (
              <li key={payout.id}>
                {formatMillicents(payout.amountMillicents)} · {payout.status} · requested{' '}
                {payout.requestedAt.slice(0, 10)}
                {payout.decidedAt ? `, decided ${payout.decidedAt.slice(0, 10)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Sweam Blu payouts run on Stripe Connect, separate from the ad-revenue balance
 * above: subscription money and scout royalties are paid straight to the
 * creator's connected account. A creator must finish Connect onboarding before
 * their Blu content is purchasable.
 */
function BluPayoutsSection() {
  const [status, setStatus] = useState<BluConnectStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiGet<BluConnectStatus>('/api/stripe/connect')
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus({ connected: false, payoutsEnabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect() {
    setBusy(true);
    setNotice('');
    try {
      const { url } = await apiSend<{ url: string }>('POST', '/api/stripe/connect');
      window.location.href = url;
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.code === 'stripe_not_configured'
          ? 'Sweam Blu payments are not switched on yet. You can still mark content Blu; set up payouts here once billing is live.'
          : err instanceof ApiError
            ? err.message
            : 'Could not start payout setup.',
      );
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="blu-payouts">
      <h2 id="blu-payouts" className="blu-heading">
        <BluBadge height={20} decorative /> Sweam Blu payouts
      </h2>
      {status?.payoutsEnabled ? (
        <p className="status status-ok" role="status">
          Payouts enabled. Blu subscriptions and scout royalties are paid to your connected Stripe
          account.
        </p>
      ) : (
        <>
          <p className="page-intro">
            Blu subscribers pay monthly and you keep 80%. Connect a Stripe account to receive those
            payouts; until you do, your Blu content is marked but not purchasable.
          </p>
          <div className="title-actions">
            <button type="button" className="button" onClick={() => void connect()} disabled={busy}>
              {busy
                ? 'Starting…'
                : status?.connected
                  ? 'Finish connecting payouts'
                  : 'Connect payouts'}
            </button>
          </div>
        </>
      )}
      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
