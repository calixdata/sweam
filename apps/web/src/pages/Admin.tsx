import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FormEvent } from 'react';
import type {
  AdminAccount,
  AdminOverview,
  AdminScoutApplication,
  AdminTranscodeJob,
  AdminVerificationRequest,
} from '@sweam/shared';
import { formatMillicents } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { usePageTitle } from '../hooks';

export function Admin() {
  usePageTitle('Admin');
  const { user, loading } = useAuth();

  if (loading) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>Admin</h1>
        <p>This area is for Sweam administrators.</p>
      </div>
    );
  }
  return <AdminDashboard />;
}

function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [applications, setApplications] = useState<AdminScoutApplication[] | null>(null);
  const [jobs, setJobs] = useState<AdminTranscodeJob[] | null>(null);
  const [verifications, setVerifications] = useState<AdminVerificationRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [ov, apps, transcode, verifs] = await Promise.all([
        apiGet<AdminOverview>('/api/admin/overview'),
        apiGet<{ applications: AdminScoutApplication[] }>('/api/admin/scout-applications'),
        apiGet<{ jobs: AdminTranscodeJob[] }>('/api/admin/transcode'),
        apiGet<{ requests: AdminVerificationRequest[] }>('/api/admin/verifications'),
      ]);
      setOverview(ov);
      setApplications(apps.applications);
      setJobs(transcode.jobs);
      setVerifications(verifs.requests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the admin dashboard.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(application: AdminScoutApplication, approve: boolean) {
    const awaitingCard = application.status === 'pending';
    if (
      !approve &&
      !window.confirm(
        awaitingCard
          ? `Reject the scout application from ${application.orgName}?`
          : `Revoke scout access for ${application.orgName}? Their membership will be canceled so they are not billed again.`,
      )
    ) {
      return;
    }
    try {
      const res = await apiSend<{ status: string; billingWarning: string | null }>(
        'POST',
        `/api/admin/scout-applications/${application.userId}/decide`,
        { approve },
      );
      const verb = approve
        ? awaitingCard
          ? 'Approved'
          : 'Confirmed'
        : awaitingCard
          ? 'Rejected'
          : 'Revoked';
      setNotice(
        `${verb} ${application.orgName}.${
          res.billingWarning
            ? ` Billing warning: the Stripe subscription could not be canceled automatically (${res.billingWarning}). Cancel it in the Stripe dashboard.`
            : ''
        }`,
      );
      await load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Decision failed.');
    }
  }

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

  async function requeue(job: AdminTranscodeJob) {
    try {
      await apiSend('POST', `/api/admin/transcode/${job.id}/requeue`);
      setNotice(`Requeued the transcode for ${job.titleName}: ${job.episodeName}.`);
      await load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Requeue failed.');
    }
  }

  async function runHlsGc() {
    setNotice('Running HLS cleanup…');
    try {
      const result = await apiSend<{ sweptJobs: number; deletedObjects: number; more: boolean }>(
        'POST',
        '/api/admin/maintenance/hls-gc',
      );
      setNotice(
        `Cleanup swept ${result.sweptJobs} jobs and deleted ${result.deletedObjects} objects.` +
          (result.more ? ' More remain; run it again.' : ' Nothing further to sweep.'),
      );
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Cleanup failed.');
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!overview || !applications || !jobs || !verifications) {
    return <Loading label="Loading the admin dashboard" />;
  }

  return (
    <div className="page page-narrow">
      <h1>Admin</h1>
      <p className="page-intro">
        Platform operations. Content submissions have their own{' '}
        <Link to="/admin/submissions">review CRM</Link>
        {overview.pendingSubmissions > 0
          ? ` (${overview.pendingSubmissions} pending)`
          : ' (queue is empty)'}
        ; moderation lives on the <Link to="/admin/moderation">moderation page</Link>
        {overview.openReports > 0
          ? ` (${overview.openReports} open report${overview.openReports === 1 ? '' : 's'})`
          : ' (queue is empty)'}
        ; ads and payouts on the <Link to="/admin/monetization">monetization page</Link>
        {overview.pendingPayouts > 0
          ? ` (${overview.pendingPayouts} payout${overview.pendingPayouts === 1 ? '' : 's'} pending)`
          : ''}
        ; swap a live episode's video on the <Link to="/admin/video">video page</Link>.
      </p>

      {notice && (
        <p className="status" role="status">
          {notice}
        </p>
      )}

      <section aria-labelledby="admin-overview">
        <h2 id="admin-overview">Overview</h2>
        <div className="table-scroll">
          <table className="studio-table">
            <caption className="visually-hidden">Platform counters</caption>
            <tbody>
              <tr>
                <th scope="row">Accounts</th>
                <td>
                  {overview.users.toLocaleString()} users, {overview.creators.toLocaleString()}{' '}
                  creators, {overview.approvedScouts.toLocaleString()} scouts
                </td>
              </tr>
              <tr>
                <th scope="row">Catalog</th>
                <td>
                  {overview.publishedTitles.toLocaleString()} published,{' '}
                  {overview.draftTitles.toLocaleString()} drafts
                </td>
              </tr>
              <tr>
                <th scope="row">Viewing</th>
                <td>
                  {overview.totalPlays.toLocaleString()} plays,{' '}
                  {overview.totalWatchHours.toLocaleString()} watch hours
                </td>
              </tr>
              <tr>
                <th scope="row">Moderation</th>
                <td>
                  {overview.openReports} open reports, {overview.activeTakedowns} active takedowns,{' '}
                  {overview.pendingClips} clip{overview.pendingClips === 1 ? '' : 's'} awaiting review
                </td>
              </tr>
              <tr>
                <th scope="row">Transcode queue</th>
                <td>
                  {overview.transcode.queued} queued, {overview.transcode.running} running,{' '}
                  {overview.transcode.failed} failed
                </td>
              </tr>
              <tr>
                <th scope="row">Scout applications</th>
                <td>{overview.pendingScoutApplications} to review</td>
              </tr>
              <tr>
                <th scope="row">Content submissions</th>
                <td>
                  {overview.pendingSubmissions} pending ·{' '}
                  <Link to="/admin/submissions">open the CRM</Link>
                </td>
              </tr>
              <tr>
                <th scope="row">Advertising</th>
                <td>
                  {formatMillicents(overview.revenueMillicents)} gross revenue,{' '}
                  {overview.pendingPayouts} payout{overview.pendingPayouts === 1 ? '' : 's'} pending
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="admin-scout-apps">
        <h2 id="admin-scout-apps">Scout applications</h2>
        <p className="field-hint">
          Scouts are approved automatically, and provisionally, once they accept the Scout Program
          terms and put a card on file. Confirm a provisional scout to clear the flag, or revoke to
          remove access and cancel their billing. <em>Awaiting card</em> means the applicant has not
          finished checkout.
        </p>
        {applications.length === 0 ? (
          <p>No scout applications to review.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">Scout applications to review</caption>
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Applicant</th>
                  <th scope="col">Work email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Applied</th>
                  <th scope="col">Decision</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => {
                  const awaitingCard = application.status === 'pending';
                  const fullName =
                    [application.firstName, application.lastName].filter(Boolean).join(' ') ||
                    application.displayName;
                  return (
                    <tr key={application.userId}>
                      <th scope="row">
                        {application.orgName}
                        {application.orgUrl && (
                          <>
                            {' '}
                            (<a href={application.orgUrl}>website</a>)
                          </>
                        )}
                      </th>
                      <td>
                        {fullName}
                        {application.position ? `, ${application.position}` : ''}
                        <br />
                        <span className="field-hint">Account: {application.email}</span>
                      </td>
                      <td>{application.workEmail ?? application.contactEmail}</td>
                      <td>
                        {awaitingCard ? 'Awaiting card' : 'Provisional'}
                        {application.betaFree ? ' · first 50, free trial' : ''}
                      </td>
                      <td>{application.createdAt.slice(0, 10)}</td>
                      <td>
                        <div className="episode-actions">
                          <button
                            type="button"
                            className="button"
                            onClick={() => decide(application, true)}
                          >
                            {awaitingCard ? 'Approve' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="button button-danger"
                            onClick={() => decide(application, false)}
                          >
                            {awaitingCard ? 'Reject' : 'Revoke'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AccountsSection />

      <section aria-labelledby="admin-verifications">
        <h2 id="admin-verifications">Identity verification</h2>
        <p className="field-hint">
          Requests from accounts that uploaded a government ID and a proof of address. Open both
          documents, check that the name and address match, then verify or reject. Either decision
          deletes the documents; only the decision is kept.
        </p>
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

      <section aria-labelledby="admin-transcode">
        <h2 id="admin-transcode">Transcode queue</h2>
        {jobs.length === 0 ? (
          <p>No active or failed jobs.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">Active and failed transcode jobs</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Episode</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Error</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <th scope="row">{job.titleName}</th>
                    <td>{job.episodeName}</td>
                    <td>{job.status}</td>
                    <td>{job.attempts}</td>
                    <td>{job.error ?? ''}</td>
                    <td>
                      {job.status === 'failed' && (
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => requeue(job)}
                        >
                          Requeue
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="admin-maintenance">
        <h2 id="admin-maintenance">Maintenance</h2>
        <p className="page-intro">
          Deletes HLS outputs left behind by superseded, canceled, and failed transcode jobs. The
          current output of every episode is never touched.
        </p>
        <button type="button" className="button" onClick={runHlsGc}>
          Run HLS cleanup
        </button>
      </section>
    </div>
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
      <h2 id="admin-accounts">Accounts</h2>
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
