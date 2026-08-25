import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TitleSummary } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { TitleCard } from '../components/TitleCard';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function Watchlist() {
  usePageTitle('My list');
  const [titles, setTitles] = useState<TitleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ titles: TitleSummary[] }>('/api/me/watchlist')
      .then((data) => {
        if (!cancelled) setTitles(data.titles);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your list.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!titles) return <Loading label="Loading your list" />;

  return (
    <div className="page page-narrow">
      <h1>My list</h1>
      {titles.length === 0 ? (
        <p>
          Nothing saved yet. Find something in <Link to="/discover">Discover</Link> and add it to
          your list from its title page.
        </p>
      ) : (
        <ul className="card-grid">
          {titles.map((title) => (
            <li key={title.id}>
              <TitleCard title={title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
