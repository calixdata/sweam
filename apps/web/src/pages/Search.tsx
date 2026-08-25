import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TitleSummary } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { TitleCard } from '../components/TitleCard';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function Search() {
  usePageTitle('Search');
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [input, setInput] = useState(query);
  const [results, setResults] = useState<TitleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setInput(query);
    if (!query) {
      setResults(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    apiGet<{ results: TitleSummary[] }>(`/api/catalog/search?q=${encodeURIComponent(query)}`)
      .then((data) => {
        if (!cancelled) {
          setResults(data.results);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Search failed.');
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();
    if (trimmed) setParams({ q: trimmed });
  }

  return (
    <div className="page page-narrow">
      <h1>Search</h1>
      <form role="search" onSubmit={handleSubmit} className="search-form">
        <label htmlFor="search-input">Search titles, creators, and synopses</label>
        <div className="search-row">
          <input
            id="search-input"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="button">
            Search
          </button>
        </div>
      </form>
      {error && <ErrorNote message={error} />}
      {searching && <Loading label="Searching" />}
      {results && !searching && (
        <>
          <p role="status">
            {results.length === 0
              ? `No results for “${query}”.`
              : `${results.length} result${results.length === 1 ? '' : 's'} for “${query}”.`}
          </p>
          <ul className="card-grid">
            {results.map((title) => (
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
