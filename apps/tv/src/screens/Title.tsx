import { useEffect, useRef, useState } from 'react';
import type { TitleDetail } from '@sweam/shared';
import { formatReleaseDate } from '@sweam/shared';
import { ApiError, getTitle } from '../api';
import { focusFirst } from '../focus';

interface TitleScreenProps {
  slug: string;
  announce: (message: string) => void;
  onPlay: (episodeId: string) => void;
  onBack: () => void;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Title page: art, synopsis, and the episode list (released and coming). */
export function TitleScreen({ slug, announce, onPlay, onBack }: TitleScreenProps) {
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [error, setError] = useState('');
  const playRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTitle(null);
    setError('');
    void (async () => {
      try {
        const data = await getTitle(slug);
        if (!cancelled) setTitle(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load this title.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!title) return;
    const released = title.episodes.filter((ep) => ep.released).length;
    if (playRef.current) playRef.current.focus();
    else focusFirst();
    announce(
      `${title.name}. ${released} ${released === 1 ? 'episode' : 'episodes'} available. Press Back for Home.`,
    );
  }, [title, announce]);

  useEffect(() => {
    if (error) focusFirst();
  }, [error]);

  if (error) {
    return (
      <main className="tv-root title-screen">
        <p className="error-line" role="alert">
          {error}
        </p>
        <button type="button" data-tv-focus className="tv-button" onClick={onBack}>
          Back
        </button>
      </main>
    );
  }

  if (!title) {
    return (
      <main className="tv-root title-screen">
        <p className="status-line" role="status">
          Loading…
        </p>
      </main>
    );
  }

  const released = title.episodes.filter((ep) => ep.released);
  const firstPlayable = released[0] ?? null;
  const meta = [
    capitalize(title.kind),
    title.audiences[0],
    title.genre,
    title.advisory,
    `@${title.creator.handle}`,
    'AI original',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className="tv-root title-screen">
      <section className="hero" aria-hidden="true">
        {(title.heroUrl ?? title.posterUrl) && (
          <img className="hero-art" src={title.heroUrl ?? title.posterUrl ?? undefined} alt="" />
        )}
        <div className="hero-body">
          <h1>{title.name}</h1>
          <p className="hero-meta">{meta}</p>
        </div>
      </section>
      <h1 className="sr-only">{title.name}</h1>
      <p className="sr-only">{meta}.</p>

      <p className="title-synopsis">{title.synopsis}</p>
      <p className="title-stats">
        {title.views.toLocaleString()} views · {title.likes.toLocaleString()} likes
      </p>

      <div className="button-row">
        {firstPlayable ? (
          <button
            ref={playRef}
            type="button"
            data-tv-focus
            className="tv-button primary"
            onClick={() => onPlay(firstPlayable.id)}
          >
            Play{' '}
            {title.episodes.length > 1
              ? `S${firstPlayable.season} E${firstPlayable.episode} — ${firstPlayable.name}`
              : title.name}
          </button>
        ) : (
          <p className="status-line">Nothing here has released yet.</p>
        )}
        <button type="button" data-tv-focus className="tv-button" onClick={onBack}>
          Back
        </button>
      </div>

      {title.episodes.length > 1 && (
        <>
          <h2 className="screen-heading" style={{ marginTop: '36px' }}>
            Episodes
          </h2>
          <ul className="episodes">
            {title.episodes.map((ep) => {
              const label = `S${ep.season} E${ep.episode}`;
              if (!ep.released) {
                return (
                  <li key={ep.id}>
                    <div className="episode-row locked">
                      <span className="ep-num" aria-hidden="true">
                        {label}
                      </span>
                      <span className="ep-name">{ep.name}</span>
                      <span className="ep-sub">
                        {ep.releaseAt ? `Releases ${formatReleaseDate(ep.releaseAt)}` : 'Coming soon'}
                      </span>
                      <span className="sr-only">
                        {label}. Not released yet.
                      </span>
                    </div>
                  </li>
                );
              }
              return (
                <li key={ep.id}>
                  <button
                    type="button"
                    data-tv-focus
                    className="episode-row"
                    onClick={() => onPlay(ep.id)}
                    aria-label={`Play ${label}, ${ep.name}.${
                      ep.durationS > 0 ? ` ${Math.max(1, Math.round(ep.durationS / 60))} minutes.` : ''
                    }`}
                  >
                    <span className="ep-num" aria-hidden="true">
                      {label}
                    </span>
                    <span className="ep-name" aria-hidden="true">
                      {ep.name}
                    </span>
                    {ep.durationS > 0 && (
                      <span className="ep-sub" aria-hidden="true">
                        {Math.max(1, Math.round(ep.durationS / 60))} min
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
