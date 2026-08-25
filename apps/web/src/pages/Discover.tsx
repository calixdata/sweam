import { useEffect, useState } from 'react';
import type { DiscoverItem } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { TitleCard } from '../components/TitleCard';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function Discover() {
  usePageTitle('Discover');
  const [items, setItems] = useState<DiscoverItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ items: DiscoverItem[] }>('/api/discover')
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load Discover.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page page-narrow">
      <h1>Discover</h1>
      <p className="page-intro">
        Every published title, ranked in the open. Each entry says why it placed where it did.
      </p>
      <details className="explainer">
        <summary>How this ranking works</summary>
        <p>
          Three signals, weighted and published: <strong>quality</strong> (55%) is how often
          viewers who start a title actually finish it, smoothed so tiny samples cannot game it;
          <strong> exploration</strong> (30%) is a bonus that guarantees low-exposure titles get
          seen and fades as they accumulate impressions; <strong>freshness</strong> (15%) gives new
          releases a short window. Follower counts and past reach are not inputs. The scoring code
          and its tests are public in the Sweam repository.
        </p>
      </details>
      {error && <ErrorNote message={error} />}
      {!items && !error && <Loading label="Ranking the catalog" />}
      {items && (
        <ol className="discover-list">
          {items.map((item, index) => (
            <li key={item.title.id}>
              <div className="discover-rank" aria-hidden="true">
                {index + 1}
              </div>
              <TitleCard title={item.title} />
              <div className="discover-why">
                <p className="discover-reason">{item.reason}</p>
                <p className="discover-stats">
                  {item.stats.plays.toLocaleString()} plays · {Math.round(item.stats.finishRate * 100)}%
                  finish it
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
