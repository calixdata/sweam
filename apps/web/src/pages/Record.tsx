import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AUDIENCES,
  AUDIENCE_LABELS,
  BLU_FUND_THRESHOLDS,
  BLU_SWITCH_COOLDOWN_DAYS,
  BLU_TIERS,
  CLIP_SPEC,
  GENRES,
  RATINGS,
  UPLOAD_SPECS,
} from '@sweam/shared';
import type { BluFundStatus, SeriesSummary } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { BluBadge } from '../components/BluBadge';
import { CoverArtField } from '../components/CoverArtField';
import { usePageTitle } from '../hooks';
import { uploadMedia } from '../upload';
import type { UploadProgress } from '../upload';

const INTAKE_UPLOAD_BASE = '/api/submissions/upload';

/** Pick a container/codec the browser can actually record. */
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export function Record() {
  usePageTitle('Record a clip');
  const { user } = useAuth();
  const navigate = useNavigate();

  const liveRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string; name: string } | null>(null);

  const [caption, setCaption] = useState('');
  const [rating, setRating] = useState('');
  const [genre, setGenre] = useState<string>('');
  const [audience, setAudience] = useState('');
  // Forced Free/Blu choice, defaulted to Free. On Blu, a preset tier is required.
  const [bluMode, setBluMode] = useState<'free' | 'blu'>('free');
  const [bluTierId, setBluTierId] = useState<string>(BLU_TIERS[3]?.id ?? 'blu_999');
  // Blu-offer gate + the creator's Free/Blu default for new uploads.
  const [bluFund, setBluFund] = useState<BluFundStatus | null>(null);
  // The creator's series (for optionally attaching this clip as the next episode).
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [seriesId, setSeriesId] = useState('');
  // Optional scheduled release day (YYYY-MM-DD, Eastern); empty posts right away.
  const [releaseDate, setReleaseDate] = useState('');
  // Optional cover image; a frame from the clip is used when empty.
  const [posterUrl, setPosterUrl] = useState('');

  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (liveRef.current) liveRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  // Tear everything down on unmount.
  useEffect(
    () => () => {
      stopTimer();
      stopStream();
      if (clip) URL.revokeObjectURL(clip.url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Load the Blu-offer gate + the creator's Free/Blu default, and the creator's
  // series (for the optional series picker).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    apiGet<BluFundStatus>('/api/studio/blu-fund')
      .then((data) => {
        if (cancelled) return;
        setBluFund(data);
        setBluMode(data.canOfferBlu && data.contentDefault === 'blu' ? 'blu' : 'free');
      })
      .catch(() => undefined);
    apiGet<{ series: SeriesSummary[] }>('/api/submissions/series')
      .then((data) => {
        if (!cancelled) setSeries(data.series);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const startCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot access a camera. Upload a video file instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (liveRef.current) {
        liveRef.current.srcObject = stream;
        liveRef.current.muted = true;
        await liveRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
      setStatus('Camera ready.');
    } catch {
      setError('Camera or microphone permission was denied. You can upload a video file instead.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    stopTimer();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
  }, [stopTimer]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    setError(null);
    if (clip) {
      URL.revokeObjectURL(clip.url);
      setClip(null);
    }
    chunksRef.current = [];
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || 'video/webm';
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunksRef.current, { type });
      const url = URL.createObjectURL(blob);
      setClip({ blob, url, name: `clip.${ext}` });
      setStatus('Recording ready to review.');
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setElapsed(0);
    setStatus('Recording.');
    let seconds = 0;
    timerRef.current = setInterval(() => {
      seconds += 1;
      setElapsed(seconds);
      if (seconds >= CLIP_SPEC.maxSeconds) stopRecording();
    }, 1000);
  }, [clip, stopRecording]);

  const onPickFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setError(null);
      if (file.size > CLIP_SPEC.maxBytes) {
        setError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Clips are limited to ${CLIP_SPEC.maxLabel}.`);
        return;
      }
      if (clip) URL.revokeObjectURL(clip.url);
      const url = URL.createObjectURL(file);
      setClip({ blob: file, url, name: file.name });
      setStatus('Video ready to review.');
    },
    [clip],
  );

  const discardClip = useCallback(() => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    setStatus('Cleared. Record again or pick a file.');
  }, [clip]);

  const post = useCallback(async () => {
    if (!clip) return;
    if (!caption.trim()) {
      setError('Add a caption for your clip.');
      return;
    }
    if (!rating) {
      setError('Choose a maturity rating.');
      return;
    }
    if (clip.blob.size > CLIP_SPEC.maxBytes) {
      setError(`This clip is over the ${CLIP_SPEC.maxLabel} limit.`);
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const file =
        clip.blob instanceof File ? clip.blob : new File([clip.blob], clip.name, { type: clip.blob.type });
      const { url } = await uploadMedia(file, setProgress, INTAKE_UPLOAD_BASE);
      const result = await apiSend<{ slug: string; episodeId: string }>('POST', '/api/clips', {
        caption: caption.trim(),
        rating,
        genre,
        audiences: audience ? [audience] : [],
        sourceUrl: url,
        bluTierId: !seriesId && bluMode === 'blu' ? bluTierId : null,
        seriesId: seriesId || null,
        releaseDate: releaseDate || null,
        posterUrl: posterUrl || null,
      });
      stopStream();
      navigate(`/watch/${result.episodeId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post your clip.');
      setPosting(false);
      setProgress(null);
    }
  }, [clip, caption, rating, genre, audience, bluMode, bluTierId, seriesId, releaseDate, posterUrl, navigate, stopStream]);

  if (!user) {
    return (
      <div className="page page-narrow">
        <h1>Record a clip</h1>
        <p className="status">
          <Link to="/signin" state={{ from: '/create' }}>
            Sign in
          </Link>{' '}
          to record and post a clip.
        </p>
      </div>
    );
  }

  // Fail safe: Blu stays locked until we have confirmed the creator may offer it.
  const bluLocked = !bluFund?.canOfferBlu;

  return (
    <div className="page page-narrow">
      <h1>Record a clip</h1>
      <p className="page-intro">
        Film something now and post it straight to Sweam. Clips go live immediately, then our
        moderators review them. Keep it within the{' '}
        <Link to="/legal/community-guidelines">Community Guidelines</Link>: prohibited content
        (nudity, sexually explicit, or illegal material) can cost you your account.
      </p>

      <aside className="intake-specs" aria-label="Clip requirements">
        <h3>Clip requirements</h3>
        <ul>
          <li>Up to {CLIP_SPEC.maxSeconds} seconds, {CLIP_SPEC.maxLabel} maximum.</li>
          <li>Recorded here, or upload a {UPLOAD_SPECS.video.formats} file.</li>
          <li>{UPLOAD_SPECS.video.recommended}</li>
          <li>A caption and a maturity rating are required.</li>
        </ul>
      </aside>

      <section aria-label="Camera" className="record-stage">
        <video
          ref={liveRef}
          className="player"
          playsInline
          muted
          aria-label="Live camera preview"
          hidden={!cameraOn || clip !== null}
        />
        {clip && (
          <video className="player" src={clip.url} controls playsInline aria-label="Your recorded clip" />
        )}

        <p className="status" role="status" aria-live="polite">
          {recording ? `Recording… ${elapsed}s of ${CLIP_SPEC.maxSeconds}s` : status}
        </p>

        <div className="record-controls">
          {!cameraOn && !clip && (
            <button type="button" className="button" onClick={() => void startCamera()}>
              Turn on camera
            </button>
          )}
          {cameraOn && !recording && !clip && (
            <button type="button" className="button" onClick={startRecording}>
              Start recording
            </button>
          )}
          {recording && (
            <button type="button" className="button" onClick={stopRecording}>
              Stop recording
            </button>
          )}
          {clip && (
            <button type="button" className="button button-quiet" onClick={discardClip} disabled={posting}>
              Discard and redo
            </button>
          )}
        </div>

        <div className="record-fallback">
          <label htmlFor="clip-file" className="field-label">
            No camera? Upload a video instead
          </label>
          <input
            id="clip-file"
            type="file"
            accept={UPLOAD_SPECS.video.accept}
            disabled={posting}
            onChange={(event) => onPickFile(event.target.files?.[0])}
          />
        </div>
      </section>

      <section aria-label="Clip details" className="record-details">
        <div className="field">
          <label htmlFor="clip-caption">Caption</label>
          <textarea
            id="clip-caption"
            rows={2}
            maxLength={CLIP_SPEC.captionMax}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            aria-describedby="clip-caption-hint"
          />
          <p className="field-hint" id="clip-caption-hint">
            Up to {CLIP_SPEC.captionMax} characters. This becomes the clip's title.
          </p>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="clip-rating">Maturity rating</label>
            <select id="clip-rating" value={rating} onChange={(event) => setRating(event.target.value)}>
              <option value="" disabled>
                Choose a rating…
              </option>
              {RATINGS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="clip-genre">Genre</label>
            <select id="clip-genre" value={genre} onChange={(event) => setGenre(event.target.value)}>
              <option value="">None</option>
              {GENRES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="clip-audience">Audience</label>
            <select
              id="clip-audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
            >
              <option value="">No preference</option>
              {AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {AUDIENCE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {series.length > 0 && (
          <div className="field">
            <label htmlFor="clip-series">Series</label>
            <select
              id="clip-series"
              value={seriesId}
              onChange={(event) => setSeriesId(event.target.value)}
              disabled={posting}
            >
              <option value="">None — standalone clip</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="field-hint">
              Add this clip to one of your series as its next episode, or leave it standalone.
            </p>
          </div>
        )}

        <CoverArtField
          label="Cover image"
          value={posterUrl}
          onChange={setPosterUrl}
          portrait={false}
          base={INTAKE_UPLOAD_BASE}
          disabled={posting}
          hint="JPEG, PNG, or WebP, up to 10 MB. Shown on cards and in search. Leave empty to use a frame from your clip."
        />
        <div className="field">
          <label htmlFor="clip-release-date">Release date (optional)</label>
          <input
            id="clip-release-date"
            type="date"
            value={releaseDate}
            onChange={(event) => setReleaseDate(event.target.value)}
            disabled={posting}
            aria-describedby="clip-release-hint"
          />
          <p className="field-hint" id="clip-release-hint">
            Schedule it: viewers see the cover and caption now and the video unlocks at 12:00 AM
            Eastern on that day. Leave empty to post right away.
          </p>
        </div>

        {seriesId !== '' ? (
          <p className="field-hint monetization-intro">
            This clip joins your series as its next episode and uses that series' Free or Sweam Blu
            setting.
          </p>
        ) : (
          <fieldset className="field monetization">
            <legend>Monetization</legend>
            <p className="field-hint monetization-intro">
              Every clip is Free or Sweam Blu (paid). On Blu you keep 80%, prices are preset, and you
              can switch a title between Free and Blu once every {BLU_SWITCH_COOLDOWN_DAYS} days.
            </p>
          <div className="mon-options">
            <label className={bluMode === 'free' ? 'mon-option is-selected' : 'mon-option'}>
              <input
                type="radio"
                name="clip-monetization"
                checked={bluMode === 'free'}
                onChange={() => setBluMode('free')}
                disabled={posting}
              />
              <span className="mon-option-body">
                <span className="mon-option-title">Free</span>
                <span className="mon-option-sub">Anyone can watch.</span>
              </span>
            </label>
            <label
              className={
                'mon-option' +
                (bluMode === 'blu' ? ' is-selected' : '') +
                (bluLocked ? ' is-disabled' : '')
              }
            >
              <input
                type="radio"
                name="clip-monetization"
                checked={bluMode === 'blu'}
                onChange={() => setBluMode('blu')}
                disabled={posting || bluLocked}
              />
              <span className="mon-option-body">
                <span className="mon-option-title">
                  <BluBadge height={16} decorative /> Sweam Blu
                </span>
                <span className="mon-option-sub">
                  Subscribers only.{' '}
                  {bluLocked ? 'Locked until you qualify for the Blu Fund.' : 'You keep 80%.'}
                </span>
              </span>
            </label>
          </div>

          {bluFund !== null && !bluFund.canOfferBlu && (
            <p className="field-hint">
              Sweam Blu is open to eligible creators for now: at least{' '}
              {BLU_FUND_THRESHOLDS.minFollowers} followers,{' '}
              {BLU_FUND_THRESHOLDS.minViews.toLocaleString()} views, no violations in{' '}
              {BLU_FUND_THRESHOLDS.violationWindowDays} days, and a verified 18+ age. Check your{' '}
              <Link to="/studio/earnings">Blu Fund status</Link>.
            </p>
          )}

          {bluMode === 'blu' && !bluLocked && (
            <div className="field mon-tier">
              <label htmlFor="clip-blu-tier">Monthly price (choose a preset)</label>
              <select
                id="clip-blu-tier"
                value={bluTierId}
                onChange={(event) => setBluTierId(event.target.value)}
                disabled={posting}
              >
                {BLU_TIERS.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Subscribers pay this monthly; connect payouts in your{' '}
                <Link to="/studio/earnings">Studio</Link> to get paid.
              </p>
            </div>
          )}
          </fieldset>
        )}

        {progress && (
          <div className="upload-progress">
            <progress max={progress.partsTotal} value={progress.partsDone} aria-label="Upload progress" />
            <p className="status" role="status">
              {progress.message}
            </p>
          </div>
        )}
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="button" onClick={() => void post()} disabled={!clip || posting}>
          {posting ? 'Posting…' : 'Post now'}
        </button>
      </section>
    </div>
  );
}
