import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SubmissionItem } from '@sweam/shared';
import {
  CONTENT_KINDS,
  CONTENT_KIND_LABELS,
  CREATOR_REVENUE_SHARE,
  GENRES,
  MIN_PAYOUT_MILLICENTS,
  MONETIZATION_THRESHOLDS,
  formatMillicents,
} from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { usePageTitle } from '../hooks';

const SHARE_PERCENT = Math.round(CREATOR_REVENUE_SHARE * 100);

export function Submit() {
  usePageTitle('Submit your work');
  const { user } = useAuth();

  return (
    <div className="page page-narrow">
      <h1>Submit your work to Sweam</h1>
      <p className="page-intro">
        Sweam is free streaming built for independent creators: films, series, shorts, and
        documentaries presented like a catalog, discovered on finish rate instead of follower
        count. Two ways in: submit finished work here for review, or publish directly through the
        Studio once you have a creator profile.
      </p>

      <section aria-labelledby="submit-deal">
        <h2 id="submit-deal">The deal, in numbers</h2>
        <ul>
          <li>
            Free to watch, ad-supported. Creators keep <strong>{SHARE_PERCENT}%</strong> of the ad
            revenue earned on their titles: one published split, the same for everyone, no
            negotiation.
          </li>
          <li>
            Payouts unlock at {formatMillicents(MIN_PAYOUT_MILLICENTS)} of earnings, far below the
            $100 floors common elsewhere.
          </li>
          <li>
            Monetization opens at {MONETIZATION_THRESHOLDS.minFollowers} followers,{' '}
            {Math.round(MONETIZATION_THRESHOLDS.minWatchSeconds / 60).toLocaleString()} watch
            minutes, and {MONETIZATION_THRESHOLDS.minPublishedTitles} published title
            {MONETIZATION_THRESHOLDS.minPublishedTitles === 1 ? '' : 's'}, with an account in good
            standing. Your earnings page tracks progress toward each threshold.
          </li>
          <li>
            The full policy, including how these numbers compare to YouTube, TikTok, Meta, Tubi,
            and Netflix, lives in the public{' '}
            <a href="https://github.com/calixdata/sweam/blob/main/docs/CREATOR-PROGRAM.md">
              Creator Program document
            </a>
            .
          </li>
        </ul>
      </section>

      <section aria-labelledby="submit-review">
        <h2 id="submit-review">What review looks for</h2>
        <ul>
          <li>You hold the rights to the work (confirmed with your submission).</li>
          <li>The work is original and finished: no reposts, no rips.</li>
          <li>It fits a catalog category with honest metadata.</li>
          <li>
            Not considered: follower counts elsewhere, agents, or distributors. Discovery here is
            equal-visibility by design.
          </li>
        </ul>
      </section>

      {user ? (
        <SubmissionArea />
      ) : (
        <p className="status">
          <Link to="/signin" state={{ from: '/submit' }}>
            Sign in
          </Link>{' '}
          or{' '}
          <Link to="/signup" state={{ from: '/submit' }}>
            create a free account
          </Link>{' '}
          to submit your work.
        </p>
      )}
    </div>
  );
}

function SubmissionArea() {
  const [mine, setMine] = useState<SubmissionItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ submissions: SubmissionItem[] }>('/api/submissions/mine');
      setMine(data.submissions);
    } catch {
      setMine([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <SubmissionForm onSubmitted={load} />
      <section aria-labelledby="my-submissions">
        <h2 id="my-submissions">Your submissions</h2>
        {!mine || mine.length === 0 ? (
          <p>No submissions yet.</p>
        ) : (
          <ul className="interest-list">
            {mine.map((submission) => (
              <li key={submission.id}>
                <h3>
                  {submission.titleName} ({CONTENT_KIND_LABELS[submission.kind]},{' '}
                  {submission.genre})
                </h3>
                <p>
                  Status: <strong>{submission.status}</strong> · submitted{' '}
                  {submission.createdAt.slice(0, 10)}
                  {submission.decidedAt ? `, decided ${submission.decidedAt.slice(0, 10)}` : ''}
                </p>
                {submission.note && <blockquote>Reviewer note: {submission.note}</blockquote>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function SubmissionForm({ onSubmitted }: { onSubmitted: () => Promise<void> }) {
  const [titleName, setTitleName] = useState('');
  const [kind, setKind] = useState<string>('film');
  const [genre, setGenre] = useState<string>(GENRES[0]);
  const [synopsis, setSynopsis] = useState('');
  const [workUrl, setWorkUrl] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/submissions', {
        titleName,
        kind,
        genre,
        synopsis,
        workUrl,
        rightsConfirmed,
      });
      setSent(true);
      setTitleName('');
      setSynopsis('');
      setWorkUrl('');
      setRightsConfirmed(false);
      await onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the submission.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="submission-form-heading">
      <h2 id="submission-form-heading">Submit a work</h2>
      {sent && (
        <p className="status" role="status">
          Submission received. A reviewer will look at it; you will get a notification either way.
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate className="studio-form">
        <div className="field">
          <label htmlFor="sub-name">Title of the work</label>
          <input
            id="sub-name"
            type="text"
            required
            maxLength={120}
            value={titleName}
            onChange={(event) => setTitleName(event.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sub-kind">Kind</label>
            <select id="sub-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              {CONTENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {CONTENT_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sub-genre">Genre</label>
            <select id="sub-genre" value={genre} onChange={(event) => setGenre(event.target.value)}>
              {GENRES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="sub-synopsis">About the work</label>
          <textarea
            id="sub-synopsis"
            rows={4}
            required
            maxLength={2000}
            aria-describedby="sub-synopsis-hint"
            value={synopsis}
            onChange={(event) => setSynopsis(event.target.value)}
          />
          <p className="field-hint" id="sub-synopsis-hint">
            What it is, how long it is, and anything a reviewer should know. At least a couple of
            sentences.
          </p>
        </div>
        <div className="field">
          <label htmlFor="sub-url">Screener link (https)</label>
          <input
            id="sub-url"
            type="url"
            required
            placeholder="https://"
            aria-describedby="sub-url-hint"
            value={workUrl}
            onChange={(event) => setWorkUrl(event.target.value)}
          />
          <p className="field-hint" id="sub-url-hint">
            A link where reviewers can watch the work: an unlisted upload, a screener page, or a
            portfolio.
          </p>
        </div>
        <div className="field field-checkbox">
          <input
            id="sub-rights"
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          <label htmlFor="sub-rights">
            I confirm I hold the rights to this work and the authority to license it for streaming.
          </label>
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Sending…' : 'Submit for review'}
        </button>
      </form>
    </section>
  );
}
