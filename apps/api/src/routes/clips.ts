import { Hono } from 'hono';
import { bluTierById } from '@sweam/shared';
import type { AppEnv, Env } from '../env';
import { BLU_NOT_ELIGIBLE_MESSAGE, getBluOfferGate } from '../lib/blufund';
import { fail, nowIso, parseBody } from '../lib/http';
import { isOfficialAccount } from '../lib/official';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { requireUser, currentUser } from '../lib/session';
import { clipCreateSchema } from '../lib/validate';
import { publishClip } from '../lib/publish';
import { AiReviewError, aiReviewConfigured, reviewSubmission } from '../lib/aiReview';

/**
 * Instant clips: a signed-in creator records in the browser and posts on the
 * spot (no pre-publish approval). The clip is live immediately but lands in the
 * admin AI review queue, where Claude reads the caption and metadata for
 * prohibited-content signals and a human makes the call. Because the model
 * never sees the video, a clear textual policy conflict can auto-hide the clip
 * pending review; everything else stays live and queued. Viewer reports are the
 * other safety net (see /api/me/reports).
 */
export const clipRoutes = new Hono<AppEnv>();

clipRoutes.use('*', requireUser);

/** Run the advisory AI review after the response; the clip is already live. */
async function runClipAiReview(
  env: Env,
  reviewId: string,
  titleId: string,
  meta: { titleName: string; genre: string; caption: string },
  allowAutoHide: boolean,
): Promise<void> {
  try {
    const review = await reviewSubmission(env, {
      titleName: meta.titleName,
      kind: 'short',
      genre: meta.genre || 'Unspecified',
      synopsis: meta.caption,
      hosting:
        'Recorded and posted in Sweam as an instant clip. Only the caption and metadata are available, not the video itself.',
    });
    // The model reads text only, so auto-hide only when it is confident the
    // *described* clip breaks policy; otherwise leave it live and queued for a
    // human. Never auto-hide when the clip was added to an existing series (that
    // would unpublish the whole series over one episode) — flag it for a human.
    const autoHide = allowAutoHide && review.recommendation === 'decline' && review.confidence >= 0.8;
    const statements = [
      env.DB
        .prepare('UPDATE clip_reviews SET ai_review = ?, ai_reviewed_at = ?, state = ? WHERE id = ?')
        .bind(JSON.stringify(review), review.reviewedAt, autoHide ? 'flagged' : 'pending', reviewId),
    ];
    if (autoHide) {
      statements.push(
        env.DB
          .prepare("UPDATE titles SET published = 0, review_state = 'flagged' WHERE id = ?")
          .bind(titleId),
      );
    }
    await env.DB.batch(statements);
  } catch (err) {
    const message = err instanceof AiReviewError ? err.message : 'AI review could not be run.';
    await env.DB
      .prepare('UPDATE clip_reviews SET ai_error = ?, ai_reviewed_at = ? WHERE id = ?')
      .bind(message.slice(0, 500), nowIso(), reviewId)
      .run();
  }
}

// POST /api/clips — publish a recorded clip immediately, then queue AI review.
clipRoutes.post('/', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.clip, user.id);
  const body = await parseBody(c, clipCreateSchema);

  // The upload must be one this user just made to our intake bucket.
  if (!body.sourceUrl.startsWith(`/media/sub/${user.id}/`)) {
    fail(403, 'not_your_upload', 'That upload does not belong to you.');
  }
  if (body.captionsUrl && !body.captionsUrl.startsWith(`/media/sub/${user.id}/`)) {
    fail(403, 'not_your_upload', 'That captions file does not belong to you.');
  }

  // A clip can be attached to one of the creator's series (becomes its next
  // episode, inheriting the series' Free/Blu setting).
  if (body.seriesId) {
    const owned = await c.env.DB.prepare('SELECT 1 AS x FROM series WHERE id = ? AND user_id = ?')
      .bind(body.seriesId, user.id)
      .first();
    if (!owned) fail(404, 'series_not_found', 'That series does not exist or is not yours.');
  }

  // Monetization is a forced, preset choice: free (null) or one of the Blu tiers.
  // A series attach inherits the series' setting, so the per-clip Blu choice and
  // its eligibility gate only apply to standalone clips.
  let bluPriceCents: number | null = null;
  if (!body.seriesId && body.bluTierId) {
    const tier = bluTierById(body.bluTierId);
    if (!tier) fail(400, 'invalid_tier', 'Choose a Blu price from the preset options.');
    // Offering Blu is gated until the creator is Fund-eligible (or Blu is open to
    // all); admins bypass for testing.
    const gate = await getBluOfferGate(c.env.DB, user.id, user.isAdmin);
    if (!gate.canOfferBlu) fail(403, 'blu_not_eligible', BLU_NOT_ELIGIBLE_MESSAGE);
    bluPriceCents = tier.priceCents;
  }

  const published = await publishClip(
    c.env,
    {
      userId: user.id,
      caption: body.caption,
      rating: body.rating,
      genre: body.genre,
      audiences: body.audiences,
      sourceUrl: body.sourceUrl,
      captionsUrl: body.captionsUrl,
      bluPriceCents,
      seriesId: body.seriesId,
      releaseDate: body.releaseDate,
      posterUrl: body.posterUrl,
      mediaType: body.mediaType,
    },
    user.displayName,
  );

  const reviewId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO clip_reviews (id, title_id, episode_id, creator_id, caption, state, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(reviewId, published.titleId, published.episodeId, user.id, body.caption, nowIso())
    .run();

  if (aiReviewConfigured(c.env)) {
    // Official accounts' clips are reviewed like any other but never auto-hidden.
    const official = await isOfficialAccount(c.env.DB, user.id);
    c.executionCtx.waitUntil(
      runClipAiReview(
        c.env,
        reviewId,
        published.titleId,
        {
          titleName: published.name,
          genre: body.genre,
          caption: body.caption,
        },
        !published.attachedToSeries && !official,
      ),
    );
  }

  return c.json(
    { slug: published.slug, titleId: published.titleId, episodeId: published.episodeId },
    201,
  );
});
