import type { CommentItem, CommentStatus } from '@sweam/shared';

/**
 * Comment thread assembly and visibility rules, pure so they are testable:
 *
 *  - Visible comments appear with their body.
 *  - A removed top-level comment with at least one visible reply stays as a
 *    placeholder: empty body, status preserved, replies intact.
 *  - A removed top-level comment with no visible replies is dropped.
 *  - Removed replies are always dropped (nothing hangs off them).
 */

export interface CommentRow {
  id: string;
  parent_id: string | null;
  body: string;
  status: CommentStatus;
  created_at: string;
  author_id: string;
  author_name: string;
  author_handle: string | null;
}

export function buildCommentTree(
  rows: readonly CommentRow[],
  opts: { titleCreatorId: string; viewerId: string | null },
): CommentItem[] {
  const repliesByParent = new Map<string, CommentRow[]>();
  for (const row of rows) {
    if (row.parent_id === null) continue;
    const list = repliesByParent.get(row.parent_id) ?? [];
    list.push(row);
    repliesByParent.set(row.parent_id, list);
  }

  const toItem = (row: CommentRow, replies: CommentItem[]): CommentItem => ({
    id: row.id,
    body: row.status === 'visible' ? row.body : '',
    status: row.status,
    createdAt: row.created_at,
    author: { displayName: row.author_name, handle: row.author_handle },
    authorIsCreator: row.author_id === opts.titleCreatorId,
    mine: opts.viewerId !== null && row.author_id === opts.viewerId,
    replies,
  });

  const tree: CommentItem[] = [];
  for (const row of rows) {
    if (row.parent_id !== null) continue;
    const replies = (repliesByParent.get(row.id) ?? [])
      .filter((reply) => reply.status === 'visible')
      .map((reply) => toItem(reply, []));
    if (row.status === 'visible') {
      tree.push(toItem(row, replies));
    } else if (replies.length > 0) {
      tree.push(toItem(row, replies));
    }
  }
  return tree;
}

/** Total visible comments in an assembled tree (placeholders excluded). */
export function countVisible(tree: readonly CommentItem[]): number {
  return tree.reduce(
    (sum, comment) => sum + (comment.status === 'visible' ? 1 : 0) + comment.replies.length,
    0,
  );
}
