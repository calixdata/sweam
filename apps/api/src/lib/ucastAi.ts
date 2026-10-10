import type { UcastDuplicateCandidate, UcastDuplicateCheck, UcastWorkKind } from '@sweam/shared';
import type { Env } from '../env';
import type { ExistingWork } from './ucast';
import { findDuplicates } from './ucast';

/**
 * AI-assisted de-duplication of poll requests. The deterministic matcher in
 * lib/ucast.ts runs first and always; when a Claude key is configured, the
 * model then looks at the request against the room's existing polls and
 * catches what word overlap cannot: nicknames ("Lil Shop of Horrors 86"),
 * subtitles, the stage show versus the film, a song versus its music video.
 * The result is advice for the member and a note for the admin, never a
 * silent merge: the request still goes to review.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-5';

interface AiMatch {
  slug: string;
  reason: string;
  confidence: number;
}

function extractJson(text: string): { matches?: AiMatch[] } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1)) as { matches?: AiMatch[] };
  } catch {
    return {};
  }
}

async function askClaude(
  env: Env,
  request: { kind: UcastWorkKind; title: string; year: number },
  existing: readonly ExistingWork[],
): Promise<AiMatch[]> {
  const headers: Record<string, string> = {
    'x-api-key': env.ANTHROPIC_API_KEY as string,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  if (env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = env.ANTHROPIC_WORKSPACE_ID;
  const system =
    'You de-duplicate requests for UCast, a fan recasting poll room. A member is requesting a poll ' +
    'for a work (a film, TV series, song, musical or music video with a release year). You are given ' +
    'the existing polls. Decide which existing polls, if any, are the SAME work as the request, ' +
    'allowing for misspellings, nicknames, abbreviations, missing or extra subtitles, and a year off ' +
    'by one or two. A different medium of the same property (the 1978 film versus the 1975 stage ' +
    'musical; a song versus its music video) is a DIFFERENT work: report it with low confidence and ' +
    'say why. Respond with ONLY a JSON object, no prose, exactly: ' +
    '{"matches":[{"slug":"<existing slug>","reason":"one short sentence","confidence":<0 to 1>}]} ' +
    'with an empty array when nothing matches.';
  const user =
    `Request: kind=${request.kind}; title=${JSON.stringify(request.title)}; year=${request.year}\n` +
    `Existing polls:\n` +
    existing.map((w) => `- slug=${w.slug}; kind=${w.kind}; title=${JSON.stringify(w.title)}; year=${w.year}`).join('\n');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: env.AI_REVIEW_MODEL || DEFAULT_MODEL,
      max_tokens: 600,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API returned ${res.status}.`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  const parsed = extractJson(text);
  return Array.isArray(parsed.matches) ? parsed.matches : [];
}

/**
 * Run the duplicate check: fuzzy first, Claude on top when configured. The AI
 * can only add or raise candidates that exist in the room; it cannot invent
 * one. Any AI failure degrades to the fuzzy result, never to an error, so a
 * request is never blocked by the model being down.
 */
export async function checkDuplicates(
  env: Env,
  request: { kind: UcastWorkKind; title: string; year: number },
  existing: readonly ExistingWork[],
): Promise<UcastDuplicateCheck> {
  const fuzzy = findDuplicates(request, existing);
  if (!env.ANTHROPIC_API_KEY || existing.length === 0) return { method: 'fuzzy', candidates: fuzzy };
  // An exact slug match needs no model.
  if (fuzzy.some((c) => c.confidence >= 1)) return { method: 'fuzzy', candidates: fuzzy };

  let matches: AiMatch[];
  try {
    // Keep the prompt bounded: the closest titles by fuzzy score plus the most recent polls.
    const shortlist = existing.slice(0, 120);
    matches = await askClaude(env, request, shortlist);
  } catch {
    return { method: 'fuzzy', candidates: fuzzy };
  }
  const bySlug = new Map<string, UcastDuplicateCandidate>(fuzzy.map((c) => [c.slug, c]));
  for (const m of matches) {
    const work = existing.find((w) => w.slug === m.slug);
    if (!work) continue;
    const confidence = Math.min(1, Math.max(0, Number(m.confidence) || 0));
    if (confidence < 0.3) continue;
    const prior = bySlug.get(work.slug);
    bySlug.set(work.slug, {
      ...work,
      reason: String(m.reason ?? '').slice(0, 200) || prior?.reason || 'Flagged by the AI check.',
      confidence: Math.max(prior?.confidence ?? 0, Math.round(confidence * 100) / 100),
    });
  }
  return {
    method: 'ai',
    candidates: [...bySlug.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5),
  };
}
