import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AdminAccount, AdminAccountAction, AdminVerificationRequest } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { AdminNav } from '../components/AdminNav';
import { ErrorNote, Loading } from '../components/Status';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { usePageTitle } from '../hooks';

/** Admin: find any account, grant or remove the verified check, help with sign-in, and review identity documents. */
export function AdminAccounts() {
  usePageTitle('Accounts');
  const { user, loading } = useAuth();

  if (loading) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>Accounts</h1>
        <p>This area is for Sweam administrators.</p>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <h1>Accounts</h1>
      <AdminNav />
      <AccountsSection />
      <VerificationQueue />
    </div>
  );
}

/** Pending identity verification requests: open both documents, then verify or reject. */
function VerificationQueue() {
  const [verifications, setVerifications] = useState<AdminVerificationRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ requests: AdminVerificationRequest[] }>('/api/admin/verifications');
      setVerifications(data.requests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load verification requests.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decideVerification(request: AdminVerificationRequest, approve: boolean) {
    let note = '';
    let sex: 'female' | 'male' | undefined;
    if (!approve) {
      const answer = window.prompt(
        `Reason the request from ${request.legalName} is not approved (shown to them; optional):`,
        '',
      );
      if (answer === null) return;
      note = answer.trim();
    } else {
      const marker = window.prompt(
        `Sex marker on ${request.legalName}'s ID — type F or M (they declared "${request.declaredSex}"). Leave blank to verify without recording it; the women-only / men-only filter needs it.`,
        request.declaredSex === 'female' ? 'F' : request.declaredSex === 'male' ? 'M' : '',
      );
      if (marker === null) return;
      const m = marker.trim().toLowerCase();
      if (m === 'f' || m === 'female') sex = 'female';
      else if (m === 'm' || m === 'male') sex = 'male';
    }
    try {
      await apiSend('POST', `/api/admin/verifications/${request.id}/decide`, { approve, note, sex });
      setNotice(`${approve ? 'Verified' : 'Rejected'} ${request.legalName}. The documents were deleted.`);
      await load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Decision failed.');
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!verifications) return <Loading label="Loading verification requests" />;

  return (
    <section aria-labelledby="admin-verifications">
      <h2 id="admin-verifications">Identity verification</h2>
      <p className="field-hint">
        Requests from accounts that uploaded a government ID and a proof of address. Open both
        documents, check that the name and address match, then verify or reject. Either decision
        deletes the documents; only the decision is kept.
      </p>
      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}
      {verifications.length === 0 ? (
        <p>No verification requests waiting.</p>
      ) : (
        <div className="table-scroll">
          <table className="studio-table">
            <caption className="visually-hidden">Identity verification requests to review</caption>
            <thead>
              <tr>
                <th scope="col">Legal name</th>
                <th scope="col">Account</th>
                <th scope="col">Documents</th>
                <th scope="col">Submitted</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {verifications.map((request) => (
                <tr key={request.id}>
                  <th scope="row">{request.legalName}</th>
                  <td>
                    {request.displayName}
                    {request.username ? ` (@${request.username})` : ''}
                    <br />
                    <span className="field-hint">{request.email}</span>
                  </td>
                  <td>
                    <a href={request.idDocUrl} target="_blank" rel="noreferrer">
                      ID document
                    </a>
                    {' · '}
                    <a href={request.addressDocUrl} target="_blank" rel="noreferrer">
                      Proof of address
                    </a>
                  </td>
                  <td>{request.createdAt.slice(0, 10)}</td>
                  <td>
                    <div className="episode-actions">
                      <button
                        type="button"
                        className="button"
                        onClick={() => void decideVerification(request, true)}
                      >
                        Verify
                      </button>
                      <button
                        type="button"
                        className="button button-danger"
                        onClick={() => void decideVerification(request, false)}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Accounts: find any account by username, name, or email; tick Verified; and
 * Manage an account: suspend, ban, restore, set a password, sign-in help, delete.
 */
function AccountsSection() {
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);

  const replace = useCallback((updated: AdminAccount | null) => {
    if (updated) setAccounts((list) => (list ?? []).map((a) => (a.id === updated.id ? updated : a)));
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term) {
      setError('Enter a username, name, or email.');
      document.getElementById('admin-account-query')?.focus();
      return;
    }
    setError(null);
    setNotice('');
    setManagingId(null);
    setSearching(true);
    try {
      const data = await apiGet<{ accounts: AdminAccount[] }>(`/api/admin/users?q=${encodeURIComponent(term)}`);
      setAccounts(data.accounts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  async function setVerified(account: AdminAccount, verified: boolean) {
    setBusyId(account.id);
    setError(null);
    try {
      const data = await apiSend<{ account: AdminAccount | null }>('POST', `/api/admin/users/${account.id}/verified`, { verified });
      replace(data.account);
      setNotice(`${verified ? 'Verified' : 'Removed the verified check from'} ${labelOf(account)}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that account.');
    } finally {
      setBusyId(null);
    }
  }

  const managing = accounts?.find((a) => a.id === managingId) ?? null;

  return (
    <section aria-labelledby="admin-accounts">
      <h2 id="admin-accounts">Find an account</h2>
      <p className="field-hint">
        Find an account, tick Verified to grant or remove the check, or choose Manage to suspend, ban, restore,
        set a password, send a reset link, or delete the account.
      </p>
      <form onSubmit={search} role="search" className="search-form" noValidate>
        <label htmlFor="admin-account-query">Username, name, or email</label>
        <div className="search-row">
          <input
            id="admin-account-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="button" disabled={searching}>
            {searching ? 'Searching…' : 'Find accounts'}
          </button>
        </div>
      </form>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="status status-ok" role="status">
          {notice}
        </p>
      )}
      {accounts && accounts.length === 0 && <p role="status">No accounts match.</p>}
      {accounts && accounts.length > 0 && (
        <div className="table-scroll">
          <table className="studio-table">
            <caption className="visually-hidden">Accounts matching your search</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Email</th>
                <th scope="col">Type</th>
                <th scope="col">Standing</th>
                <th scope="col">Verified</th>
                <th scope="col">Manage</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const label = labelOf(account);
                return (
                  <tr key={account.id}>
                    <th scope="row">
                      {account.displayName}
                      {account.verified && <VerifiedBadge />}
                      <br />
                      <span className="field-hint">
                        {account.username ? `@${account.username}` : 'no username'} · joined {account.createdAt.slice(0, 10)}
                      </span>
                    </th>
                    <td>{account.email}</td>
                    <td>
                      {[account.isAdmin ? 'Admin' : null, account.official ? 'Official' : null, account.isCreator ? 'Creator' : 'Viewer', account.isDemo ? 'Demo' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td>
                      <span className={account.accountStatus === 'active' ? '' : 'standing-flag'}>{standingText(account)}</span>
                    </td>
                    <td>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={account.verified}
                          disabled={busyId === account.id}
                          onChange={(event) => void setVerified(account, event.target.checked)}
                          aria-label={`Verified: ${label}`}
                        />
                        {account.verified ? `Verified${account.verifiedAt ? ` since ${account.verifiedAt.slice(0, 10)}` : ''}` : 'Not verified'}
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button-quiet"
                        aria-expanded={managingId === account.id}
                        aria-controls="manage-account"
                        onClick={() => {
                          setManagingId(managingId === account.id ? null : account.id);
                          setNotice('');
                          window.setTimeout(() => document.getElementById('manage-account-heading')?.focus(), 50);
                        }}
                        aria-label={`Manage ${label}`}
                      >
                        {managingId === account.id ? 'Close' : 'Manage'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {managing && (
        <ManageAccount
          key={managing.id}
          account={managing}
          onChanged={replace}
          onDeleted={(msg) => {
            setAccounts((list) => (list ?? []).filter((a) => a.id !== managing.id));
            setManagingId(null);
            setNotice(msg);
          }}
        />
      )}
    </section>
  );
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function labelOf(account: AdminAccount): string {
  return `${account.displayName}${account.username ? ` (@${account.username})` : ''}`;
}

function standingText(account: AdminAccount): string {
  if (account.accountStatus === 'banned') return 'Banned';
  if (account.accountStatus === 'suspended') {
    return account.statusUntil ? `Suspended until ${account.statusUntil.slice(0, 10)}` : 'Suspended until restored';
  }
  return 'Active';
}

const ACTION_WORDS: Record<string, string> = {
  suspend: 'Suspended',
  ban: 'Banned',
  restore: 'Restored',
  delete: 'Deleted',
  set_password: 'Password set by staff',
};

/** Everything staff can do to one account, in one panel. */
function ManageAccount({
  account,
  onChanged,
  onDeleted,
}: {
  account: AdminAccount;
  onChanged: (a: AdminAccount | null) => void;
  onDeleted: (message: string) => void;
}) {
  const label = labelOf(account);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [emailOwner, setEmailOwner] = useState(true);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [resetLink, setResetLink] = useState<{ link: string; expiresAt: string } | null>(null);
  const [history, setHistory] = useState<AdminAccountAction[] | null>(null);
  const protectedAccount = account.isAdmin;

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiGet<{ actions: AdminAccountAction[] }>(`/api/admin/users/${account.id}/actions`);
      setHistory(data.actions);
    } catch {
      setHistory([]);
    }
  }, [account.id]);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setErr(null);
    setMsg('');
    try {
      setMsg(await work());
      await loadHistory();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const emailed = (sent: boolean) => (emailOwner ? (sent ? ' The owner was emailed.' : ' The email to the owner did not send.') : '');

  const suspend = () =>
    run(async () => {
      const d = await apiSend<{ hiddenTitles: number; hiddenComments: number; emailed: boolean; account: AdminAccount | null }>(
        'POST',
        `/api/admin/users/${account.id}/suspend`,
        { reason: reason.trim() || undefined, until: until || undefined, email: emailOwner },
      );
      onChanged(d.account);
      return `Suspended ${label}${until ? ` until ${until}` : ' until restored'}. Signed out everywhere; ${count(d.hiddenTitles, 'title')} and ${count(d.hiddenComments, 'comment')} hidden.${emailed(d.emailed)}`;
    });

  const ban = () => {
    if (!window.confirm(`Ban ${label} permanently? They cannot sign in, and their titles and comments are hidden until an admin restores the account.`)) return;
    void run(async () => {
      const d = await apiSend<{ hiddenTitles: number; hiddenComments: number; emailed: boolean; account: AdminAccount | null }>(
        'POST',
        `/api/admin/users/${account.id}/ban`,
        { reason: reason.trim() || undefined, email: emailOwner },
      );
      onChanged(d.account);
      return `Banned ${label}. Signed out everywhere; ${count(d.hiddenTitles, 'title')} and ${count(d.hiddenComments, 'comment')} hidden.${emailed(d.emailed)}`;
    });
  };

  const restore = () =>
    run(async () => {
      const d = await apiSend<{ restoredTitles: number; restoredComments: number; emailed: boolean; account: AdminAccount | null }>(
        'POST',
        `/api/admin/users/${account.id}/restore`,
        { email: emailOwner },
      );
      onChanged(d.account);
      return `Restored ${label}. ${count(d.restoredTitles, 'title')} and ${count(d.restoredComments, 'comment')} are back.${emailed(d.emailed)}`;
    });

  const setPassword = (event: FormEvent) => {
    event.preventDefault();
    if (pw.length < 8) {
      setErr('The new password must be at least 8 characters.');
      return;
    }
    if (pw !== pw2) {
      setErr('The two passwords do not match.');
      return;
    }
    void run(async () => {
      const d = await apiSend<{ emailed: boolean }>('POST', `/api/admin/users/${account.id}/password`, { password: pw });
      setPw('');
      setPw2('');
      return `New password set for ${label}. They were signed out everywhere${d.emailed ? ' and emailed that it changed' : ''}. Give them the new password privately.`;
    });
  };

  const resetHelp = (sendEmail: boolean) =>
    run(async () => {
      const d = await apiSend<{ link: string; expiresAt: string; emailed: boolean }>('POST', `/api/admin/users/${account.id}/password-reset`, {
        email: sendEmail,
      });
      if (sendEmail && d.emailed) {
        setResetLink(null);
        return `Sent a password reset link to ${account.email}. It works once, for 1 hour.`;
      }
      setResetLink({ link: d.link, expiresAt: d.expiresAt });
      return sendEmail ? 'The email did not send. Use the link below instead.' : 'Reset link ready below. It works once, for 1 hour.';
    });

  const signOutEverywhere = () => {
    if (!window.confirm(`Sign ${label} out of every device?`)) return;
    void run(async () => {
      const d = await apiSend<{ signedOut: number }>('POST', `/api/admin/users/${account.id}/sign-out-everywhere`);
      return `Signed ${label} out of ${d.signedOut} ${d.signedOut === 1 ? 'device' : 'devices'}.`;
    });
  };

  const deleteAccount = (event: FormEvent) => {
    event.preventDefault();
    if (!window.confirm(`Delete ${label} for good? Their titles, videos, comments, follows and everything else are removed. This cannot be undone.`)) return;
    setBusy(true);
    setErr(null);
    apiSend<{ deleted: boolean; label: string }>('DELETE', `/api/admin/users/${account.id}`, { confirm: confirmText })
      .then(() => onDeleted(`Deleted ${label} and everything it owned.`))
      .catch((e: unknown) => setErr(e instanceof ApiError ? e.message : 'Could not delete the account.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="manage-account" id="manage-account" aria-labelledby="manage-account-heading">
      <h3 id="manage-account-heading" tabIndex={-1}>
        Manage {label}
      </h3>
      <p>
        Standing: <strong>{standingText(account)}</strong>
        {account.statusReason ? ` · Reason: ${account.statusReason}` : ''}
      </p>
      {err && (
        <p className="status status-error" role="alert">
          {err}
        </p>
      )}
      <p className="status status-ok" role="status" aria-live="polite">
        {msg}
      </p>
      {protectedAccount ? (
        <p className="field-hint">This is an administrator account: it cannot be suspended, banned or deleted.</p>
      ) : (
        <fieldset className="manage-group" disabled={busy}>
          <legend>Suspend, ban or restore</legend>
          {account.accountStatus === 'active' ? (
            <>
              <label htmlFor="standing-reason">Reason (shown to the owner)</label>
              <input id="standing-reason" type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              <label htmlFor="standing-until">Suspend until (optional; leave empty for until restored)</label>
              <input id="standing-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              <label className="checkbox-row">
                <input type="checkbox" checked={emailOwner} onChange={(e) => setEmailOwner(e.target.checked)} />
                Email the owner
              </label>
              <div className="episode-actions">
                <button type="button" className="button" onClick={() => void suspend()}>
                  Suspend
                </button>
                <button type="button" className="button button-danger" onClick={ban}>
                  Ban permanently
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="checkbox-row">
                <input type="checkbox" checked={emailOwner} onChange={(e) => setEmailOwner(e.target.checked)} />
                Email the owner
              </label>
              <button type="button" className="button" onClick={() => void restore()}>
                Restore account
              </button>
            </>
          )}
        </fieldset>
      )}

      <form className="manage-group" onSubmit={setPassword} noValidate>
        <fieldset disabled={busy}>
          <legend>Set a new password</legend>
          <p className="field-hint">The owner is signed out everywhere and emailed that it changed. Give them the new password privately.</p>
          <label htmlFor="staff-pw">New password (at least 8 characters)</label>
          <input id="staff-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <label htmlFor="staff-pw2">Type it again</label>
          <input id="staff-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <button type="submit" className="button">
            Set password
          </button>
        </fieldset>
      </form>

      <fieldset className="manage-group" disabled={busy}>
        <legend>Sign-in help</legend>
        <div className="episode-actions">
          <button type="button" className="button button-quiet" onClick={() => void resetHelp(true)}>
            Email reset link
          </button>
          <button type="button" className="button button-quiet" onClick={() => void resetHelp(false)}>
            Get reset link
          </button>
          <button type="button" className="button button-quiet" onClick={signOutEverywhere}>
            Sign out everywhere
          </button>
        </div>
        {resetLink && (
          <div className="reset-link">
            <label htmlFor="reset-link-field">
              Reset link (works once, until {new Date(resetLink.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})
            </label>
            <div className="search-row">
              <input id="reset-link-field" type="text" readOnly value={resetLink.link} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className="button"
                onClick={() =>
                  void navigator.clipboard.writeText(resetLink.link).then(
                    () => setMsg('Reset link copied.'),
                    () => setMsg('Could not copy. Select the link field and copy it.'),
                  )
                }
              >
                Copy link
              </button>
            </div>
          </div>
        )}
      </fieldset>

      {!protectedAccount && (
        <form className="manage-group manage-danger" onSubmit={deleteAccount} noValidate>
          <fieldset disabled={busy}>
            <legend>Delete the account for good</legend>
            <p className="field-hint">
              Removes the account and everything it owns: titles, videos, comments, likes, follows, subscriptions. This cannot be undone.
            </p>
            <label htmlFor="delete-confirm">Type {account.username ? `the username (${account.username}) or ` : ''}the email to confirm</label>
            <input id="delete-confirm" type="text" autoComplete="off" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            <button type="submit" className="button button-danger" disabled={!confirmText.trim()}>
              Delete account
            </button>
          </fieldset>
        </form>
      )}

      <h4>History</h4>
      {history === null ? (
        <p>Loading…</p>
      ) : history.length === 0 ? (
        <p>No staff actions on this account.</p>
      ) : (
        <ul className="manage-history">
          {history.map((h, i) => (
            <li key={i}>
              {h.createdAt.slice(0, 16).replace('T', ' ')} UTC: {ACTION_WORDS[h.action] ?? h.action}
              {h.until ? ` until ${h.until.slice(0, 10)}` : ''}
              {h.reason ? `, reason: ${h.reason}` : ''} (by {h.actor})
              {h.restoredAt ? ', since restored' : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
