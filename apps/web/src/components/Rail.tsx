import { useId } from 'react';
import type { TitleSummary } from '@sweam/shared';
import { TitleCard } from './TitleCard';

/** A horizontal shelf of titles with a proper heading and list semantics. */
export function Rail({ heading, titles }: { heading: string; titles: TitleSummary[] }) {
  const headingId = useId();
  if (titles.length === 0) return null;
  return (
    <section className="rail" aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
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
