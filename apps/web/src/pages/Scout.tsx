import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  ContentKind,
  EpisodeViews,
  Genre,
  MySubscriptions,
  ScoutLeaderboards,
  ScoutMembership,
  ScoutPreferences,
} from '@sweam/shared';
import {
  CONTENT_KINDS,
  CONTENT_KIND_LABELS,
  GENRES,
  SCOUT_ALL_ACCESS_CENTS,
  SCOUT_BETA_FREE_LIMIT,
  SCOUT_BETA_TRIAL_DAYS,
  SCOUT_FINISH_BOARD_MIN_PLAYS,
  formatUsdCents,
  isFreeEmailDomain,
} from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { EpisodeViewsTable, totalEpisodeViews } from '../components/EpisodeViewsTable';
import { ErrorNote, Loading } from '../components/Status';
import { ScoutBadge } from '../components/ScoutBadge';
import { usePageTitle } from '../hooks';

/** "January 3, 2027" from an ISO timestamp, for billing copy. */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function Scout() {
  usePageTitle('Scout portal');
  const { user, refresh, loading } = useAuth();
  const [params] = useSearchParams();
  const welcome = params.get('welcome') === '1';

  // Returning from Stripe checkout: the webhook grants provisional access, so
  // re-pull the session to flip to the boards without a manual reload.
  useEffect(() => {
    if (welcome) void refresh();
  }, [welcome, refresh]);

  if (loading) return <Loading />;

  if (!user) {
    return (
      <div className="page page-narrow">
        <h1>Scout portal</h1>
        <p className="page-intro">
          For networks, studios, and aggregators: ranked momentum boards and per-title one-sheets
          for the creator work that is breaking out on Sweam. Access is by application, creators
          opt in per title, and every one-sheet view is visible to the creator.
        </p>
        <p>
          <Link to="/signin" state={{ from: '/scout' }}>
            Sign in
          </Link>{' '}
          to apply for scout access.
        </p>
      </div>
    );
  }

  if (user.scout?.status === 'approved') return <ScoutPortal orgName={user.scout.orgName} />;

  if (user.scout?.status === 'rejected') {
    return (
      <div className="page page-narrow">
        <h1>Scout portal</h1>
        <p className="status" role="status">
          Your application for {user.scout.orgName} was reviewed and not approved.
        </p>
      </div>
    );
  }

  // No application yet, or one started but not completed with a card on file.
  return (
    <ScoutApplication pending={user.scout?.status === 'pending'} welcome={welcome} onRefresh={refresh} />
  );
}

interface ScoutIntro {
  /** First-50 free-trial seats still open. */
  seatsLeft: number;
  /** False once this account has ever held a membership (one trial per account). */
  trialEligible: boolean;
  priceCents: number;
  trialDays: number;
}

function ScoutApplication({
  pending,
  welcome,
  onRefresh,
}: {
  pending: boolean;
  welcome: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [position, setPosition] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [terms, setTerms] = useState(false);
  const [intro, setIntro] = useState<ScoutIntro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<ScoutIntro>('/api/scout/intro')
      .then(setIntro)
      .catch(() => undefined);
  }, []);

  const betaFree = intro !== null && intro.seatsLeft > 0 && intro.trialEligible;
  const emailLooksFree = workEmail.includes('@') && isFreeEmailDomain(workEmail);

  /** Announce a problem and move focus to the field that needs attention. */
  function reject(message: string, fieldId: string) {
    setError(message);
    document.getElementById(fieldId)?.focus();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // The submit button stays enabled so a screen reader user always gets a
    // specific, announced reason instead of an unexplained disabled control.
    const required: Array<[string, string, string]> = [
      [firstName, 'scout-first', 'Enter your first name.'],
      [lastName, 'scout-last', 'Enter your last name.'],
      [orgName, 'scout-org', 'Enter your organization.'],
      [position, 'scout-position', 'Enter your position at the organization.'],
      [workEmail, 'scout-email', 'Enter your work email.'],
    ];
    const missing = required.find(([value]) => value.trim() === '');
    if (missing) {
      reject(missing[2], missing[1]);
      return;
    }
    if (emailLooksFree) {
      reject(
        'Use your work email. Free providers such as Gmail and Yahoo are not accepted.',
        'scout-email',
      );
      return;
    }
    if (!terms) {
      reject('Please read and accept the Scout Program Terms to continue.', 'scout-terms');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiSend<{ url: string; betaFree: boolean }>('POST', '/api/scout/apply', {
        firstName,
        lastName,
        orgName,
        position,
        workEmail,
        termsAccepted: true,
      });
      // Off to Stripe to put a card on file (a free trial for the first 50 scouts).
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the application.');
      setSubmitting(false);
    }
  }

  return (
    <div className="page page-form">
      <h1>Become a Sweam Scout</h1>
      <p className="page-intro">
        For networks, studios, and aggregators. Scouts get ranked momentum boards and per-title
        one-sheets for the creator work breaking out on Sweam, plus all-access to Sweam Blu. Creators
        see your organization whenever you open a one-sheet.
      </p>

      {welcome && pending && (
        <aside className="notice" role="status">
          <p>
            <strong>Card received.</strong> Your scout access is activating and usually appears
            within a few seconds.
          </p>
          <button type="button" className="button button-quiet" onClick={() => void onRefresh()}>
            Check again
          </button>
        </aside>
      )}

      {pending && !welcome && (
        <aside className="notice" role="note">
          Your scout application is on file, but there is no active membership. Submit the form to
          add a card and activate your scout access.
        </aside>
      )}

      {betaFree ? (
        <aside className="notice" role="note">
          <strong>Congratulations!</strong> You are one of the first {SCOUT_BETA_FREE_LIMIT} Scouts,
          so your membership is <strong>free for 3 months</strong>. We put a card on file but do not
          charge it until the {SCOUT_BETA_TRIAL_DAYS}-day trial ends, and you can cancel any time at
          least 24 business hours before it renews to avoid the {formatUsdCents(SCOUT_ALL_ACCESS_CENTS)}{' '}
          fee. {intro ? `${intro.seatsLeft} of ${SCOUT_BETA_FREE_LIMIT} free spots left.` : ''}
        </aside>
      ) : (
        intro && (
          <p className="page-intro">
            Membership is {formatUsdCents(intro.priceCents)}/month, billed after you add a card.
          </p>
        )
      )}

      {/* Editing any field clears the last error so a fixed problem does not linger. */}
      <form onSubmit={handleSubmit} onChange={() => setError(null)} noValidate>
        <div className="field">
          <label htmlFor="scout-first">First name</label>
          <input id="scout-first" type="text" required maxLength={80} value={firstName}
            onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="scout-last">Last name</label>
          <input id="scout-last" type="text" required maxLength={80} value={lastName}
            onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="scout-org">Organization</label>
          <input id="scout-org" type="text" required maxLength={120} value={orgName}
            onChange={(e) => setOrgName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="scout-position">Your position at the organization</label>
          <input id="scout-position" type="text" required maxLength={120} value={position}
            onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Head of Acquisitions" />
        </div>
        <div className="field">
          <label htmlFor="scout-email">Work email</label>
          <input id="scout-email" type="email" required value={workEmail}
            onChange={(e) => setWorkEmail(e.target.value)} aria-describedby="scout-email-hint" />
          <p id="scout-email-hint" className="field-hint">
            Use your organization email. Free providers such as Gmail, Yahoo, and Outlook are not
            accepted.
          </p>
          {emailLooksFree && (
            <p className="status status-error" role="alert">
              That looks like a free email provider. Please use your work email.
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="scout-terms">
            <input id="scout-terms" type="checkbox" required checked={terms}
              onChange={(e) => setTerms(e.target.checked)} />{' '}
            I have read and accept the{' '}
            <Link to="/legal/scout-terms" target="_blank" rel="noreferrer">
              Scout Program Terms
            </Link>
            .
          </label>
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Starting…' : 'Continue to add a card'}
        </button>
      </form>
    </div>
  );
}

/**
 * An approved scout's portal. Access follows the membership: while it is in
 * good standing (the first-50 free period, or a paid subscription) the boards
 * open; otherwise the scout is told exactly why and how to resume.
 */
function ScoutPortal({ orgName }: { orgName: string }) {
  const [membership, setMembership] = useState<ScoutMembership | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<MySubscriptions>('/api/me/subscriptions')
      .then((data) => {
        if (!cancelled) setMembership(data.scoutMembership);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your membership.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (membership === undefined) return <Loading label="Loading your membership" />;
  if (!membership || !membership.active) {
    return <ScoutMembershipLapsed orgName={orgName} membership={membership ?? null} />;
  }
  return <ScoutBoards orgName={orgName} membership={membership} />;
}

/** Starts Stripe Checkout to put a card on the membership; shared by the panels below. */
function useAddCard() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function addCard() {
    setBusy(true);
    setNotice('');
    try {
      const { url } = await apiSend<{ url: string }>('POST', '/api/stripe/scout');
      window.location.href = url;
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.code === 'stripe_not_configured'
          ? 'Billing is not switched on yet. Check back once payments are live.'
          : err instanceof ApiError
            ? err.message
            : 'Could not start checkout.',
      );
      setBusy(false);
    }
  }

  return { addCard, busy, notice };
}

/** Approved, but the membership is not in good standing: say why and offer the way back. */
function ScoutMembershipLapsed({
  orgName,
  membership,
}: {
  orgName: string;
  membership: ScoutMembership | null;
}) {
  const { addCard, busy, notice } = useAddCard();
  const price = formatUsdCents(SCOUT_ALL_ACCESS_CENTS);
  const reason = membership?.reason ?? 'none';

  const explanation =
    reason === 'past_due'
      ? 'Your last membership payment failed, so the scout portal and your Blu access are paused. Update your card to restore them.'
      : reason === 'ended'
        ? `Your free Scout membership has ended. Add a card to continue for ${price} per month; the scout portal and your Blu access resume as soon as it is on file.`
        : reason === 'canceled'
          ? `Your Scout membership was canceled. Start it again for ${price} per month to reopen the scout portal and your Blu access.`
          : `Your scout access for ${orgName} is approved, but the membership has not started. Add a card to start it for ${price} per month.`;

  return (
    <div className="page page-narrow">
      <h1>
        Scout portal <ScoutBadge />
      </h1>
      <p className="status" role="status">
        {explanation}
      </p>
      <div className="title-actions">
        {reason === 'past_due' ? (
          <Link className="button" to="/me/subscriptions">
            Update your card
          </Link>
        ) : (
          <button type="button" className="button" onClick={() => void addCard()} disabled={busy}>
            {busy ? 'Starting…' : 'Add a card'}
          </button>
        )}
      </div>
      {notice && (
        <p className="status status-error" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}

/**
 * Per-episode views for a series on a board, as a disclosure so the table
 * stays scannable: the summary carries the totals, the details hold the table.
 */
function EpisodeBreakdown({ titleName, episodes }: { titleName: string; episodes: EpisodeViews[] }) {
  if (episodes.length === 0) return null;
  return (
    <details className="episode-breakdown">
      <summary>
        Views by episode: {totalEpisodeViews(episodes).toLocaleString()} across {episodes.length}{' '}
        episode{episodes.length === 1 ? '' : 's'}
      </summary>
      <EpisodeViewsTable episodes={episodes} caption={`Views by episode for ${titleName}`} />
    </details>
  );
}

function ScoutBoards({ orgName, membership }: { orgName: string; membership: ScoutMembership }) {
  const [boards, setBoards] = useState<ScoutLeaderboards | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<ScoutLeaderboards>('/api/scout/leaderboards')
      .then((data) => {
        if (!cancelled) setBoards(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the boards.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!boards) return <Loading label="Loading the boards" />;

  return (
    <div className="page page-narrow">
      <h1>
        Scout portal <ScoutBadge />
      </h1>
      <p className="page-intro">
        Signed in for {orgName}. Boards cover titles whose creators opted into scouting; recent
        means the last 7 days. Opening a one-sheet is logged and visible to the creator.
      </p>

      <ScoutMembershipPanel membership={membership} />

      <ScoutPreferencesPanel />

      <section aria-labelledby="board-growth">
        <h2 id="board-growth">Fastest growing</h2>
        {boards.fastestGrowing.length === 0 ? (
          <p>Not enough recent activity yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">
                Titles ranked by week-over-week play growth weighted by volume
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Title</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Plays, recent 7 days</th>
                  <th scope="col">Prior 7 days</th>
                  <th scope="col">Growth</th>
                </tr>
              </thead>
              <tbody>
                {boards.fastestGrowing.map((entry, index) => (
                  <tr key={entry.title.id}>
                    <td>{index + 1}</td>
                    <th scope="row">
                      <Link to={`/scout/t/${entry.title.id}`}>{entry.title.name}</Link>
                      {entry.episodes && (
                        <EpisodeBreakdown titleName={entry.title.name} episodes={entry.episodes} />
                      )}
                    </th>
                    <td>@{entry.title.creator.handle}</td>
                    <td>{entry.recentPlays.toLocaleString()}</td>
                    <td>{entry.priorPlays.toLocaleString()}</td>
                    <td>{entry.growth}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="board-finish">
        <h2 id="board-finish">Finish-rate leaders</h2>
        {boards.finishLeaders.length === 0 ? (
          <p>
            No title has enough plays yet (the board needs {SCOUT_FINISH_BOARD_MIN_PLAYS} or more).
          </p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">
                Titles ranked by smoothed completion rate, minimum {SCOUT_FINISH_BOARD_MIN_PLAYS}{' '}
                plays; the finish rate shown is the raw share of plays that reached the end
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Title</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Plays</th>
                  <th scope="col">Finishes</th>
                  <th scope="col">Finish rate</th>
                </tr>
              </thead>
              <tbody>
                {boards.finishLeaders.map((entry, index) => (
                  <tr key={entry.title.id}>
                    <td>{index + 1}</td>
                    <th scope="row">
                      <Link to={`/scout/t/${entry.title.id}`}>{entry.title.name}</Link>
                      {entry.episodes && (
                        <EpisodeBreakdown titleName={entry.title.name} episodes={entry.episodes} />
                      )}
                    </th>
                    <td>@{entry.title.creator.handle}</td>
                    <td>{entry.plays.toLocaleString()}</td>
                    <td>{entry.finishes.toLocaleString()}</td>
                    <td>{Math.round(entry.finishRate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="board-genre">
        <h2 id="board-genre">Genre breakouts</h2>
        {boards.genreBreakouts.length === 0 ? (
          <p>Not enough recent activity yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">The current breakout title in each genre</caption>
              <thead>
                <tr>
                  <th scope="col">Genre</th>
                  <th scope="col">Title</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Plays, recent 7 days</th>
                  <th scope="col">Growth</th>
                </tr>
              </thead>
              <tbody>
                {boards.genreBreakouts.map((entry) => (
                  <tr key={entry.title.id}>
                    <td>{entry.genre}</td>
                    <th scope="row">
                      <Link to={`/scout/t/${entry.title.id}`}>{entry.title.name}</Link>
                      {entry.episodes && (
                        <EpisodeBreakdown titleName={entry.title.name} episodes={entry.episodes} />
                      )}
                    </th>
                    <td>@{entry.title.creator.handle}</td>
                    <td>{entry.recentPlays.toLocaleString()}</td>
                    <td>{entry.growth}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Membership status for an active scout. Scout access includes all-access to
 * every creator's Sweam Blu content, so there is nothing to buy here: only the
 * billing facts (free period, renewal, card on file) and a way to manage them.
 */
function ScoutMembershipPanel({ membership }: { membership: ScoutMembership }) {
  const { addCard, busy, notice } = useAddCard();
  const price = formatUsdCents(membership.priceCents);

  let billing: string;
  if (membership.inFreePeriod && membership.freeUntil) {
    billing = membership.hasCard
      ? `Free until ${formatDay(membership.freeUntil)} because you are one of the first ${SCOUT_BETA_FREE_LIMIT} Scouts. After that your card on file is charged ${price} per month; cancel at least 24 business hours before then to avoid it.`
      : `Free until ${formatDay(membership.freeUntil)} because you are one of the first ${SCOUT_BETA_FREE_LIMIT} Scouts. Add a card before then to keep your access; it is not charged until the free period ends, and membership is ${price} per month after that.`;
  } else if (membership.hasCard) {
    billing = membership.currentPeriodEnd
      ? `Renews ${formatDay(membership.currentPeriodEnd)} at ${price} per month. Cancel at least 24 business hours before then to avoid the next charge.`
      : `${price} per month, charged to the card on file.`;
  } else {
    billing = 'Complimentary membership.';
  }

  return (
    <section aria-labelledby="scout-membership" className="scout-all-access">
      <h2 id="scout-membership">Scout membership</h2>
      <p className="status status-ok" role="status">
        You now have access to all Blu content.
      </p>
      <p className="page-intro">
        {billing} <Link to="/me/subscriptions">Manage membership</Link>.
      </p>
      {membership.inFreePeriod && !membership.hasCard && (
        <div className="title-actions">
          <button type="button" className="button button-quiet" onClick={() => void addCard()} disabled={busy}>
            {busy ? 'Starting…' : 'Add a card'}
          </button>
        </div>
      )}
      {notice && (
        <p className="status status-error" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}

/**
 * New-content alerts: a master switch plus the genres and content types the
 * scout wants to be told about. Empty genres or types means "all".
 */
function ScoutPreferencesPanel() {
  const [prefs, setPrefs] = useState<ScoutPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<ScoutPreferences>('/api/scout/preferences')
      .then((data) => {
        if (!cancelled) setPrefs(data);
      })
      .catch(() => {
        if (!cancelled) setPrefs({ notifyEnabled: true, genres: [], kinds: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prefs) return null;

  function update(next: ScoutPreferences) {
    setPrefs(next);
    setSaved(false);
  }
  function toggleGenre(g: Genre) {
    update({
      ...prefs!,
      genres: prefs!.genres.includes(g)
        ? prefs!.genres.filter((x) => x !== g)
        : [...prefs!.genres, g],
    });
  }
  function toggleKind(k: ContentKind) {
    update({
      ...prefs!,
      kinds: prefs!.kinds.includes(k) ? prefs!.kinds.filter((x) => x !== k) : [...prefs!.kinds, k],
    });
  }

  async function save() {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await apiSend<ScoutPreferences>('PUT', '/api/scout/preferences', prefs);
      setPrefs(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your preferences.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="scout-prefs" className="scout-prefs">
      <h2 id="scout-prefs">New-content alerts</h2>
      <p className="page-intro">
        Get notified when new content is added to scout. Leave the content types or genres empty to
        hear about everything.
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.notifyEnabled}
          onChange={(e) => update({ ...prefs, notifyEnabled: e.target.checked })}
        />
        Notify me about new content to scout
      </label>

      <fieldset className="checkbox-group" disabled={!prefs.notifyEnabled}>
        <legend>Content types</legend>
        <div className="checkbox-grid">
          {CONTENT_KINDS.map((k) => (
            <label key={k} className="checkbox-row">
              <input
                type="checkbox"
                checked={prefs.kinds.includes(k)}
                onChange={() => toggleKind(k)}
              />
              {CONTENT_KIND_LABELS[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="checkbox-group" disabled={!prefs.notifyEnabled}>
        <legend>Genres</legend>
        <div className="checkbox-grid">
          {GENRES.map((g) => (
            <label key={g} className="checkbox-row">
              <input
                type="checkbox"
                checked={prefs.genres.includes(g)}
                onChange={() => toggleGenre(g)}
              />
              {g}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="status status-ok" role="status">
          Preferences saved.
        </p>
      )}
      <button type="button" className="button" onClick={() => void save()} disabled={saving}>
        {saving ? 'Saving…' : 'Save preferences'}
      </button>
    </section>
  );
}
