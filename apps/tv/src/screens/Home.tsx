import { useCallback, useEffect, useRef, useState } from 'react';
import type { TitleSummary, TvFeed } from '@sweam/shared';
import type { TvUser } from '../App';
import { ApiError, getFeed } from '../api';
import { focusFirst } from '../focus';

interface HomeScreenProps {
  user: TvUser | null;
  announce: (message: string) => void;
  onOpenTitle: (slug: string) => void;
  onOpenDevices: () => void;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function metaLine(title: TitleSummary): string {
  return [capitalize(title.kind), title.audiences[0], title.genre, title.advisory, `@${title.creator.handle}`]
    .filter(Boolean)
    .join(' · ');
}

/** The channel home: featured hero plus rails of AI originals. */
export function HomeScreen({ user, announce, onOpenTitle, onOpenDevices }: HomeScreenProps) {
  const [feed, setFeed] = useState<TvFeed | null>(null);
  const [error, setError] = useState('');
  const heroRef = useRef<HTMLButtonElement | null>(null);
  const focusedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      setFeed(await getFeed());
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the channel.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!feed || focusedOnce.current) return;
    focusedOnce.current = true;
    if (heroRef.current) heroRef.current.focus();
    else focusFirst();
    announce(`SweamTV home. ${feed.rows.length} ${feed.rows.length === 1 ? 'row' : 'rows'} of AI originals.`);
  }, [feed, announce]);

  const hero = feed?.rows.find((row) => row.key === 'featured')?.titles[0] ?? null;
  const rails = (feed?.rows ?? [])
    .map((row) => (row.key === 'featured' ? { ...row, titles: row.titles.slice(1) } : row))
    .filter((row) => row.titles.length > 0);

  return (
    <main className="tv-root">
      <header className="tv-topbar">
        <img className="brand" src="brand/sweamtv-wordmark-reverse.svg" alt="SweamTV" />
        <span className="sr-only">The channel for AI-generated series and films.</span>
        {user && (
          <span className="who">
            Watching as {user.username ? `@${user.username}` : user.displayName}
          </span>
        )}
        <button type="button" data-tv-focus className="tv-button" onClick={onOpenDevices}>
          Settings
        </button>
      </header>

      {!feed && !error && (
        <p className="status-line" role="status">
          Loading the channel…
        </p>
      )}
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}

      {hero && (
        <section className="hero" aria-label={`Featured: ${hero.name}`}>
          {(hero.heroUrl ?? hero.posterUrl) && (
            <img className="hero-art" src={hero.heroUrl ?? hero.posterUrl ?? undefined} alt="" />
          )}
          <div className="hero-body">
            <h1>{hero.name}</h1>
            <p className="hero-meta">{metaLine(hero)}</p>
            <div className="button-row">
              <button
                ref={heroRef}
                type="button"
                data-tv-focus
                className="tv-button primary"
                onClick={() => onOpenTitle(hero.slug)}
              >
                Open {hero.name}
              </button>
            </div>
          </div>
        </section>
      )}

      {rails.map((row) => (
        <section key={row.key} className="rail" aria-label={row.name}>
          <h2>{row.name}</h2>
          <div className="rail-track">
            {row.titles.map((title) => (
              <button
                key={`${row.key}:${title.id}`}
                type="button"
                data-tv-focus
                className="card"
                onClick={() => onOpenTitle(title.slug)}
                aria-label={`${title.name}. ${capitalize(title.kind)}, ${title.genre}.${
                  title.releasedEpisodeCount > 0
                    ? ` ${title.releasedEpisodeCount} ${title.releasedEpisodeCount === 1 ? 'episode' : 'episodes'} available.`
                    : ''
                }${title.nextReleaseAt ? ' Coming soon.' : ''}`}
              >
                {title.posterUrl ? (
                  <img className="poster" src={title.posterUrl} alt="" loading="lazy" />
                ) : (
                  <span className="poster-fallback" aria-hidden="true">
                    {title.name}
                  </span>
                )}
                <span className="card-name" aria-hidden="true">
                  {title.name}
                </span>
                <span className="card-meta" aria-hidden="true">
                  {capitalize(title.kind)} · {title.genre}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {feed && feed.rows.length === 0 && (
        <p className="status-line">The channel is being programmed. Check back soon.</p>
      )}
    </main>
  );
}
