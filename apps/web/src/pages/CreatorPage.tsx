import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CreatorPublicPage } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { TitleCard } from '../components/TitleCard';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function CreatorPage() {
  const { handle } = useParams<{ handle: string }>();
  const { user } = useAuth();
  const [creator, setCreator] = useState<CreatorPublicPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePageTitle(creator ? `@${creator.handle}` : 'Creator');

  const load = useCallback(async () => {
    if (!handle) return;
    try {
      setCreator(await apiGet<CreatorPublicPage>(`/api/creators/${encodeURIComponent(handle)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this creator.');
    }
  }, [handle]);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  if (error) return <ErrorNote message={error} />;
  if (!creator) return <Loading label="Loading creator" />;

  const isSelf = user?.handle === creator.handle;

  async function toggleFollow() {
    if (!creator) return;
    setBusy(true);
    try {
      const method = creator.followedByMe ? 'DELETE' : 'PUT';
      await apiSend(method, `/api/creators/${encodeURIComponent(creator.handle)}/follow`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-narrow">
      <h1>
        {creator.displayName} (@{creator.handle})
        {creator.verified && <span className="tag-new"> Verified</span>}
      </h1>
      <p className="title-meta">
        {creator.followerCount.toLocaleString()} follower{creator.followerCount === 1 ? '' : 's'} ·{' '}
        {creator.titles.length} published title{creator.titles.length === 1 ? '' : 's'}
      </p>
      {creator.bio && <p className="title-synopsis">{creator.bio}</p>}

      {!isSelf && (
        <div className="title-actions">
          {user ? (
            <button
              type="button"
              className={creator.followedByMe ? 'button button-quiet' : 'button'}
              aria-pressed={creator.followedByMe}
              disabled={busy}
              onClick={toggleFollow}
            >
              {creator.followedByMe ? 'Following ✓' : 'Follow'}
            </button>
          ) : (
            <p>
              <Link to="/signin" state={{ from: `/c/${creator.handle}` }}>
                Sign in
              </Link>{' '}
              to follow {creator.displayName} and get notified about new releases.
            </p>
          )}
        </div>
      )}

      <section aria-labelledby="creator-titles-heading">
        <h2 id="creator-titles-heading">Titles</h2>
        {creator.titles.length === 0 ? (
          <p>Nothing published yet.</p>
        ) : (
          <ul className="card-grid">
            {creator.titles.map((title) => (
              <li key={title.id}>
                <TitleCard title={title} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
