import { describe, expect, it } from 'vitest';
import type { CommentRow } from '../src/lib/comments';
import { buildCommentTree, countVisible } from '../src/lib/comments';

const CREATOR = 'usr_creator';
const VIEWER = 'usr_viewer';

function row(overrides: Partial<CommentRow> & { id: string }): CommentRow {
  return {
    parent_id: null,
    body: `body of ${overrides.id}`,
    status: 'visible',
    created_at: '2026-08-25T10:00:00.000Z',
    author_id: 'usr_someone',
    author_name: 'Someone',
    author_handle: null,
    ...overrides,
  };
}

describe('buildCommentTree', () => {
  it('nests replies one level under their parent, in order', () => {
    const tree = buildCommentTree(
      [
        row({ id: 'c1' }),
        row({ id: 'r1', parent_id: 'c1' }),
        row({ id: 'c2' }),
        row({ id: 'r2', parent_id: 'c1' }),
      ],
      { titleCreatorId: CREATOR, viewerId: null },
    );
    expect(tree.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(tree[0]?.replies.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(countVisible(tree)).toBe(4);
  });

  it('keeps a removed parent as an empty-body placeholder when it has visible replies', () => {
    const tree = buildCommentTree(
      [
        row({ id: 'c1', status: 'removed_by_creator', body: 'should never leak' }),
        row({ id: 'r1', parent_id: 'c1' }),
      ],
      { titleCreatorId: CREATOR, viewerId: null },
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]?.body).toBe('');
    expect(tree[0]?.status).toBe('removed_by_creator');
    expect(tree[0]?.replies).toHaveLength(1);
    expect(countVisible(tree)).toBe(1);
  });

  it('drops a removed parent with no visible replies, and drops removed replies', () => {
    const tree = buildCommentTree(
      [
        row({ id: 'c1', status: 'removed_by_admin' }),
        row({ id: 'r1', parent_id: 'c1', status: 'removed_by_author' }),
        row({ id: 'c2' }),
        row({ id: 'r2', parent_id: 'c2', status: 'removed_by_author' }),
      ],
      { titleCreatorId: CREATOR, viewerId: null },
    );
    expect(tree.map((c) => c.id)).toEqual(['c2']);
    expect(tree[0]?.replies).toHaveLength(0);
  });

  it('never leaks a removed body, even on placeholders', () => {
    const tree = buildCommentTree(
      [row({ id: 'c1', status: 'removed_by_author', body: 'secret' }), row({ id: 'r1', parent_id: 'c1' })],
      { titleCreatorId: CREATOR, viewerId: null },
    );
    expect(JSON.stringify(tree)).not.toContain('secret');
  });

  it('marks the creator badge and viewer ownership', () => {
    const tree = buildCommentTree(
      [
        row({ id: 'c1', author_id: CREATOR, author_name: 'The Creator', author_handle: 'creator' }),
        row({ id: 'c2', author_id: VIEWER }),
      ],
      { titleCreatorId: CREATOR, viewerId: VIEWER },
    );
    expect(tree[0]?.authorIsCreator).toBe(true);
    expect(tree[0]?.mine).toBe(false);
    expect(tree[1]?.authorIsCreator).toBe(false);
    expect(tree[1]?.mine).toBe(true);
  });

  it('treats a signed-out viewer as owning nothing', () => {
    const tree = buildCommentTree([row({ id: 'c1', author_id: VIEWER })], {
      titleCreatorId: CREATOR,
      viewerId: null,
    });
    expect(tree[0]?.mine).toBe(false);
  });
});
