import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { StudioTitleDetail, VerbatiimJob, VerbatiimMode, VerbatiimStatus } from '@sweam/shared';
import { VERBATIIM_DAILY_LIMIT, VERBATIIM_MODE_LABELS, VERBATIIM_NAME } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { formatDuration } from '../hooks';

const STATUS_WORDS: Record<VerbatiimJob['status'], string> = {
  queued: 'Waiting to start',
  running: 'Being made',
  importing: 'Copying into Sweam',
  done: 'Added to this title',
  failed: 'Stopped',
};

const TEXT_LABELS: Record<VerbatiimMode, [string, string]> = {
  adapt: ['Passage to adapt', 'Paste your prose. Quoted lines become dialogue, everything else becomes narration. Nothing is rewritten.'],
  fountain: ['Screenplay', 'Paste a script in Fountain format: scene headings like INT. or EXT., character names in capitals, dialogue under them.'],
  prompt: ['Your one prompt', 'Describe the episode: premise, world, tone, who it follows. The story is written for you.'],
};

function nextEpisodeNumber(title: StudioTitleDetail, season: number): number {
  const used = title.episodes.filter((e) => e.season === season).map((e) => e.episode);
  return used.length ? Math.max(...used) + 1 : 1;
}

/**
 * "Make an episode with Verbatiim": paste prose, a screenplay, or a prompt,
 * and the finished film arrives as an ordinary episode, with captions, an
 * audio-description track, story-aware clips, and signed credits.
 */
export function VerbatiimPanel({ title, onChanged }: { title: StudioTitleDetail; onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<VerbatiimStatus | null>(null);
  const [jobs, setJobs] = useState<VerbatiimJob[]>([]);
  const [announce, setAnnounce] = useState('');
  const seen = useRef(new Map<string, VerbatiimJob['status']>());

  const loadJobs = useCallback(async () => {
    const data = await apiGet<{ jobs: VerbatiimJob[] }>(`/api/studio/verbatiim/titles/${title.id}/jobs`);
    // Announce only transitions, so a screen reader is not flooded by polling.
    let finished = false;
    for (const job of data.jobs) {
      const before = seen.current.get(job.id);
      if (before && before !== job.status) {
        setAnnounce(`${job.name}: ${STATUS_WORDS[job.status]}.`);
        if (job.status === 'done') finished = true;
      }
      seen.current.set(job.id, job.status);
    }
    setJobs(data.jobs);
    if (finished) await onChanged();
  }, [title.id, onChanged]);

  useEffect(() => {
    apiGet<VerbatiimStatus>('/api/studio/verbatiim/status')
      .then(setStatus)
      .catch(() => setStatus({ connected: false, name: VERBATIIM_NAME }));
    void loadJobs().catch(() => undefined);
  }, [loadJobs]);

  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running' || j.status === 'importing');
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void loadJobs().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [active, loadJobs]);

  async function checkNow(job: VerbatiimJob) {
    try {
      const fresh = await apiSend<VerbatiimJob>('POST', `/api/studio/verbatiim/jobs/${job.id}/refresh`);
      setAnnounce(`${fresh.name}: ${STATUS_WORDS[fresh.status]}.`);
      await loadJobs();
      if (fresh.status === 'done') await onChanged();
    } catch (err) {
      setAnnounce(err instanceof ApiError ? err.message : 'Could not check right now.');
    }
  }

  return (
    <section aria-labelledby="verbatiim-heading">
      <h2 id="verbatiim-heading">Make an episode with {VERBATIIM_NAME}</h2>
      <p>
        Paste your prose, a screenplay, or one prompt. {VERBATIIM_NAME} makes the episode with captions, an
        audio-description track, and short story-aware clips, and signs a record of whose words it used. It arrives
        here as a normal episode you can edit before publishing.
      </p>
      <p className="status" role="status" aria-live="polite">
        {announce}
      </p>
      {status && !status.connected ? (
        <p className="status">{VERBATIIM_NAME} is not connected on this server yet.</p>
      ) : (
        status && <StartForm title={title} onStarted={loadJobs} />
      )}
      {jobs.length > 0 && (
        <>
          <h3>{VERBATIIM_NAME} jobs</h3>
          <ol className="episode-list">
            {jobs.map((job) => (
              <li key={job.id}>
                <JobCard job={job} onCheck={() => checkNow(job)} />
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function StartForm({ title, onStarted }: { title: StudioTitleDetail; onStarted: () => Promise<void> }) {
  const [mode, setMode] = useState<VerbatiimMode>('adapt');
  const [name, setName] = useState('');
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(() => nextEpisodeNumber(title, 1));
  const [synopsis, setSynopsis] = useState('');
  const [text, setText] = useState('');
  const [clipCount, setClipCount] = useState(3);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [label, hint] = TEXT_LABELS[mode];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!rightsConfirmed) {
      setError('Confirm you hold the rights to this text.');
      return;
    }
    setSubmitting(true);
    try {
      await apiSend('POST', `/api/studio/verbatiim/titles/${title.id}/jobs`, {
        mode,
        name,
        season,
        episode,
        synopsis,
        text,
        clipCount,
        rightsConfirmed: true,
      });
      setText('');
      setName('');
      setSynopsis('');
      setEpisode((n) => n + 1);
      setRightsConfirmed(false);
      await onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the episode.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="studio-form">
      <div className="field">
        <label htmlFor="vb-mode">Starting point</label>
        <select id="vb-mode" value={mode} onChange={(event) => setMode(event.target.value as VerbatiimMode)}>
          {(Object.keys(VERBATIIM_MODE_LABELS) as VerbatiimMode[]).map((m) => (
            <option key={m} value={m}>
              {VERBATIIM_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="vb-season">Season</label>
          <input
            id="vb-season"
            type="number"
            min={1}
            max={100}
            value={season}
            onChange={(event) => {
              const s = Number(event.target.value);
              setSeason(s);
              setEpisode(nextEpisodeNumber(title, s));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="vb-episode">Episode</label>
          <input id="vb-episode" type="number" min={1} max={500} value={episode} onChange={(event) => setEpisode(Number(event.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="vb-clips">Clips to cut</label>
          <input
            id="vb-clips"
            type="number"
            min={0}
            max={10}
            value={clipCount}
            aria-describedby="vb-clips-hint"
            onChange={(event) => setClipCount(Number(event.target.value))}
          />
        </div>
      </div>
      <p className="field-hint" id="vb-clips-hint">
        Vertical clips for sharing, each scored with plain-language reasons. 0 for none.
      </p>
      <div className="field">
        <label htmlFor="vb-name">Episode name</label>
        <input id="vb-name" type="text" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="vb-synopsis">Episode synopsis</label>
        <textarea id="vb-synopsis" rows={2} maxLength={2000} value={synopsis} onChange={(event) => setSynopsis(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="vb-text">{label}</label>
        <textarea id="vb-text" rows={12} required aria-describedby="vb-text-hint" value={text} onChange={(event) => setText(event.target.value)} />
        <p className="field-hint" id="vb-text-hint">
          {hint}
        </p>
      </div>
      <div className="field field-checkbox">
        <input id="vb-rights" type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
        <label htmlFor="vb-rights">I confirm I hold the rights to this text and the authority to make and stream a film from it.</label>
      </div>
      <p className="field-hint">You can start up to {VERBATIIM_DAILY_LIMIT} episodes a day.</p>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      <div className="title-actions">
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Starting…' : `Make it with ${VERBATIIM_NAME}`}
        </button>
      </div>
    </form>
  );
}

function JobCard({ job, onCheck }: { job: VerbatiimJob; onCheck: () => void }) {
  const inFlight = job.status === 'queued' || job.status === 'running' || job.status === 'importing';
  return (
    <article aria-labelledby={`vb-job-${job.id}`}>
      <h4 id={`vb-job-${job.id}`}>
        S{job.season} E{job.episode}: {job.name}
      </h4>
      <p>
        <strong>{STATUS_WORDS[job.status]}.</strong> {job.progress}
      </p>
      {job.error && (
        <p className="status status-error" role="alert">
          {job.error}
        </p>
      )}
      {inFlight && (
        <div className="title-actions">
          <button type="button" className="button button-quiet" onClick={onCheck}>
            Check now
          </button>
        </div>
      )}
      {job.credits && (
        <>
          <h5>Credits</h5>
          {job.credits
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line, i) => (
              <p key={i} className="field-hint">
                {line}
              </p>
            ))}
        </>
      )}
      {job.clips.length > 0 && (
        <>
          <h5>Clips</h5>
          <ol>
            {job.clips.map((clip, i) => (
              <li key={clip.id}>
                <p>
                  Clip {i + 1}: score {clip.score}, {formatDuration(clip.durationS)}. Opens with “{clip.title}”.{' '}
                  <a href={clip.videoUrl} download>
                    Download clip {i + 1}
                  </a>
                </p>
                <ul>
                  {clip.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </article>
  );
}
