import { useCallback, useEffect, useState } from 'react';
import type { AdminScoutApplication } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { AdminNav } from '../components/AdminNav';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

/** Admin: scout applications to confirm, approve, reject, or revoke. */
export function AdminScouts() {
  usePageTitle('Scouts');
  const { user, loading } = useAuth();

  if (loading) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>Scouts</h1>
        <p>This area is for Sweam administrators.</p>
      </div>
    );
  }
  return <ScoutApplications />;
}

function ScoutApplications() {
  const [applications, setApplications] = useState<AdminScoutApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ applications: AdminScoutApplication[] }>('/api/admin/scout-applications');
      setApplications(data.applications);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load scout applications.');
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
      const res = await apiSend<{ status: string; billingWarning: string | null; freeUntil: string | null }>(
        'POST',
        `/api/admin/scout-applications/${application.userId}/decide`,
        { approve },
      );
      const verb = approve ? (awaitingCard ? 'Approved' : 'Confirmed') : awaitingCard ? 'Rejected' : 'Revoked';
      setNotice(
        `${verb} ${application.orgName}.${
          res.freeUntil ? ` Their membership is free until ${res.freeUntil.slice(0, 10)}.` : ''
        }${
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

  if (error) return <ErrorNote message={error} />;
  if (!applications) return <Loading label="Loading scout applications" />;

  return (
    <div className="page page-narrow">
      <h1>Scouts</h1>
      <AdminNav />
      <section aria-labelledby="admin-scout-apps">
        <h2 id="admin-scout-apps">Scout applications</h2>
        <p className="field-hint">
          Scouts are approved automatically, and provisionally, once they accept the Scout Program
          terms and put a card on file. Confirm a provisional scout to clear the flag, or revoke to
          remove access and cancel their billing. <em>Awaiting card</em> means the applicant has not
          finished checkout; approving one by hand starts a first-50 free membership while seats
          remain.
        </p>
        {notice && (
          <p className="status" role="status">
            {notice}
          </p>
        )}
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
                          <button type="button" className="button" onClick={() => decide(application, true)}>
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
    </div>
  );
}
