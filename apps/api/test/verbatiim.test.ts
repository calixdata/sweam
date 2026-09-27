import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mapJob, progressLine, verifyWebhookSignature, type RemoteJob, type VerbatiimJobRow } from '../src/lib/verbatiim';
import { verbatiimJobSchema } from '../src/lib/validate';

const secret = 'whsec_test_secret';
const sign = (body: string, t: number, key = secret) => `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;

describe('Verbatiim webhook signatures', () => {
  const body = JSON.stringify({ event: 'job.completed', job: { id: 'job-1' } });
  const now = 1_790_000_000;

  it('accepts a fresh, correct signature', async () => {
    expect(await verifyWebhookSignature(secret, body, sign(body, now), now)).toBe(true);
  });

  it('rejects a changed body, a wrong secret, or a missing header', async () => {
    expect(await verifyWebhookSignature(secret, `${body} `, sign(body, now), now)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, sign(body, now, 'whsec_other'), now)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, undefined, now)).toBe(false);
  });

  it('rejects replays older than five minutes', async () => {
    expect(await verifyWebhookSignature(secret, body, sign(body, now - 301), now)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, sign(body, now - 299), now)).toBe(true);
  });
});

describe('Verbatiim job requests', () => {
  const valid = { mode: 'adapt', text: 'The tide came in black.', name: 'Pilot', rightsConfirmed: true };

  it('requires a rights confirmation', () => {
    expect(verbatiimJobSchema.safeParse({ ...valid, rightsConfirmed: false }).success).toBe(false);
    expect(verbatiimJobSchema.safeParse(valid).success).toBe(true);
  });

  it('fills sensible defaults and caps clips', () => {
    const parsed = verbatiimJobSchema.parse(valid);
    expect(parsed).toMatchObject({ season: 1, episode: 1, clipCount: 3, synopsis: '' });
    expect(verbatiimJobSchema.safeParse({ ...valid, clipCount: 11 }).success).toBe(false);
    expect(verbatiimJobSchema.safeParse({ ...valid, mode: 'import' }).success).toBe(false);
  });
});

describe('Verbatiim progress and rows', () => {
  const remote: RemoteJob = {
    id: 'r1',
    status: 'running',
    runtimeSec: null,
    outputs: [],
    clips: [],
    stages: [
      { name: 'story', label: 'Story: bible and screenplay', status: 'done', detail: '1 scene', error: null },
      { name: 'voice', label: 'Voice: dialogue and audio description', status: 'running', detail: '4 of 9 voice steps', error: null },
    ],
  };

  it('describes progress in plain words', () => {
    expect(progressLine(remote)).toBe('Voice: dialogue and audio description: 4 of 9 voice steps');
    expect(progressLine({ ...remote, stages: remote.stages.slice(0, 1) })).toBe('Story: bible and screenplay: 1 scene');
  });

  it('maps a stored row to the API shape', () => {
    const row: VerbatiimJobRow = {
      id: 'j1',
      remote_id: 'r1',
      creator_id: 'u1',
      title_id: 't1',
      episode_id: null,
      mode: 'adapt',
      season: 1,
      episode: 2,
      name: 'Pilot',
      synopsis: '',
      status: 'done',
      progress: 'Added',
      error: null,
      clips_json: JSON.stringify([{ id: 'clip-01', score: 74, durationS: 20, title: 'Run.', reasons: ['Hook: fast.'], videoUrl: '/media/x.mp4', captionsUrl: null }]),
      credits: 'Pilot\nWords: 100% the author\'s own words.',
      created_at: 'a',
      updated_at: 'b',
    };
    const job = mapJob(row);
    expect(job.clips[0]!.score).toBe(74);
    expect(job.credits).toContain('100%');
    expect(job).not.toHaveProperty('remote_id');
  });
});
