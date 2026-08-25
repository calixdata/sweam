import { Link } from 'react-router-dom';
import type { TitleSummary } from '@sweam/shared';
import { CONTENT_KIND_LABELS } from '@sweam/shared';

/**
 * A catalog card. Text-first by design: the name, kind, genre, and creator are
 * real text (not baked into artwork), so cards read identically well in a
 * screen reader, a search index, and a dark room.
 */
export function TitleCard({ title }: { title: TitleSummary }) {
  const label = `${title.name}, ${CONTENT_KIND_LABELS[title.kind]}${
    title.kind === 'series' ? `, ${title.episodeCount} episodes` : ''
  }, ${title.genre}, by ${title.creator.displayName}`;

  return (
    <article className="title-card">
      <Link to={`/t/${title.slug}`} aria-label={label}>
        {title.posterUrl ? (
          <img className="poster" src={title.posterUrl} alt="" loading="lazy" />
        ) : (
          <div className="poster poster-text" aria-hidden="true">
            <span>{title.name}</span>
          </div>
        )}
        <h3>{title.name}</h3>
        <p className="card-meta">
          {CONTENT_KIND_LABELS[title.kind]}
          {title.kind === 'series' ? ` · ${title.episodeCount} ep` : ''} · {title.genre} · @
          {title.creator.handle}
        </p>
      </Link>
    </article>
  );
}
