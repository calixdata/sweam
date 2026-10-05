import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CreatorPublicPage } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components/Avatar';
import { TitleCard } from '../components/TitleCard';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function CreatorPage() {
  const { handle } = useParams<{ handle: string }>();
  const { user } = useAuth();
  const [creator, setCreator] = useState<CreatorPublicPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePageTitle(creator ? `@${creator.handle}` : 'Profile');

  const load = useCallback(async () => {
    if (!handle) return;
    try {
      setCreator(await apiGet<CreatorPublicPage>(`/api/creators/${encodeURIComponent(handle)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this profile.');
    }
  }, [handle]);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  if (error) return <ErrorNote message={error} />;
  if (!creator) return <Loading label="Loading profile" />;

  // Every account has a profile at its username; a creator's handle equals it.
  const isSelf = (user?.username ?? user?.handle)?.toLowerCase() === creator.handle.toLowerCase();

  // Separate everyday uploads (clips/shorts) from longer-form shows and films.
  const clips = creator.titles.filter((title) => title.kind === 'short');
  const shows = creator.titles.filter((title) => title.kind !== 'short');

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
      <div className="creator-head">
        <Avatar src={creator.avatarUrl} name={creator.displayName} size={64} />
        <div>
          <h1>
            {creator.displayName} (@{creator.handle})
            {creator.verified && <span className="tag-new"> Verified</span>}
          </h1>
          <p className="title-meta">
            {creator.followerCount.toLocaleString()} follower
            {creator.followerCount === 1 ? '' : 's'} · {creator.titles.length} published title
            {creator.titles.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
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

      {creator.titles.length === 0 ? (
        <section aria-labelledby="creator-titles-heading">
          <h2 id="creator-titles-heading">Titles</h2>
          <p>{creator.isCreator ? 'Nothing published yet.' : 'No posts yet.'}</p>
        </section>
      ) : (
        <>
          {shows.length > 0 && (
            <section aria-labelledby="creator-shows-heading">
              <h2 id="creator-shows-heading">Shows &amp; films</h2>
              <ul className="card-grid">
                {shows.map((title) => (
                  <li key={title.id}>
                    <TitleCard title={title} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {clips.length > 0 && (
            <section aria-labelledby="creator-clips-heading">
              <h2 id="creator-clips-heading">Clips</h2>
              <ul className="card-grid">
                {clips.map((title) => (
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
