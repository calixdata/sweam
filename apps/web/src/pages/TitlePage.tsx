import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { EpisodeSummary, TitleDetail } from '@sweam/shared';
import { CONTENT_KIND_LABELS, formatReleaseDate, formatUsdCents } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { BluBadge } from '../components/BluBadge';
import { CommentsSection } from '../components/CommentsSection';
import { ReportControl } from '../components/ReportControl';
import { ErrorNote, Loading } from '../components/Status';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { formatDuration, usePageTitle } from '../hooks';

export function TitlePage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bluBusy, setBluBusy] = useState(false);
  const [bluError, setBluError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState('');

  usePageTitle(title?.name ?? 'Title');

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    apiGet<TitleDetail>(`/api/titles/${encodeURIComponent(slug)}`)
      .then((data) => {
        if (!cancelled) setTitle(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this title.');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, user?.id]);

  const seasons = useMemo(() => {
    if (!title) return [];
    const grouped = new Map<number, EpisodeSummary[]>();
    for (const episode of title.episodes) {
      const list = grouped.get(episode.season) ?? [];
      list.push(episode);
      grouped.set(episode.season, list);
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b);
  }, [title]);

  if (error) return <ErrorNote message={error} />;
  if (!title) return <Loading label="Loading title" />;

  // Play starts the first episode viewers can actually stream; a title whose
  // episodes are all still scheduled shows its release date instead.
  const firstEpisode = title.episodes.find((ep) => ep.released) ?? null;
  const firstUpcoming = title.episodes.find((ep) => !ep.released) ?? null;
  const isSeries = title.kind === 'series';

  function requireSignIn(): boolean {
    if (user) return false;
    navigate('/signin', { state: { from: `/t/${title?.slug ?? ''}` } });
    return true;
  }

  async function subscribeBlu() {
    if (!title || requireSignIn()) return;
    setBluBusy(true);
    setBluError(null);
    try {
      const { url } = await apiSend<{ url: string }>('POST', `/api/stripe/blu/${title.creator.handle}`);
      window.location.href = url;
    } catch (err) {
      setBluError(err instanceof ApiError ? err.message : 'Could not start checkout.');
      setBluBusy(false);
    }
  }

  async function toggleWatchlist() {
    if (!title || requireSignIn()) return;
    setBusy(true);
    try {
      const method = title.inMyWatchlist ? 'DELETE' : 'PUT';
      const data = await apiSend<{ inMyWatchlist: boolean }>(method, `/api/me/watchlist/${title.id}`);
      setTitle({ ...title, inMyWatchlist: data.inMyWatchlist });
    } finally {
      setBusy(false);
    }
  }

  async function shareTitle() {
    if (!title) return;
    const url = `${window.location.origin}/t/${title.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: title.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareNote('Link copied to your clipboard.');
      }
    } catch {
      // Share sheet dismissed, or clipboard blocked; nothing to do.
    }
  }

  async function toggleReminder(episode: EpisodeSummary) {
    if (!title || requireSignIn()) return;
    setBusy(true);
    try {
      const method = episode.reminderSet ? 'DELETE' : 'PUT';
      const data = await apiSend<{ reminderSet: boolean }>(method, `/api/me/release-reminders/${episode.id}`);
      setTitle({
        ...title,
        episodes: title.episodes.map((ep) =>
          ep.id === episode.id ? { ...ep, reminderSet: data.reminderSet } : ep,
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike() {
    if (!title || requireSignIn()) return;
    setBusy(true);
    try {
      const method = title.likedByMe ? 'DELETE' : 'PUT';
      const data = await apiSend<{ likedByMe: boolean }>(method, `/api/me/likes/${title.id}`);
      setTitle({
        ...title,
        likedByMe: data.likedByMe,
        likes: title.likes + (data.likedByMe ? 1 : -1),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-narrow">
      <header className="title-header">
        <h1>
          {title.name}
          {title.isBlu && (
            <>
              {' '}
              <BluBadge height={24} />
            </>
          )}
        </h1>
        <p className="title-meta">
          {CONTENT_KIND_LABELS[title.kind]}
          {title.genre ? ` · ${title.genre}` : ''} · {title.advisory} · by{' '}
          <Link to={`/c/${title.creator.handle}`}>
            {title.creator.displayName} (@{title.creator.handle})
          </Link>
          {title.creator.verified && <VerifiedBadge />}
        </p>
        {title.promotedBy && <p className="promoted-notice">Promoted by {title.promotedBy}</p>}
        <p className="title-synopsis">{title.synopsis}</p>
        {(title.audiences.length > 0 || title.genres.length > 0 || title.subgenres.length > 0) && (
          <ul className="title-tags" aria-label="Audience, genres, and sub-genres">
            {[
              ...title.audiences,
              ...(title.genres.length > 0 ? title.genres : [title.genre]),
              ...title.subgenres,
            ].map((tag) => (
              <li key={tag} className="tag">
                {tag}
              </li>
            ))}
          </ul>
        )}
        <p className="title-stats">
          {title.views.toLocaleString()} view{title.views === 1 ? '' : 's'} ·{' '}
          {title.likes.toLocaleString()} like{title.likes === 1 ? '' : 's'} ·{' '}
          {title.commentCount.toLocaleString()} comment{title.commentCount === 1 ? '' : 's'}
        </p>
        {title.isBlu && (
          <p className="blu-notice">
            <BluBadge height={22} decorative />
            <span>
              {title.bluPriceCents != null ? `${formatUsdCents(title.bluPriceCents)}/month · ` : ''}
              Subscribers only
            </span>
          </p>
        )}
        {!firstEpisode && firstUpcoming?.releaseAt && (
          <p className="episode-release" role="status">
            Releases {formatReleaseDate(firstUpcoming.releaseAt)} at 12:00 AM Eastern.
          </p>
        )}
        <div className="title-actions">
          {!firstEpisode && firstUpcoming && (
            <button
              type="button"
              className="button"
              onClick={() => void toggleReminder(firstUpcoming)}
              disabled={busy}
              aria-pressed={Boolean(firstUpcoming.reminderSet)}
            >
              {firstUpcoming.reminderSet ? 'Reminder set for release day' : 'Notify me on release day'}
            </button>
          )}
          {firstEpisode &&
            (title.isBlu && !title.bluAccess ? (
              <button type="button" className="button" onClick={subscribeBlu} disabled={bluBusy}>
                {bluBusy
                  ? 'Starting…'
                  : `Subscribe${title.bluPriceCents != null ? ` ${formatUsdCents(title.bluPriceCents)}/mo` : ''}`}
              </button>
            ) : (
              <Link className="button" to={`/watch/${firstEpisode.id}`}>
                {isSeries ? 'Play S1 E1' : 'Play'}
              </Link>
            ))}
          <button
            type="button"
            className="button button-quiet"
            onClick={toggleWatchlist}
            disabled={busy}
            aria-pressed={title.inMyWatchlist}
          >
            {title.inMyWatchlist ? 'In my list ✓' : 'Add to my list'}
          </button>
          <button
            type="button"
            className="button button-quiet"
            onClick={toggleLike}
            disabled={busy}
            aria-pressed={title.likedByMe}
          >
            {title.likedByMe ? 'Liked' : 'Like'} ({title.likes})
          </button>
          <button type="button" className="button button-quiet" onClick={() => void shareTitle()}>
            Share
          </button>
          {title.allowDownload && firstEpisode && (
            <a className="button button-quiet" href={firstEpisode.videoUrl} download>
              Download
            </a>
          )}
          <ReportControl titleId={title.id} titleSlug={title.slug} signedIn={user !== null} />
        </div>
        {shareNote && (
          <p className="status" role="status">
            {shareNote}
          </p>
        )}
        {bluError && (
          <p className="status status-error" role="alert">
            {bluError}
          </p>
        )}
      </header>

      {(isSeries || title.episodes.length > 1) && (
        <section aria-label="Episodes">
          {seasons.map(([season, episodes]) => (
            <div key={season}>
              <h2>Season {season}</h2>
              <ol className="episode-list">
                {episodes.map((episode) => (
                  <li key={episode.id}>
                    <div className="episode-row">
                      {episode.thumbnailUrl && (
                        <img className="episode-thumb" src={episode.thumbnailUrl} alt="" />
                      )}
                      <div>
                        <h3>
                          {episode.released ? (
                            <Link to={`/watch/${episode.id}`}>
                              E{episode.episode}: {episode.name}
                            </Link>
                          ) : (
                            <>
                              E{episode.episode}: {episode.name}
                            </>
                          )}
                        </h3>
                        {episode.synopsis && <p className="episode-synopsis">{episode.synopsis}</p>}
                        {!episode.released && episode.releaseAt && (
                          <p className="episode-release">
                            Releases {formatReleaseDate(episode.releaseAt)} at 12:00 AM Eastern.{' '}
                            <button
                              type="button"
                              className="button button-quiet"
                              onClick={() => void toggleReminder(episode)}
                              disabled={busy}
                              aria-pressed={Boolean(episode.reminderSet)}
                            >
                              {episode.reminderSet ? 'Reminder set' : 'Notify me on release day'}
                            </button>
                          </p>
                        )}
                      </div>
                      <p className="episode-duration">{formatDuration(episode.durationS)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      )}

      <CommentsSection titleSlug={title.slug} creatorHandle={title.creator.handle} />
    </div>
  );
}
