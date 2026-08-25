import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { StudioTitleDetail, TitleAnalytics } from '@sweam/shared';
import { ApiError, apiGet } from '../api';
import { DailyTable } from '../components/DailyTable';
import { RetentionTable } from '../components/RetentionTable';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function StudioAnalytics() {
  const { titleId } = useParams<{ titleId: string }>();
  const [title, setTitle] = useState<StudioTitleDetail | null>(null);
  const [analytics, setAnalytics] = useState<TitleAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(title ? `Analytics: ${title.name}` : 'Analytics');

  useEffect(() => {
    if (!titleId) return;
    let cancelled = false;
    Promise.all([
      apiGet<StudioTitleDetail>(`/api/studio/titles/${encodeURIComponent(titleId)}`),
      apiGet<TitleAnalytics>(`/api/studio/titles/${encodeURIComponent(titleId)}/analytics`),
    ])
      .then(([detail, data]) => {
        if (cancelled) return;
        setTitle(detail);
        setAnalytics(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load analytics.');
      });
    return () => {
      cancelled = true;
    };
  }, [titleId]);

  if (error) return <ErrorNote message={error} />;
  if (!title || !analytics) return <Loading label="Loading analytics" />;

  return (
    <div className="page page-narrow">
      <p>
        <Link to={`/studio/t/${title.id}`}>Back to the title editor</Link>
      </p>
      <h1>Analytics: {title.name}</h1>
      <p className="title-meta">
        {analytics.scoutable
          ? 'Visible in the scout portal. Scouts see the same numbers on this page; every one-sheet view is logged below.'
          : 'Not visible in the scout portal. Turn on scout visibility in the title editor to appear on the boards.'}
      </p>

      <section aria-labelledby="analytics-daily">
        <h2 id="analytics-daily">Last 14 days</h2>
        <DailyTable daily={analytics.daily} />
      </section>

      <section aria-labelledby="analytics-retention">
        <h2 id="analytics-retention">Audience retention</h2>
        <p className="page-intro">
          From tracked viewers: the share whose furthest position reached each point of the
          runtime. Where the curve drops is where you are losing people.
        </p>
        <RetentionTable retention={analytics.retention} />
      </section>

      <section aria-labelledby="analytics-views">
        <h2 id="analytics-views">One-sheet views</h2>
        {analytics.oneSheetViews.length === 0 ? (
          <p>No scout has opened this title's one-sheet yet.</p>
        ) : (
          <ul>
            {analytics.oneSheetViews.map((view, index) => (
              <li key={`${view.orgName}-${view.viewedAt}-${index}`}>
                {view.orgName} viewed your one-sheet on {view.viewedAt.slice(0, 10)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="analytics-interests">
        <h2 id="analytics-interests">Scout interest</h2>
        {analytics.interests.length === 0 ? (
          <p>No interest expressed yet.</p>
        ) : (
          <ul className="interest-list">
            {analytics.interests.map((interest) => (
              <li key={`${interest.orgName}-${interest.createdAt}`}>
                <h3>{interest.orgName}</h3>
                <p>
                  {interest.createdAt.slice(0, 10)} · contact:{' '}
                  <a href={`mailto:${interest.contactEmail}`}>{interest.contactEmail}</a>
                  {interest.orgUrl && (
                    <>
                      {' '}
                      · <a href={interest.orgUrl}>website</a>
                    </>
                  )}
                </p>
                {interest.note && <blockquote>{interest.note}</blockquote>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
