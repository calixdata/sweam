import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminOverview, AdminScoutApplication, AdminSubmission, AdminTranscodeJob } from '@sweam/shared';
import { CONTENT_KIND_LABELS, formatMillicents } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Loading } from '../components/Status';
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
  const [submissions, setSubmissions] = useState<AdminSubmission[] | null>(null);
  const [jobs, setJobs] = useState<AdminTranscodeJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [ov, apps, subs, transcode] = await Promise.all([
        apiGet<AdminOverview>('/api/admin/overview'),
        apiGet<{ applications: AdminScoutApplication[] }>('/api/admin/scout-applications'),
        apiGet<{ submissions: AdminSubmission[] }>('/api/admin/submissions'),
        apiGet<{ jobs: AdminTranscodeJob[] }>('/api/admin/transcode'),
      ]);
      setOverview(ov);
      setApplications(apps.applications);
      setSubmissions(subs.submissions);
      setJobs(transcode.jobs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the admin dashboard.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(application: AdminScoutApplication, approve: boolean) {
    try {
      await apiSend('POST', `/api/admin/scout-applications/${application.userId}/decide`, { approve });
      setNotice(`${approve ? 'Approved' : 'Rejected'} ${application.orgName}.`);
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

  async function decideSubmission(submission: AdminSubmission, accept: boolean, note: string) {
    try {
      await apiSend('POST', `/api/admin/submissions/${submission.id}/decide`, { accept, note });
      setNotice(`${accept ? 'Accepted' : 'Declined'} "${submission.titleName}".`);
      await load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Decision failed.');
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!overview || !applications || !submissions || !jobs) {
    return <Loading label="Loading the admin dashboard" />;
  }

  return (
    <div className="page page-narrow">
      <h1>Admin</h1>
      <p className="page-intro">
        Platform operations. Moderation lives on the{' '}
        <Link to="/admin/moderation">moderation page</Link>
        {overview.openReports > 0
          ? ` (${overview.openReports} open report${overview.openReports === 1 ? '' : 's'})`
          : ' (queue is empty)'}
        ; ads and payouts on the <Link to="/admin/monetization">monetization page</Link>
        {overview.pendingPayouts > 0
          ? ` (${overview.pendingPayouts} payout${overview.pendingPayouts === 1 ? '' : 's'} pending).`
          : '.'}
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
                  {overview.openReports} open reports, {overview.activeTakedowns} active takedowns
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
                <td>{overview.pendingScoutApplications} pending</td>
              </tr>
              <tr>
                <th scope="row">Content submissions</th>
                <td>{overview.pendingSubmissions} pending</td>
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

      <section aria-labelledby="admin-submissions">
        <h2 id="admin-submissions">Content submissions</h2>
        {submissions.length === 0 ? (
          <p>No pending submissions.</p>
        ) : (
          <ul className="interest-list">
            {submissions.map((submission) => (
              <li key={submission.id}>
                <h3>
                  {submission.titleName} ({CONTENT_KIND_LABELS[submission.kind]}, {submission.genre})
                </h3>
                <p>
                  From {submission.submitter.displayName} ({submission.submitter.email}
                  {submission.submitter.handle ? `, @${submission.submitter.handle}` : ''}) ·{' '}
                  {submission.createdAt.slice(0, 10)} ·{' '}
                  <a href={submission.workUrl}>Watch the screener</a>
                </p>
                <blockquote>{submission.synopsis}</blockquote>
                <SubmissionDecision
                  onDecide={(accept, note) => decideSubmission(submission, accept, note)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-scout-apps">
        <h2 id="admin-scout-apps">Scout applications</h2>
        {applications.length === 0 ? (
          <p>No pending applications.</p>
        ) : (
          <div className="table-scroll">
            <table className="studio-table">
              <caption className="visually-hidden">Pending scout applications</caption>
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Applicant</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Applied</th>
                  <th scope="col">Decision</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
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
                      {application.displayName} ({application.email})
                    </td>
                    <td>{application.contactEmail}</td>
                    <td>{application.createdAt.slice(0, 10)}</td>
                    <td>
                      <div className="episode-actions">
                        <button
                          type="button"
                          className="button"
                          onClick={() => decide(application, true)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="button button-danger"
                          onClick={() => decide(application, false)}
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

function SubmissionDecision({
  onDecide,
}: {
  onDecide: (accept: boolean, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const noteId = useMemo(() => `subnote-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div>
      <div className="field">
        <label htmlFor={noteId}>Reviewer note (shared with the submitter)</label>
        <input
          id={noteId}
          type="text"
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="episode-actions">
        <button type="button" className="button" onClick={() => onDecide(true, note)}>
          Accept
        </button>
        <button type="button" className="button button-danger" onClick={() => onDecide(false, note)}>
          Decline
        </button>
      </div>
    </div>
  );
}
