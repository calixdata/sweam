import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HomePayload } from '@sweam/shared';
import { CONTENT_KIND_LABELS } from '@sweam/shared';
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

  const spotlight = payload.rails.find((rail) => rail.key === 'spotlight');
  const feature = spotlight?.titles[0] ?? payload.rails[0]?.titles[0] ?? null;

  return (
    <>
      <section className="hero" aria-labelledby="hero-heading">
        <img className="hero-image" src={feature?.heroUrl ?? '/img/hero.webp'} alt="" />
        <div className="hero-copy">
          <p className="eyebrow">{feature ? 'Featured on Sweam' : 'Sweam'}</p>
          {feature ? (
            <>
              <h1 id="hero-heading">{feature.name}</h1>
              <div className="hero-meta">
                <span>{CONTENT_KIND_LABELS[feature.kind]}</span>
                {feature.audiences[0] && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{feature.audiences[0]}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>{feature.genre}</span>
                <span aria-hidden="true">·</span>
                <span>{feature.advisory}</span>
                <span aria-hidden="true">·</span>
                <span>@{feature.creator.handle}</span>
              </div>
              <p>{feature.synopsis}</p>
              <div className="title-actions">
                <Link className="button" to={`/t/${feature.slug}`}>
                  Watch now
                </Link>
                <Link className="button button-quiet" to={user ? '/browse' : '/signup'}>
                  {user ? 'Browse all' : 'Join free'}
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 id="hero-heading">Free streaming for independent creators</h1>
              <p>
                Films, series, and documentaries judged on whether viewers finish them, not on
                follower counts. Free with an account.
              </p>
              <div className="title-actions">
                <Link className="button" to="/browse">
                  Start watching
                </Link>
                <Link className="button button-quiet" to="/submit">
                  Submit your work
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="wrap">
        {payload.continueWatching.length > 0 && (
          <section className="rail" aria-labelledby="continue-heading">
            <div className="rail-heading-row">
              <h2 id="continue-heading">Continue watching</h2>
            </div>
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
                      <p className="card-meta">
                        Resume {formatDuration(item.positionS)} / {formatDuration(item.durationS)}
                      </p>
                      <div className="card-progress">
                        <span
                          style={{
                            width: `${Math.min(100, Math.round((item.positionS / item.durationS) * 100))}%`,
                          }}
                        />
                      </div>
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
    </>
  );
}
