import { Link } from 'react-router-dom';
import type { Genre, TitleSummary } from '@sweam/shared';
import { CONTENT_KIND_LABELS } from '@sweam/shared';

/**
 * Deterministic hue per genre for poster placeholders: enough variety that a
 * rail reads as a shelf of distinct works, muted enough to sit behind text.
 */
const GENRE_HUES: Record<Genre, number> = {
  Animation: 210,
  Comedy: 45,
  Drama: 280,
  Documentary: 160,
  'Sci-Fi': 190,
  Horror: 350,
  Action: 20,
  Music: 315,
};

/**
 * A catalog card. Text-first by design: the name, kind, genre, and creator are
 * real text below the artwork, so cards read identically well in a screen
 * reader, a search index, and a dark room. Titles without posters get a quiet
 * genre-tinted monogram instead of repeating their name in the artwork box.
 */
export function TitleCard({ title }: { title: TitleSummary }) {
  const label = `${title.name}, ${CONTENT_KIND_LABELS[title.kind]}${
    title.kind === 'series' ? `, ${title.episodeCount} episodes` : ''
  }, ${title.genre}, by ${title.creator.displayName}`;
  const hue = GENRE_HUES[title.genre] ?? 210;

  return (
    <article className="title-card">
      <Link to={`/t/${title.slug}`} aria-label={label}>
        {title.posterUrl ? (
          <img className="poster" src={title.posterUrl} alt="" loading="lazy" />
        ) : (
          <div
            className="poster poster-monogram"
            aria-hidden="true"
            style={{
              background: `linear-gradient(160deg, hsl(${hue} 42% 26%), hsl(${hue} 48% 12%))`,
            }}
          >
            <span>{title.name.charAt(0)}</span>
          </div>
        )}
        <h3>{title.name}</h3>
        <p className="card-meta">
          {CONTENT_KIND_LABELS[title.kind]}
          {title.kind === 'series' ? ` · ${title.episodeCount} ep` : ''} · {title.genre}
        </p>
        <p className="card-meta">@{title.creator.handle}</p>
      </Link>
    </article>
  );
}
