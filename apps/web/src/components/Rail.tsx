import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { TitleSummary } from '@sweam/shared';
import { TitleCard } from './TitleCard';

/** A horizontal shelf of titles with a proper heading and list semantics. */
export function Rail({
  heading,
  titles,
  seeAllHref,
}: {
  heading: string;
  titles: TitleSummary[];
  seeAllHref?: string;
}) {
  const headingId = useId();
  if (titles.length === 0) return null;
  return (
    <section className="rail" aria-labelledby={headingId}>
      <div className="rail-heading-row">
        <h2 id={headingId}>{heading}</h2>
        {seeAllHref && (
          <Link className="rail-see-all" to={seeAllHref} aria-label={`See all: ${heading}`}>
            See all
          </Link>
        )}
      </div>
      <ul className="rail-track">
        {titles.map((title) => (
          <li key={title.id}>
            <TitleCard title={title} />
          </li>
        ))}
      </ul>
    </section>
  );
}
