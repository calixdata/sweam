import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { UcastPick, UcastRecast, UcastWorkPage } from '@sweam/shared';
import { UCAST_DISCLAIMER, UCAST_MAX_PICKS, UCAST_NAME, UCAST_WORK_KIND_LABELS } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components/Avatar';
import { ErrorNote, Loading } from '../components/Status';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { usePageTitle } from '../hooks';

interface DraftPick {
  role: string;
  originalPerformer: string;
  pick: string;
  note: string;
}

const emptyPick = (): DraftPick => ({ role: '', originalPerformer: '', pick: '', note: '' });

function VoteButton({
  pick,
  canVote,
  onChange,
}: {
  pick: UcastPick;
  canVote: boolean;
  onChange: (next: { votes: number; votedByMe: boolean }) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      const next = await apiSend<{ votes: number; votedByMe: boolean }>(
        pick.votedByMe ? 'DELETE' : 'PUT',
        `/api/ucast/picks/${encodeURIComponent(pick.id)}/vote`,
      );
      onChange(next);
    } finally {
      setBusy(false);
    }
  }
  const label = `Agree with ${pick.pick} as ${pick.role}`;
  if (!canVote) {
    return (
      <span className="ucast-votes">
        {pick.votes} agree
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`button button-quiet ucast-vote${pick.votedByMe ? ' ucast-vote-on' : ''}`}
      aria-pressed={pick.votedByMe}
      aria-label={label}
      onClick={toggle}
      disabled={busy}
    >
      {pick.votedByMe ? 'Agreed' : 'Agree'} ({pick.votes})
    </button>
  );
}

function RecastCard({
  recast,
  canVote,
  canRemove,
  onVote,
  onRemove,
}: {
  recast: UcastRecast;
  canVote: boolean;
  canRemove: boolean;
  onVote: (pickId: string, next: { votes: number; votedByMe: boolean }) => void;
  onRemove: (recastId: string) => void;
}) {
  const authorName = recast.author.displayName;
  return (
    <li className="ucast-recast">
      <div className="ucast-recast-head">
        <Avatar src={recast.author.avatarUrl} name={authorName} size={36} />
        <div>
          <p className="ucast-recast-author">
            {recast.author.username ? (
              <Link to={`/c/${recast.author.username}`}>{authorName}</Link>
            ) : (
              authorName
            )}{' '}
            {recast.author.verified && <VerifiedBadge />}
            {recast.author.official && <span className="ucast-official-tag">Open call host</span>}
          </p>
          <p className="ucast-recast-when">
            {new Date(recast.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
            {' · '}
            {recast.votes} {recast.votes === 1 ? 'agreement' : 'agreements'}
          </p>
        </div>
        {canRemove && (
          <button
            type="button"
            className="button button-quiet ucast-remove"
            onClick={() => {
              if (window.confirm('Remove this recast? This cannot be undone.')) onRemove(recast.id);
            }}
          >
            Remove
          </button>
        )}
      </div>
      {recast.headline && <h3 className="ucast-recast-headline">{recast.headline}</h3>}
      {recast.note && <p className="ucast-recast-note">{recast.note}</p>}
      <div className="table-scroll">
        <table className="studio-table ucast-picks">
          <caption className="visually-hidden">Cast by {authorName}</caption>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Originally</th>
              <th scope="col">Recast as</th>
              <th scope="col">Why</th>
              <th scope="col">Agree</th>
            </tr>
          </thead>
          <tbody>
            {recast.picks.map((pick) => (
              <tr key={pick.id}>
                <th scope="row">{pick.role}</th>
                <td>{pick.originalPerformer ?? ''}</td>
                <td className="ucast-pick-name">{pick.pick}</td>
                <td className="ucast-pick-note">{pick.note}</td>
                <td>
                  <VoteButton pick={pick} canVote={canVote} onChange={(next) => onVote(pick.id, next)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </li>
  );
}

export function UcastWork() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [page, setPage] = useState<UcastWorkPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [headline, setHeadline] = useState('');
  const [note, setNote] = useState('');
  const [picks, setPicks] = useState<DraftPick[]>([emptyPick(), emptyPick(), emptyPick()]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  usePageTitle(page ? `${page.work.title} (${page.work.year}) · ${UCAST_NAME}` : UCAST_NAME);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      setPage(await apiGet<UcastWorkPage>(`/api/ucast/works/${encodeURIComponent(slug)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this work.');
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  function updatePick(index: number, patch: Partial<DraftPick>) {
    setPicks((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function applyVote(pickId: string, next: { votes: number; votedByMe: boolean }) {
    setPage((prev) => {
      if (!prev) return prev;
      const recasts = prev.recasts.map((recast) => ({
        ...recast,
        picks: recast.picks.map((p) => (p.id === pickId ? { ...p, ...next } : p)),
      }));
      return {
        ...prev,
        recasts: recasts.map((r) => ({ ...r, votes: r.picks.reduce((s, p) => s + p.votes, 0) })),
      };
    });
    // Consensus depends on every vote; refresh it quietly.
    void load();
  }

  async function removeRecast(recastId: string) {
    await apiSend('DELETE', `/api/ucast/recasts/${encodeURIComponent(recastId)}`);
    await load();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!slug) return;
    setFormError(null);
    const filled = picks.filter((p) => p.role.trim() || p.pick.trim());
    if (filled.length === 0) {
      setFormError('Cast at least one role: a role name and who you would cast.');
      return;
    }
    const incomplete = filled.find((p) => !p.role.trim() || !p.pick.trim());
    if (incomplete) {
      setFormError('Every row needs both a role and a pick. Clear a row to leave it out.');
      return;
    }
    setBusy(true);
    try {
      await apiSend('POST', `/api/ucast/works/${encodeURIComponent(slug)}/recasts`, {
        headline,
        note,
        picks: filled.map((p) => ({
          role: p.role,
          originalPerformer: p.originalPerformer,
          pick: p.pick,
          note: p.note,
        })),
      });
      setHeadline('');
      setNote('');
      setPicks([emptyPick(), emptyPick(), emptyPick()]);
      setPosted(true);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not post your recast.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!page) return <Loading label="Loading this work" />;

  const { work, roles, recasts } = page;

  return (
    <div className="page">
      <nav aria-label="Breadcrumb" className="ucast-crumb">
        <Link to="/ucast">{UCAST_NAME}</Link>
      </nav>
      <section className="ucast-hero">
        <p className="ucast-card-kind">
          {UCAST_WORK_KIND_LABELS[work.kind]}
          {work.official ? ' · Open call from @ucast' : ''}
        </p>
        <h1>
          {work.title} <span className="ucast-card-year">({work.year})</span>
        </h1>
        {work.hook && <p className="page-intro">{work.hook}</p>}
        <p className="ucast-disclaimer" role="note">
          {UCAST_DISCLAIMER}
        </p>
      </section>

      <section aria-labelledby="ucast-room-heading">
        <h2 id="ucast-room-heading">Who the room would cast</h2>
        {roles.length === 0 ? (
          <p>No picks yet. Post the first cast below.</p>
        ) : (
          <ul className="ucast-consensus">
            {roles.map((role) => (
              <li key={role.role}>
                <strong>{role.role}:</strong>{' '}
                {role.picks
                  .slice(0, 3)
                  .map((p) => `${p.pick} (${p.votes} agree, ${p.recasts} ${p.recasts === 1 ? 'cast' : 'casts'})`)
                  .join(' · ')}
                {role.picks.length > 3 ? ` · and ${role.picks.length - 3} more` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ucast-recasts-heading">
        <h2 id="ucast-recasts-heading">
          {recasts.length} {recasts.length === 1 ? 'recast' : 'recasts'}
        </h2>
        {recasts.length === 0 ? (
          <p>Nobody has cast this yet.</p>
        ) : (
          <ul className="ucast-recast-list">
            {recasts.map((recast) => (
              <RecastCard
                key={recast.id}
                recast={recast}
                canVote={Boolean(user)}
                canRemove={recast.isMine || Boolean(user?.isAdmin)}
                onVote={applyVote}
                onRemove={removeRecast}
              />
            ))}
          </ul>
        )}
        {!user && (
          <p>
            <Link to="/signin">Sign in</Link> to agree with a pick or post your own cast.
          </p>
        )}
      </section>

      {user && (
        <section aria-labelledby="ucast-add-heading">
          <h2 id="ucast-add-heading">Add your cast</h2>
          <p className="page-intro">
            Name the role and who you would cast. Up to {UCAST_MAX_PICKS} roles. Text only: no images, no AI
            faces or voices. Every cast is a fan concept and is labeled as one.
          </p>
          {posted && (
            <p className="status status-ok" role="status">
              Your recast is up.
            </p>
          )}
          <form className="studio-form ucast-form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="ucast-headline">Headline (optional)</label>
              <input
                id="ucast-headline"
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
                maxLength={160}
                placeholder="The one-line idea behind your cast"
              />
            </div>
            <fieldset className="ucast-pick-rows">
              <legend>Roles</legend>
              {picks.map((pick, index) => (
                <div className="ucast-pick-row" key={index}>
                  <div className="field">
                    <label htmlFor={`ucast-role-${index}`}>Role {index + 1}</label>
                    <input
                      id={`ucast-role-${index}`}
                      value={pick.role}
                      onChange={(event) => updatePick(index, { role: event.target.value })}
                      maxLength={80}
                      placeholder="Character or part"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`ucast-orig-${index}`}>Originally played by (optional)</label>
                    <input
                      id={`ucast-orig-${index}`}
                      value={pick.originalPerformer}
                      onChange={(event) => updatePick(index, { originalPerformer: event.target.value })}
                      maxLength={80}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`ucast-pick-${index}`}>Recast as</label>
                    <input
                      id={`ucast-pick-${index}`}
                      value={pick.pick}
                      onChange={(event) => updatePick(index, { pick: event.target.value })}
                      maxLength={80}
                      placeholder="Actor, singer or performer"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`ucast-note-${index}`}>Why (optional)</label>
                    <input
                      id={`ucast-note-${index}`}
                      value={pick.note}
                      onChange={(event) => updatePick(index, { note: event.target.value })}
                      maxLength={280}
                    />
                  </div>
                  {picks.length > 1 && (
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={`Remove role ${index + 1}`}
                      onClick={() => setPicks((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove row
                    </button>
                  )}
                </div>
              ))}
              {picks.length < UCAST_MAX_PICKS && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setPicks((prev) => [...prev, emptyPick()])}
                >
                  Add another role
                </button>
              )}
            </fieldset>
            <div className="field">
              <label htmlFor="ucast-note">Notes (optional)</label>
              <textarea
                id="ucast-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1200}
                rows={4}
                placeholder="The thinking behind the cast, the song map, what you would change"
              />
            </div>
            {formError && (
              <p className="status status-error" role="alert">
                {formError}
              </p>
            )}
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Posting…' : 'Post my cast'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
