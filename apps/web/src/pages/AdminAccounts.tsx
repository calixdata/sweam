import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AdminAccount, AdminVerificationRequest } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { AdminNav } from '../components/AdminNav';
import { ErrorNote, Loading } from '../components/Status';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { usePageTitle } from '../hooks';

/** Admin: find any account, grant or remove the verified check, and review identity documents. */
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
    if (!approve) {
      const answer = window.prompt(
        `Reason the request from ${request.legalName} is not approved (shown to them; optional):`,
        '',
      );
      if (answer === null) return;
      note = answer.trim();
    } else if (!window.confirm(`Mark ${request.legalName} (@${request.username ?? 'unknown'}) as verified?`)) {
      return;
    }
    try {
      await apiSend('POST', `/api/admin/verifications/${request.id}/decide`, { approve, note });
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
 * Accounts: find any account by username, name, or email and grant or remove
 * the verified check with one checkbox. Granting by hand also closes a pending
 * document request for that account.
 */
function AccountsSection() {
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    setSearching(true);
    try {
      const data = await apiGet<{ accounts: AdminAccount[] }>(
        `/api/admin/users?q=${encodeURIComponent(term)}`,
      );
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
      const data = await apiSend<{ account: AdminAccount | null }>(
        'POST',
        `/api/admin/users/${account.id}/verified`,
        { verified },
      );
      if (data.account) {
        const updated = data.account;
        setAccounts((list) => (list ?? []).map((a) => (a.id === updated.id ? updated : a)));
      }
      setNotice(
        `${verified ? 'Verified' : 'Removed the verified check from'} ${account.displayName}${
          account.username ? ` (@${account.username})` : ''
        }.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that account.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="admin-accounts">
      <h2 id="admin-accounts">Find an account</h2>
      <p className="field-hint">
        Find an account and tick Verified to grant the pink check right away, or untick it to
        remove it. The account is notified either way.
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
                <th scope="col">Verified</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const label = `${account.displayName}${account.username ? ` (@${account.username})` : ''}`;
                return (
                  <tr key={account.id}>
                    <th scope="row">
                      {account.displayName}
                      {account.verified && <VerifiedBadge />}
                      <br />
                      <span className="field-hint">
                        {account.username ? `@${account.username}` : 'no username'} · joined{' '}
                        {account.createdAt.slice(0, 10)}
                      </span>
                    </th>
                    <td>{account.email}</td>
                    <td>
                      {[
                        account.official ? 'Official' : null,
                        account.isCreator ? 'Creator' : 'Viewer',
                        account.isDemo ? 'Demo' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
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
                        {account.verified
                          ? `Verified${account.verifiedAt ? ` since ${account.verifiedAt.slice(0, 10)}` : ''}`
                          : 'Not verified'}
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
