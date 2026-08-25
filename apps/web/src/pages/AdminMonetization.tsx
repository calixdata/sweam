import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AdminMonetization as AdminMonetizationPayload } from '@sweam/shared';
import { formatMillicents } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function AdminMonetization() {
  usePageTitle('Monetization');
  const { user, loading } = useAuth();

  if (loading) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>Monetization</h1>
        <p>This area is for Sweam administrators.</p>
      </div>
    );
  }
  return <MonetizationDashboard />;
}

function MonetizationDashboard() {
  const [data, setData] = useState<AdminMonetizationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiGet<AdminMonetizationPayload>('/api/admin/monetization'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load monetization data.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading label="Loading monetization" />;

  async function toggleAd(adId: string, active: boolean) {
    await apiSend('PATCH', `/api/admin/ads/${adId}`, { active });
    setNotice(active ? 'Ad activated.' : 'Ad deactivated.');
    await load();
  }

  async function decidePayout(payoutId: string, paid: boolean) {
    await apiSend('POST', `/api/admin/payouts/${payoutId}/decide`, { paid });
    setNotice(paid ? 'Payout marked paid.' : 'Payout rejected; the balance returns to the creator.');
    await load();
  }

  return (
    <div className="page page-narrow">
      <p>
        <Link to="/admin">Back to Admin</Link>
      </p>
      <h1>Monetization</h1>

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}

      <section aria-labelledby="mon-totals">
        <h2 id="mon-totals">Revenue</h2>
        <div className="table-scroll">
          <table className="studio-table">
            <caption className="visually-hidden">Lifetime advertising revenue</caption>
            <tbody>
              <tr>
                <th scope="row">Ad impressions</th>
                <td>{data.totals.impressions.toLocaleString()}</td>
              </tr>
              <tr>
                <th scope="row">Gross revenue</th>
                <td>{formatMillicents(data.totals.revenueMillicents)}</td>
              </tr>
              <tr>
                <th scope="row">Creator share</th>
                <td>{formatMillicents(data.totals.creatorMillicents)}</td>
              </tr>
              <tr>
                <th scope="row">Platform share</th>
                <td>{formatMillicents(data.totals.platformMillicents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="mon-payouts">
        <h2 id="mon-payouts">Pending payouts</h2>
        {data.pendingPayouts.length === 0 ? (
          <p>No payouts awaiting review.</p>
        ) : (
          <ul className="interest-list">
            {data.pendingPayouts.map((payout) => (
              <li key={payout.id}>
                <h3>
                  {formatMillicents(payout.amountMillicents)} to @{payout.creator.handle} (
                  {payout.creator.displayName})
                </h3>
                <p>Requested {payout.requestedAt.slice(0, 10)}</p>
                <div className="episode-actions">
                  <button type="button" className="button" onClick={() => decidePayout(payout.id, true)}>
                    Mark paid
                  </button>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => decidePayout(payout.id, false)}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mon-ads">
        <h2 id="mon-ads">Ad inventory</h2>
        {data.ads.length === 0 ? (
          <p>No ads yet. Create one below.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">Ad inventory with delivery counters</caption>
              <thead>
                <tr>
                  <th scope="col">Sponsor</th>
                  <th scope="col">Headline</th>
                  <th scope="col">CPM</th>
                  <th scope="col">Status</th>
                  <th scope="col">Impressions</th>
                  <th scope="col">Revenue</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.ads.map((ad) => (
                  <tr key={ad.id}>
                    <th scope="row">{ad.sponsor}</th>
                    <td>{ad.headline}</td>
                    <td>{`$${(ad.cpmCents / 100).toFixed(2)}`}</td>
                    <td>{ad.active ? 'Active' : 'Inactive'}</td>
                    <td>{ad.impressions.toLocaleString()}</td>
                    <td>{formatMillicents(ad.revenueMillicents)}</td>
                    <td>
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => toggleAd(ad.id, !ad.active)}
                      >
                        {ad.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <NewAdForm
          onCreated={async () => {
            setNotice('Ad created.');
            await load();
          }}
        />
      </section>
    </div>
  );
}

function NewAdForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [sponsor, setSponsor] = useState('');
  const [headline, setHeadline] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [clickUrl, setClickUrl] = useState('');
  const [durationS, setDurationS] = useState(10);
  const [cpmCents, setCpmCents] = useState(1200);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/admin/ads', {
        sponsor,
        headline,
        mediaUrl,
        clickUrl,
        durationS,
        cpmCents,
      });
      setSponsor('');
      setHeadline('');
      setMediaUrl('');
      setClickUrl('');
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the ad.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="studio-form">
      <h3>New ad</h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="ad-sponsor">Sponsor</label>
          <input
            id="ad-sponsor"
            type="text"
            required
            maxLength={80}
            value={sponsor}
            onChange={(event) => setSponsor(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ad-headline">Headline</label>
          <input
            id="ad-headline"
            type="text"
            required
            maxLength={140}
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ad-media">Media URL (https or /media/ path)</label>
        <input
          id="ad-media"
          type="text"
          required
          value={mediaUrl}
          onChange={(event) => setMediaUrl(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ad-click">Click destination (https or app path like /discover)</label>
        <input
          id="ad-click"
          type="text"
          required
          value={clickUrl}
          onChange={(event) => setClickUrl(event.target.value)}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="ad-duration">Duration (seconds, 3-60)</label>
          <input
            id="ad-duration"
            type="number"
            min={3}
            max={60}
            value={durationS}
            onChange={(event) => setDurationS(Number(event.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="ad-cpm">CPM (cents per 1000 impressions)</label>
          <input
            id="ad-cpm"
            type="number"
            min={1}
            max={1000000}
            value={cpmCents}
            onChange={(event) => setCpmCents(Number(event.target.value))}
          />
        </div>
      </div>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create ad'}
      </button>
    </form>
  );
}
