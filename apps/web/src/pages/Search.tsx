import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AccountSearchResult, SearchResults } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { Avatar } from '../components/Avatar';
import { TitleCard } from '../components/TitleCard';
import { ErrorNote, Loading } from '../components/Status';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { usePageTitle } from '../hooks';

/**
 * Search: accounts first (a username or name finds the account itself, creator
 * or not), then titles. "@scionsaga" and "scionsaga" both find the account.
 */
export function Search() {
  usePageTitle('Search');
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [input, setInput] = useState(query);
  const [results, setResults] = useState<SearchResults | null>(null);
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
    apiGet<SearchResults>(`/api/catalog/search?q=${encodeURIComponent(query)}`)
      .then((data) => {
        if (!cancelled) {
          // Older API shape (no accounts) stays renderable.
          setResults({ ...data, accounts: data.accounts ?? [] });
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

  const accountCount = results?.accounts.length ?? 0;
  const titleCount = results?.results.length ?? 0;
  const summary =
    accountCount === 0 && titleCount === 0
      ? `No results for “${query}”.`
      : `${accountCount} account${accountCount === 1 ? '' : 's'} and ${titleCount} title${
          titleCount === 1 ? '' : 's'
        } for “${query}”.`;

  return (
    <div className="page page-narrow">
      <h1>Search</h1>
      <form role="search" onSubmit={handleSubmit} className="search-form">
        <label htmlFor="search-input">Search accounts, titles, and creators</label>
        <div className="search-row">
          <input
            id="search-input"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            placeholder="@username, name, or title"
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
          <p role="status">{summary}</p>

          {accountCount > 0 && (
            <section aria-labelledby="search-accounts">
              <h2 id="search-accounts">Accounts</h2>
              <ul className="account-list">
                {results.accounts.map((account) => (
                  <li key={account.username}>
                    <AccountRow account={account} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {titleCount > 0 && (
            <section aria-labelledby="search-titles">
              <h2 id="search-titles">Titles</h2>
              <ul className="card-grid">
                {results.results.map((title) => (
                  <li key={title.id}>
                    <TitleCard title={title} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AccountRow({ account }: { account: AccountSearchResult }) {
  const followers = `${account.followerCount.toLocaleString()} follower${
    account.followerCount === 1 ? '' : 's'
  }`;
  const titles = account.isCreator
    ? ` · ${account.publishedTitles.toLocaleString()} published title${
        account.publishedTitles === 1 ? '' : 's'
      }`
    : '';
  return (
    <Link to={`/c/${encodeURIComponent(account.username)}`} className="account-row">
      <Avatar src={account.avatarUrl} name={account.displayName} size={44} />
      <span className="account-row-text">
        <span className="account-row-name">
          {account.displayName}
          {account.verified && <VerifiedBadge />}
        </span>
        <span className="account-row-meta">
          @{account.username} · {followers}
          {titles}
        </span>
      </span>
    </Link>
  );
}
