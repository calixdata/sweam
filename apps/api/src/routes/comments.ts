import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import { notify } from '../lib/notify';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { requireUser, currentUser } from '../lib/session';
import { commentReportSchema } from '../lib/validate';

/**
 * Comment moderation. One removal endpoint, three authorities: the author can
 * remove their own comment, the title's creator can remove any comment on
 * their title, and admins can remove anything. The remover's role is recorded
 * in the status, and removal by someone other than the author notifies the
 * author (moderation is never silent).
 */
export const commentRoutes = new Hono<AppEnv>();

commentRoutes.use('*', requireUser);

interface CommentContext {
  id: string;
  author_id: string;
  status: string;
  title_creator_id: string;
  title_name: string;
}

async function loadComment(db: D1Database, commentId: string): Promise<CommentContext> {
  const row = await db
    .prepare(
      `SELECT co.id, co.author_id, co.status, t.creator_id AS title_creator_id, t.name AS title_name
       FROM comments co JOIN titles t ON t.id = co.title_id
       WHERE co.id = ?`,
    )
    .bind(commentId)
    .first<CommentContext>();
  if (!row) fail(404, 'comment_not_found', 'No such comment.');
  return row;
}

commentRoutes.delete('/:commentId', async (c) => {
  const user = currentUser(c);
  const comment = await loadComment(c.env.DB, c.req.param('commentId'));

  let status: string;
  if (comment.author_id === user.id) {
    status = 'removed_by_author';
  } else if (user.isAdmin) {
    status = 'removed_by_admin';
  } else if (comment.title_creator_id === user.id) {
    status = 'removed_by_creator';
  } else {
    // A miss, not a 403: outsiders should not learn which comments exist.
    fail(404, 'comment_not_found', 'No such comment.');
  }

  if (comment.status === 'visible') {
    await c.env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?')
      .bind(status, comment.id)
      .run();
    if (status !== 'removed_by_author') {
      await notify(
        c.env.DB,
        comment.author_id,
        'comment',
        status === 'removed_by_admin'
          ? `Your comment on ${comment.title_name} was removed by moderators.`
          : `Your comment on ${comment.title_name} was removed by the creator.`,
      );
    }
  }
  return c.json({ removed: true });
});

commentRoutes.post('/:commentId/report', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.report, user.id);
  const body = await parseBody(c, commentReportSchema);
  const comment = await loadComment(c.env.DB, c.req.param('commentId'));
  if (comment.status !== 'visible') {
    fail(404, 'comment_not_found', 'No such comment.');
  }

  const result = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO comment_reports (id, comment_id, reporter_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, 'open', ?)`,
  )
    .bind(crypto.randomUUID(), comment.id, user.id, body.reason, nowIso())
    .run();
  if (result.meta.changes === 0) {
    fail(409, 'already_reported', 'You already reported this comment.');
  }
  return c.json({ reported: true }, 201);
});
