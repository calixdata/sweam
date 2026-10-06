import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminOverview, AdminTranscodeJob } from '@sweam/shared';
import { formatMillicents } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { AdminNav } from '../components/AdminNav';
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

/** The overview tab: platform counters with a link into each queue, the transcode queue, maintenance. */
function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [jobs, setJobs] = useState<AdminTranscodeJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [ov, transcode] = await Promise.all([
        apiGet<AdminOverview>('/api/admin/overview'),
        apiGet<{ jobs: AdminTranscodeJob[] }>('/api/admin/transcode'),
      ]);
      setOverview(ov);
      setJobs(transcode.jobs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the admin dashboard.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function announceReleases() {
    setNotice('Checking for newly released episodes…');
    try {
      const result = await apiSend<{ announced: number }>('POST', '/api/admin/maintenance/announce-releases');
      setNotice(
        result.announced === 0
          ? 'No scheduled episode was waiting to be announced.'
          : `Announced ${result.announced} newly released episode${result.announced === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Announcement run failed.');
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!overview || !jobs) return <Loading label="Loading the admin dashboard" />;

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <div className="page page-narrow">
      <h1>Admin</h1>
      <AdminNav />
      <p className="page-intro">
        Platform operations. Each queue has its own tab above; the counts below link straight to
        them.
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
                  creators, {overview.approvedScouts.toLocaleString()} scouts ·{' '}
                  <Link to="/admin/accounts">manage accounts</Link>
                </td>
              </tr>
              <tr>
                <th scope="row">Identity verification</th>
                <td>
                  {plural(overview.pendingVerifications, 'request')} waiting ·{' '}
                  <Link to="/admin/accounts">review</Link>
                </td>
              </tr>
              <tr>
                <th scope="row">Scout applications</th>
                <td>
                  {overview.pendingScoutApplications} to review · <Link to="/admin/scouts">open</Link>
                </td>
              </tr>
              <tr>
                <th scope="row">Content submissions</th>
                <td>
                  {overview.pendingSubmissions} pending · <Link to="/admin/submissions">open the CRM</Link>
                </td>
              </tr>
              <tr>
                <th scope="row">Moderation</th>
                <td>
                  {plural(overview.openReports, 'open report')}, {overview.activeTakedowns} active
                  takedowns, {plural(overview.pendingClips, 'clip')} awaiting review ·{' '}
                  <Link to="/admin/moderation">open</Link>
                </td>
              </tr>
              <tr>
                <th scope="row">Catalog</th>
                <td>
                  {overview.publishedTitles.toLocaleString()} published,{' '}
                  {overview.draftTitles.toLocaleString()} drafts ·{' '}
                  <Link to="/admin/video">swap a video</Link>
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
                <th scope="row">Advertising</th>
                <td>
                  {formatMillicents(overview.revenueMillicents)} gross revenue,{' '}
                  {plural(overview.pendingPayouts, 'payout')} pending ·{' '}
                  <Link to="/admin/monetization">open</Link>
                </td>
              </tr>
              <tr>
                <th scope="row">Transcode queue</th>
                <td>
                  {overview.transcode.queued} queued, {overview.transcode.running} running,{' '}
                  {overview.transcode.failed} failed
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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
          HLS cleanup deletes outputs left behind by superseded, canceled, and failed transcode
          jobs; the current output of every episode is never touched. The release check announces
          any scheduled episode that has unlocked since the last ten-minute run.
        </p>
        <div className="title-actions">
          <button type="button" className="button" onClick={runHlsGc}>
            Run HLS cleanup
          </button>
          <button type="button" className="button button-quiet" onClick={() => void announceReleases()}>
            Announce released episodes now
          </button>
        </div>
      </section>
    </div>
  );
}
