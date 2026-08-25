import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HomePayload } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { useAuth } from '../auth';
import { Rail } from '../components/Rail';
import { ErrorNote, Loading } from '../components/Status';
import { formatDuration, usePageTitle } from '../hooks';

export function Home() {
  usePageTitle('Home');
  const { user, loading: authLoading } = useAuth();
  const [payload, setPayload] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for the session check so Continue Watching is included on first load.
    if (authLoading) return;
    let cancelled = false;
    apiGet<HomePayload>('/api/catalog/home')
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the catalog.');
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id]);

  if (error) return <ErrorNote message={error} />;
  if (!payload) return <Loading label="Loading the catalog" />;

  return (
    <div className="page">
      <h1 className="visually-hidden">Sweam home</h1>
      {payload.continueWatching.length > 0 && (
        <section className="rail" aria-labelledby="continue-heading">
          <h2 id="continue-heading">Continue watching</h2>
          <ul className="rail-track">
            {payload.continueWatching.map((item) => (
              <li key={item.episodeId}>
                <article className="title-card">
                  <Link
                    to={`/watch/${item.episodeId}`}
                    aria-label={`Resume ${item.title.name}, ${item.episodeName}, at ${formatDuration(item.positionS)} of ${formatDuration(item.durationS)}`}
                  >
                    <div className="poster poster-text" aria-hidden="true">
                      <span>{item.title.name}</span>
                    </div>
                    <h3>{item.title.name}</h3>
                    <p className="card-meta">
                      Resume at {formatDuration(item.positionS)} / {formatDuration(item.durationS)}
                    </p>
                  </Link>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}
      {payload.rails.map((rail) => (
        <Rail
          key={rail.key}
          heading={rail.heading}
          titles={rail.titles}
          seeAllHref={
            rail.key.startsWith('genre-')
              ? `/browse?genre=${encodeURIComponent(rail.heading)}`
              : rail.key === 'new'
                ? '/browse'
                : undefined
          }
        />
      ))}
    </div>
  );
}
