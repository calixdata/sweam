import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OneSheet, ScoutOfferKind } from '@sweam/shared';
import {
  CONTENT_KIND_LABELS,
  SCOUT_OFFER_KINDS,
  SCOUT_OFFER_KIND_LABELS,
  SCOUT_PROMO_MAX_PERCENT,
} from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { DailyTable } from '../components/DailyTable';
import { EpisodeViewsTable } from '../components/EpisodeViewsTable';
import { RetentionTable } from '../components/RetentionTable';
import { ErrorNote, Loading } from '../components/Status';
import { usePageTitle } from '../hooks';

export function ScoutOneSheet() {
  const { titleId } = useParams<{ titleId: string }>();
  const [sheet, setSheet] = useState<OneSheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(sheet ? `One-sheet: ${sheet.title.name}` : 'One-sheet');

  useEffect(() => {
    if (!titleId) return;
    let cancelled = false;
    apiGet<OneSheet>(`/api/scout/titles/${encodeURIComponent(titleId)}/onesheet`)
      .then((data) => {
        if (!cancelled) setSheet(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the one-sheet.');
      });
    return () => {
      cancelled = true;
    };
  }, [titleId]);

  if (error) return <ErrorNote message={error} />;
  if (!sheet) return <Loading label="Loading one-sheet" />;

  const { title, stats } = sheet;
  const finishPercent = stats.plays > 0 ? Math.round((stats.completes / stats.plays) * 100) : 0;
  const watchHours = Math.round(stats.watchSeconds / 3600);

  return (
    <div className="page page-narrow">
      <p>
        <Link to="/scout">Back to the boards</Link>
      </p>
      <h1>{title.name}</h1>
      <p className="title-meta">
        {CONTENT_KIND_LABELS[title.kind]} · {title.genre} · {title.advisory} · published{' '}
        {title.publishedAt?.slice(0, 10) ?? 'recently'} ·{' '}
        <Link to={`/t/${title.slug}`}>Public page</Link>
      </p>
      <p>
        By <strong>{title.creator.displayName}</strong> (@{title.creator.handle})
        {sheet.creatorVerified ? ', verified creator' : ''}. {sheet.creatorBio}
      </p>
      <p className="title-synopsis">{title.synopsis}</p>

      <section aria-labelledby="onesheet-lifetime">
        <h2 id="onesheet-lifetime">Lifetime performance</h2>
        <div className="table-scroll">
          <table className="studio-table">
            <caption className="visually-hidden">Lifetime counters for this title</caption>
            <thead>
              <tr>
                <th scope="col">Plays</th>
                <th scope="col">Finishes</th>
                <th scope="col">Finish rate</th>
                <th scope="col">Likes</th>
                <th scope="col">Impressions</th>
                <th scope="col">Watch time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{stats.plays.toLocaleString()}</td>
                <td>{stats.completes.toLocaleString()}</td>
                <td>{finishPercent}%</td>
                <td>{stats.likes.toLocaleString()}</td>
                <td>{stats.impressions.toLocaleString()}</td>
                <td>{watchHours.toLocaleString()} hours</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {(title.kind === 'series' || title.kind === 'reality' || sheet.episodes.length > 1) && (
        <section aria-labelledby="onesheet-episodes">
          <h2 id="onesheet-episodes">Views by episode</h2>
          <p className="page-intro">
            Viewers who started each episode and how many of them reached the end.
          </p>
          <EpisodeViewsTable episodes={sheet.episodes} />
        </section>
      )}

      <section aria-labelledby="onesheet-daily">
        <h2 id="onesheet-daily">Last 14 days</h2>
        <DailyTable daily={sheet.daily} />
      </section>

      <section aria-labelledby="onesheet-retention">
        <h2 id="onesheet-retention">Audience retention</h2>
        <p className="page-intro">
          From the tracked viewer cohort: the share of viewers whose furthest position reached each
          point of the runtime.
        </p>
        <RetentionTable retention={sheet.retention} />
      </section>

      <InterestSection
        titleId={title.id}
        titleName={title.name}
        alreadyInterested={sheet.myInterest}
      />

      <OfferSection titleId={title.id} titleName={title.name} />
    </div>
  );
}

/** Make the creator an offer: sign externally, or a Sweam promotion deal. */
function OfferSection({ titleId, titleName }: { titleId: string; titleName: string }) {
  const [kind, setKind] = useState<ScoutOfferKind>('external_sign');
  const [message, setMessage] = useState('');
  const [percent, setPercent] = useState('20');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { kind, message };
      if (kind === 'sweam_promo') payload.promoPercent = Number(percent);
      await apiSend('POST', `/api/scout/titles/${titleId}/offer`, payload);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your offer.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <section aria-labelledby="onesheet-offer">
        <h2 id="onesheet-offer">Make an offer</h2>
        <p className="status status-ok" role="status">
          Offer sent to the creator of {titleName}. You'll be notified when they accept or decline.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="onesheet-offer">
      <h2 id="onesheet-offer">Make an offer</h2>
      <p className="page-intro">
        Offer to sign this work to your own network (handled off Sweam), or propose a Sweam promotion
        deal: you promote it for a share of its earnings and it is labelled "Promoted by your
        organization".
      </p>
      <form onSubmit={handleSubmit} noValidate className="studio-form">
        <div className="field">
          <label htmlFor="offer-kind">Offer type</label>
          <select
            id="offer-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as ScoutOfferKind)}
          >
            {SCOUT_OFFER_KINDS.map((k) => (
              <option key={k} value={k}>
                {SCOUT_OFFER_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {kind === 'sweam_promo' && (
          <div className="field">
            <label htmlFor="offer-percent">Your share of this title's earnings (%)</label>
            <input
              id="offer-percent"
              type="number"
              min={1}
              max={SCOUT_PROMO_MAX_PERCENT}
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              aria-describedby="offer-percent-hint"
            />
            <p className="field-hint" id="offer-percent-hint">
              Up to {SCOUT_PROMO_MAX_PERCENT}%. This comes from the creator's own earnings on this
              title; they have to accept it.
            </p>
          </div>
        )}
        <div className="field">
          <label htmlFor="offer-message">Message to the creator</label>
          <textarea
            id="offer-message"
            rows={3}
            maxLength={1000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send offer'}
        </button>
      </form>
    </section>
  );
}

function InterestSection({
  titleId,
  titleName,
  alreadyInterested,
}: {
  titleId: string;
  titleName: string;
  alreadyInterested: boolean;
}) {
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(alreadyInterested);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', `/api/scout/titles/${titleId}/interest`, { note });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your interest.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <section aria-labelledby="onesheet-interest">
        <h2 id="onesheet-interest">Interest</h2>
        <p className="status" role="status">
          Interest sent. The creator of {titleName} can see your organization, note, and contact
          email in their Studio.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="onesheet-interest">
      <h2 id="onesheet-interest">Express interest</h2>
      <form onSubmit={handleSubmit} noValidate className="studio-form">
        <div className="field">
          <label htmlFor="interest-note">Note to the creator (optional)</label>
          <textarea
            id="interest-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send interest to the creator'}
        </button>
      </form>
    </section>
  );
}
