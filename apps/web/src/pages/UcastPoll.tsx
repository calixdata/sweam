import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { UcastBallot, UcastPick, UcastPollPage, UcastRoleResult } from '@sweam/shared';
import { UCAST_NAME, UCAST_RESULTS_WITHIN_HOURS, UCAST_WORK_KIND_LABELS } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components/Avatar';
import { ErrorNote, Loading } from '../components/Status';
import { PhasePill, UcastShell, formatDay, formatWhen, pollStatusLine, timeLeft } from '../components/UcastShell';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { usePageTitle } from '../hooks';

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Per-role standings or results: top picks with their share of ballots. */
function ResultsList({ results, heading, intro }: { results: UcastRoleResult[]; heading: string; intro: string }) {
  return (
    <section aria-labelledby="ucast-results-heading" className="ucast-section">
      <h2 id="ucast-results-heading">{heading}</h2>
      <p className="page-intro">{intro}</p>
      <ol className="ucast-results">
        {results.map((r) => (
          <li key={r.role.id}>
            <h3>
              {r.role.name}
              {r.role.originalPerformer && <span className="ucast-orig"> (originally {r.role.originalPerformer})</span>}
            </h3>
            {r.standings.length === 0 ? (
              <p className="ucast-empty">Nobody has cast this role yet.</p>
            ) : (
              <ol className="ucast-standings" aria-label={`Standings for ${r.role.name}`}>
                {r.standings.slice(0, 5).map((s, i) => (
                  <li key={s.pick}>
                    <span className="ucast-standing-rank" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="ucast-standing-name">{s.pick}</span>
                    <span className="ucast-standing-bar" aria-hidden="true">
                      <span style={{ width: percent(s.share) }} />
                    </span>
                    <span className="ucast-standing-nums">
                      {percent(s.share)} · {s.ballots} {s.ballots === 1 ? 'ballot' : 'ballots'} · {s.votes} {s.votes === 1 ? 'agree' : 'agrees'}
                    </span>
                  </li>
                ))}
                {r.standings.length > 5 && <li className="ucast-empty">and {r.standings.length - 5} more</li>}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function AgreeButton({ pick, roleName, enabled, onChange }: { pick: UcastPick; roleName: string; enabled: boolean; onChange: (next: { votes: number; votedByMe: boolean }) => void }) {
  const [busy, setBusy] = useState(false);
  if (!enabled) return <span className="ucast-votes">{pick.votes} agree</span>;
  async function toggle() {
    setBusy(true);
    try {
      onChange(await apiSend<{ votes: number; votedByMe: boolean }>(pick.votedByMe ? 'DELETE' : 'PUT', `/api/ucast/picks/${encodeURIComponent(pick.id)}/vote`));
    } catch {
      /* the poll may have just closed; the next load explains */
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className={`button button-quiet ucast-vote${pick.votedByMe ? ' ucast-vote-on' : ''}`} aria-pressed={pick.votedByMe} aria-label={`Agree with ${pick.pick} as ${roleName}`} onClick={toggle} disabled={busy}>
      {pick.votedByMe ? 'Agreed' : 'Agree'} ({pick.votes})
    </button>
  );
}

function BallotCard({ ballot, roleNames, canAgree, canRemove, onVote, onRemove }: { ballot: UcastBallot; roleNames: Map<string, string>; canAgree: boolean; canRemove: boolean; onVote: (pickId: string, next: { votes: number; votedByMe: boolean }) => void; onRemove: () => void }) {
  const name = ballot.author.displayName;
  return (
    <li className="ucast-ballot">
      <div className="ucast-ballot-head">
        <Avatar src={ballot.author.avatarUrl} name={name} size={32} />
        <p className="ucast-ballot-author">
          {ballot.author.username ? <Link to={`/c/${ballot.author.username}`}>{name}</Link> : name} {ballot.author.verified && <VerifiedBadge />}
          {ballot.author.official && <span className="ucast-official-tag">Host</span>}
          <span className="ucast-ballot-when">
            {' '}
            · {formatDay(ballot.createdAt)} · {ballot.votes} {ballot.votes === 1 ? 'agree' : 'agrees'}
          </span>
        </p>
        {canRemove && (
          <button type="button" className="button button-quiet ucast-remove" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {ballot.note && <p className="ucast-ballot-note">{ballot.note}</p>}
      <ul className="ucast-ballot-picks">
        {ballot.picks.map((pick) => (
          <li key={pick.id}>
            <span className="ucast-ballot-role">{roleNames.get(pick.roleId) ?? 'Role'}:</span> <strong>{pick.pick}</strong>
            {pick.note && <span className="ucast-pick-note"> · {pick.note}</span>}{' '}
            <AgreeButton pick={pick} roleName={roleNames.get(pick.roleId) ?? 'this role'} enabled={canAgree && !ballot.isMine} onChange={(next) => onVote(pick.id, next)} />
          </li>
        ))}
      </ul>
    </li>
  );
}

export function UcastPoll() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [page, setPage] = useState<UcastPollPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { pick: string; note: string }>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  usePageTitle(page ? `${page.poll.title} (${page.poll.year}) · ${UCAST_NAME}` : UCAST_NAME);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const data = await apiGet<UcastPollPage>(`/api/ucast/polls/${encodeURIComponent(slug)}`);
      setPage(data);
      if (data.myBallot) {
        const next: Record<string, { pick: string; note: string }> = {};
        for (const p of data.myBallot.picks) next[p.roleId] = { pick: p.pick, note: p.note };
        setDraft(next);
        setNote(data.myBallot.note);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this poll.');
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  function applyVote(pickId: string, next: { votes: number; votedByMe: boolean }) {
    setPage((prev) => {
      if (!prev) return prev;
      const ballots = prev.ballots.map((b) => ({ ...b, picks: b.picks.map((p) => (p.id === pickId ? { ...p, ...next } : p)) }));
      return { ...prev, ballots: ballots.map((b) => ({ ...b, votes: b.picks.reduce((s, p) => s + p.votes, 0) })) };
    });
    void load();
  }

  async function submitBallot(event: FormEvent) {
    event.preventDefault();
    if (!slug || !page) return;
    setFormError(null);
    const picks = page.roles.filter((r) => draft[r.id]?.pick.trim()).map((r) => ({ roleId: r.id, pick: draft[r.id]!.pick, note: draft[r.id]!.note }));
    if (picks.length === 0) {
      setFormError('Cast at least one role before sending your ballot.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ replaced: boolean }>('PUT', `/api/ucast/polls/${encodeURIComponent(slug)}/ballot`, { note, picks });
      setSaved(res.replaced ? 'Your ballot is updated.' : 'Your ballot is in.');
      setEditing(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not send your ballot.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!slug || !window.confirm('Withdraw your ballot from this poll?')) return;
    await apiSend('DELETE', `/api/ucast/polls/${encodeURIComponent(slug)}/ballot`);
    setDraft({});
    setNote('');
    setSaved('Your ballot is withdrawn.');
    await load();
  }

  async function removeBallot(ballotId: string) {
    if (!window.confirm('Remove this ballot? The member will be notified.')) return;
    await apiSend('DELETE', `/api/ucast/ballots/${encodeURIComponent(ballotId)}`);
    await load();
  }

  if (error) return <UcastShell><ErrorNote message={error} /></UcastShell>;
  if (!page) return <UcastShell><Loading label="Loading this poll" /></UcastShell>;

  const { poll, roles, results, ballots, myBallot } = page;
  const roleNames = new Map(roles.map((r) => [r.id, r.name]));
  const isOpen = poll.phase === 'open';
  const showForm = isOpen && user && (editing || !myBallot);

  return (
    <UcastShell>
      <nav aria-label="Breadcrumb" className="ucast-crumb">
        <Link to="/ucast">All polls</Link>
      </nav>
      <section className="ucast-poll-hero">
        {poll.coverUrl ? <img className="ucast-poll-cover" src={poll.coverUrl} alt="" /> : <div className={`ucast-poll-cover ucast-cover-blank ucast-kind-${poll.kind}`} aria-hidden="true"><span>{UCAST_WORK_KIND_LABELS[poll.kind]}</span></div>}
        <div>
          <p className="ucast-card-kind">
            {UCAST_WORK_KIND_LABELS[poll.kind]}
            {poll.official ? ' · Launch poll from @ucast' : ''}
          </p>
          <h1>
            {poll.title} <span className="ucast-card-year">({poll.year})</span>
          </h1>
          {poll.hook && <p className="page-intro">{poll.hook}</p>}
          <dl className="ucast-status-strip">
            <div>
              <dt>Status</dt>
              <dd>
                <PhasePill phase={poll.phase} />
              </dd>
            </div>
            {poll.closesAt && (
              <div>
                <dt>{isOpen || poll.phase === 'scheduled' ? 'Closes' : 'Closed'}</dt>
                <dd>
                  {formatWhen(poll.closesAt)}
                  {isOpen && timeLeft(poll.closesAt) ? ` (${timeLeft(poll.closesAt)})` : ''}
                </dd>
              </div>
            )}
            {poll.resultsDueAt && (
              <div>
                <dt>{poll.phase === 'results' ? 'Results posted' : 'Results by'}</dt>
                <dd>{formatWhen(poll.resultsDueAt)}</dd>
              </div>
            )}
            <div>
              <dt>Ballots</dt>
              <dd>{poll.ballotCount}</dd>
            </div>
            <div>
              <dt>Roles</dt>
              <dd>{poll.roleCount}</dd>
            </div>
          </dl>
          {page.adminNote && (poll.phase === 'pending' || poll.phase === 'rejected') && <p className="notice">Note from UCast: {page.adminNote}</p>}
        </div>
      </section>

      {/* 1. Your ballot */}
      <section aria-labelledby="ucast-ballot-heading" className="ucast-section">
        <h2 id="ucast-ballot-heading">Your ballot</h2>
        {saved && (
          <p className="status status-ok" role="status">
            {saved}
          </p>
        )}
        {!user && isOpen && (
          <p>
            <Link to="/signin" state={{ from: `/ucast/p/${poll.slug}` }}>
              Sign in
            </Link>{' '}
            or <Link to="/signup">join Sweam</Link> to cast this poll. One ballot per member; you can change it until the poll closes.
          </p>
        )}
        {!isOpen && poll.phase !== 'pending' && <p className="ucast-empty">{poll.phase === 'scheduled' ? `Casting opens ${poll.opensAt ? formatWhen(poll.opensAt) : 'soon'}.` : `Casting closed ${poll.closesAt ? formatWhen(poll.closesAt) : ''}.`}</p>}
        {poll.phase === 'pending' && <p className="ucast-empty">This request is awaiting UCast review. It opens for casting once approved.</p>}
        {user && isOpen && myBallot && !editing && (
          <div className="ucast-myballot">
            <ul className="ucast-ballot-picks">
              {myBallot.picks.map((p) => (
                <li key={p.id}>
                  <span className="ucast-ballot-role">{roleNames.get(p.roleId)}:</span> <strong>{p.pick}</strong>
                  {p.note && <span className="ucast-pick-note"> · {p.note}</span>} <span className="ucast-votes">{p.votes} agree</span>
                </li>
              ))}
            </ul>
            <div className="ucast-actions">
              <button type="button" className="button" onClick={() => setEditing(true)}>
                Change my ballot
              </button>
              <button type="button" className="button button-quiet" onClick={withdraw}>
                Withdraw
              </button>
            </div>
          </div>
        )}
        {showForm && (
          <form className="studio-form ucast-form" onSubmit={submitBallot}>
            <p className="field-hint">Cast as many roles as you like; leave the rest blank. Text only: names, no images, no AI faces or voices.</p>
            <ol className="ucast-ballot-rows">
              {roles.map((role, index) => (
                <li key={role.id} className="ucast-ballot-row">
                  <div className="ucast-ballot-role-label">
                    <span className="ucast-ballot-role-num" aria-hidden="true">
                      {index + 1}
                    </span>
                    <strong>{role.name}</strong>
                    {role.originalPerformer && <span className="ucast-orig"> (originally {role.originalPerformer})</span>}
                  </div>
                  <div className="field">
                    <label htmlFor={`pick-${role.id}`}>Recast {role.name} as</label>
                    <input id={`pick-${role.id}`} value={draft[role.id]?.pick ?? ''} maxLength={80} placeholder="Actor, singer or performer" onChange={(e) => setDraft((d) => ({ ...d, [role.id]: { pick: e.target.value, note: d[role.id]?.note ?? '' } }))} />
                  </div>
                  <div className="field">
                    <label htmlFor={`why-${role.id}`}>Why (optional)</label>
                    <input id={`why-${role.id}`} value={draft[role.id]?.note ?? ''} maxLength={280} onChange={(e) => setDraft((d) => ({ ...d, [role.id]: { pick: d[role.id]?.pick ?? '', note: e.target.value } }))} />
                  </div>
                </li>
              ))}
            </ol>
            <div className="field">
              <label htmlFor="ucast-ballot-note">A note on your cast (optional)</label>
              <textarea id="ucast-ballot-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {formError && (
              <p className="status status-error" role="alert">
                {formError}
              </p>
            )}
            <div className="ucast-actions">
              <button type="submit" className="button" disabled={busy}>
                {busy ? 'Sending…' : myBallot ? 'Save my ballot' : 'Send my ballot'}
              </button>
              {myBallot && (
                <button type="button" className="button button-quiet" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
      </section>

      {/* 2. Standings or results */}
      {poll.phase === 'closed' && !user?.isAdmin ? (
        <section className="ucast-section" aria-labelledby="ucast-results-heading">
          <h2 id="ucast-results-heading">Results</h2>
          <p>
            This poll closed {poll.closesAt ? formatWhen(poll.closesAt) : ''}. Results are posted within {UCAST_RESULTS_WITHIN_HOURS} hours, by {poll.resultsDueAt ? formatWhen(poll.resultsDueAt) : 'soon'}.
          </p>
        </section>
      ) : (
        <ResultsList
          results={results}
          heading={poll.phase === 'results' ? 'Results' : isOpen ? 'Standings so far' : 'Standings'}
          intro={
            poll.phase === 'results'
              ? page.resultsNote || `Final results from ${poll.ballotCount} ${poll.ballotCount === 1 ? 'ballot' : 'ballots'}.`
              : `Live from ${poll.ballotCount} ${poll.ballotCount === 1 ? 'ballot' : 'ballots'}. ${pollStatusLine(poll)}.`
          }
        />
      )}

      {/* 3. The room's ballots */}
      <section aria-labelledby="ucast-ballots-heading" className="ucast-section">
        <h2 id="ucast-ballots-heading">
          Ballots from the room ({ballots.length})
        </h2>
        {ballots.length === 0 ? (
          <p className="ucast-empty">No ballots yet.</p>
        ) : (
          <ul className="ucast-ballot-list">
            {ballots.map((b) => (
              <BallotCard key={b.id} ballot={b} roleNames={roleNames} canAgree={Boolean(user) && isOpen} canRemove={Boolean(user?.isAdmin) && !b.isMine} onVote={applyVote} onRemove={() => removeBallot(b.id)} />
            ))}
          </ul>
        )}
      </section>
    </UcastShell>
  );
}
