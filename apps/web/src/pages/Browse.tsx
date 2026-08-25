import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { TitleSummary } from '@sweam/shared';
import { CONTENT_KINDS, CONTENT_KIND_LABELS, GENRES } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { TitleCard } from '../components/TitleCard';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

/** Filter chips as real links: the URL is the state, so filters are shareable. */
function chipHref(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  const query = next.toString();
  return query ? `/browse?${query}` : '/browse';
}

export function Browse() {
  usePageTitle('Browse');
  const [params] = useSearchParams();
  const genre = params.get('genre') ?? '';
  const kind = params.get('kind') ?? '';
  const sort = params.get('sort') ?? 'new';
  const [titles, setTitles] = useState<TitleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTitles(null);
    const query = new URLSearchParams();
    if (genre) query.set('genre', genre);
    if (kind) query.set('kind', kind);
    if (sort !== 'new') query.set('sort', sort);
    apiGet<{ titles: TitleSummary[] }>(`/api/catalog/browse?${query.toString()}`)
      .then((data) => {
        if (!cancelled) setTitles(data.titles);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the catalog.');
      });
    return () => {
      cancelled = true;
    };
  }, [genre, kind, sort]);

  if (error) return <ErrorNote message={error} />;

  return (
    <div className="page">
      <h1>Browse</h1>

      <nav aria-label="Genre filter">
        <ul className="filter-row">
          <li>
            <Link to={chipHref(params, 'genre', '')} aria-current={genre === '' ? 'true' : undefined}>
              All genres
            </Link>
          </li>
          {GENRES.map((value) => (
            <li key={value}>
              <Link
                to={chipHref(params, 'genre', value)}
                aria-current={genre === value ? 'true' : undefined}
              >
                {value}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Kind filter">
        <ul className="filter-row">
          <li>
            <Link to={chipHref(params, 'kind', '')} aria-current={kind === '' ? 'true' : undefined}>
              All kinds
            </Link>
          </li>
          {CONTENT_KINDS.map((value) => (
            <li key={value}>
              <Link
                to={chipHref(params, 'kind', value)}
                aria-current={kind === value ? 'true' : undefined}
              >
                {CONTENT_KIND_LABELS[value]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Sort order">
        <ul className="filter-row">
          <li>
            <Link to={chipHref(params, 'sort', '')} aria-current={sort === 'new' ? 'true' : undefined}>
              Newest
            </Link>
          </li>
          <li>
            <Link
              to={chipHref(params, 'sort', 'popular')}
              aria-current={sort === 'popular' ? 'true' : undefined}
            >
              Most played
            </Link>
          </li>
        </ul>
      </nav>

      {!titles ? (
        <Loading label="Loading titles" />
      ) : titles.length === 0 ? (
        <p role="status">No titles match those filters yet.</p>
      ) : (
        <>
          <p role="status" className="visually-hidden">
            {titles.length} titles shown.
          </p>
          <ul className="card-grid">
            {titles.map((title) => (
              <li key={title.id}>
                <TitleCard title={title} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
