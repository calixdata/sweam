import { Link } from 'react-router-dom';
import type { Genre, TitleSummary } from '@sweam/shared';
import { CONTENT_KIND_LABELS } from '@sweam/shared';
import { BluBadge } from './BluBadge';

/**
 * Deterministic hue per genre for poster placeholders: enough variety that a
 * rail reads as a shelf of distinct works, muted enough to sit behind text.
 */
const GENRE_HUES: Partial<Record<Genre, number>> = {
  Action: 20,
  Adventure: 30,
  Animation: 210,
  Anime: 260,
  Comedy: 45,
  Crime: 5,
  Documentary: 160,
  Drama: 280,
  Fantasy: 265,
  Horror: 350,
  Music: 315,
  Musical: 300,
  Mystery: 240,
  Romance: 330,
  'Sci-Fi': 190,
  Sport: 130,
  Superhero: 225,
  Thriller: 355,
  War: 15,
  Western: 35,
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
  }, ${title.genre}, by ${title.creator.displayName}${title.isBlu ? ', Sweam Blu paid content' : ''}`;
  const hue = GENRE_HUES[title.genre] ?? 210;

  const noPoster = !title.posterUrl;
  return (
    <article className="title-card">
      <Link to={`/t/${title.slug}`} aria-label={label}>
        <div
          className="poster"
          style={
            noPoster
              ? { background: `linear-gradient(160deg, hsl(${hue} 42% 26%), hsl(${hue} 48% 12%))` }
              : undefined
          }
        >
          {title.posterUrl && <img src={title.posterUrl} alt="" loading="lazy" />}
          <span className="tag-new card-tag">{CONTENT_KIND_LABELS[title.kind]}</span>
          {title.isBlu && (
            <span className="blu-badge-wrap">
              <BluBadge height={22} decorative />
            </span>
          )}
          <span className="poster-title">{title.name}</span>
        </div>
        <p className="card-meta">
          {title.genre}
          {title.kind === 'series' ? ` · ${title.episodeCount} ep` : ''} · @{title.creator.handle}
        </p>
      </Link>
    </article>
  );
}
