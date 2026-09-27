import type { AiRecommendation, AiSubmissionReview } from '@sweam/shared';
import type { Env } from '../env';

/**
 * AI-assisted submission review with Claude. This runs on the edge Worker, so
 * it calls the Anthropic Messages API over fetch directly rather than pulling
 * the SDK into the Worker bundle (which stays hono + zod). It assesses a
 * submission's described metadata against the Community Guidelines and returns
 * a structured recommendation for a human reviewer. It never sees the video, so
 * it is an advisory triage aid, not the decision.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
/** Per the model guidance, default to Opus 5; override with AI_REVIEW_MODEL. */
const DEFAULT_MODEL = 'claude-opus-5';

const GUIDELINES = [
  'Not allowed: unlawful content or content the submitter lacks rights to; anything sexualizing minors (report and ban); non-consensual intimate imagery; pornographic or sexually explicit content; hate speech attacking protected groups or promoting violence against them; harassment, threats, or doxxing; gore glorifying violence or content encouraging self-harm; dangerous misinformation, scams, spam, or malware; impersonation; and undisclosed realistic synthetic media of real people.',
  'Sweam is an adult (18+) service, so mature storytelling is welcome within those limits, and content advisories (TV-G, TV-PG, TV-14, TV-MA) must be accurate.',
  'Authenticity matters: original, finished work only, no reposts or rips, and no manipulation of metadata.',
].join(' ');

export function aiReviewConfigured(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export class AiReviewError extends Error {}

export interface SubmissionForReview {
  titleName: string;
  kind: string;
  genre: string;
  synopsis: string;
  hosting: string;
}

const clamp01 = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};

const RECOMMENDATIONS: AiRecommendation[] = ['accept', 'decline', 'needs_review'];

/** Pull the first JSON object out of a model response, tolerating stray prose or code fences. */
function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AiReviewError('The model did not return JSON.');
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new AiReviewError('The model returned malformed JSON.');
  }
}

export async function reviewSubmission(
  env: Env,
  submission: SubmissionForReview,
): Promise<AiSubmissionReview> {
  const model = env.AI_REVIEW_MODEL || DEFAULT_MODEL;
  const system =
    'You are a trust-and-safety reviewer for Sweam, an adult (18+) free streaming service for ' +
    'independent creators. Assess the described submission against the Community Guidelines and ' +
    'recommend a disposition for a human reviewer. You are given the metadata and description ' +
    'only, not the video itself, so recommend "needs_review" whenever the work must be watched to ' +
    'decide, and reserve "decline" for clear policy conflicts in what is described. Guidelines: ' +
    GUIDELINES +
    ' Respond with ONLY a JSON object, no prose and no markdown fences, exactly this shape: ' +
    '{"recommendation":"accept"|"decline"|"needs_review","confidence":<number 0 to 1>,' +
    '"summary":"one or two sentences","riskFlags":["short phrases, empty if none"],' +
    '"suggestedNote":"a brief note that could be shared with the submitter"}.';
  const user =
    `Title: ${submission.titleName}\nType: ${submission.kind}\nGenre: ${submission.genre}\n` +
    `Hosting: ${submission.hosting}\nDescription: ${submission.synopsis}`;

  const headers: Record<string, string> = {
    'x-api-key': env.ANTHROPIC_API_KEY as string,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  // Org keys that are not scoped to a single workspace require this header.
  if (env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = env.ANTHROPIC_WORKSPACE_ID;

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch {
    throw new AiReviewError('Could not reach the Claude API.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AiReviewError(`Claude API returned ${res.status}. ${detail.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => null)) as {
    content?: { type: string; text?: string }[];
  } | null;
  const text = (data?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();
  const parsed = extractJson(text);

  const recommendation = RECOMMENDATIONS.includes(parsed.recommendation as AiRecommendation)
    ? (parsed.recommendation as AiRecommendation)
    : 'needs_review';
  return {
    recommendation,
    confidence: clamp01(parsed.confidence),
    summary: String(parsed.summary ?? '').slice(0, 1000),
    riskFlags: Array.isArray(parsed.riskFlags)
      ? parsed.riskFlags.map((flag) => String(flag).slice(0, 120)).slice(0, 12)
      : [],
    suggestedNote: String(parsed.suggestedNote ?? '').slice(0, 1000),
    model,
    reviewedAt: new Date().toISOString(),
  };
}
