import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { CommentItem } from '@sweam/shared';
import { COMMENT_REPORT_REASONS } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { useDoubleTap } from '../hooks';
import { Loading } from './Status';

const REMOVAL_LABELS: Record<string, string> = {
  removed_by_author: 'Comment removed by its author.',
  removed_by_creator: 'Comment removed by the creator.',
  removed_by_admin: 'Comment removed by moderators.',
};

/** Update one comment (by id) anywhere in the tree, immutably. */
function applyCommentLike(
  list: CommentItem[],
  id: string,
  likes: number,
  likedByMe: boolean,
): CommentItem[] {
  return list.map((comment) =>
    comment.id === id
      ? { ...comment, likes, likedByMe }
      : { ...comment, replies: applyCommentLike(comment.replies, id, likes, likedByMe) },
  );
}

/**
 * The comment thread on a title page: flat top-level comments with one level
 * of replies. Authors can delete their own; the title's creator and admins
 * can remove anything (the server decides which applies).
 */
export function CommentsSection({
  titleSlug,
  creatorHandle,
}: {
  titleSlug: string;
  creatorHandle: string;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ comments: CommentItem[]; visibleCount: number }>(
        `/api/titles/${encodeURIComponent(titleSlug)}/comments`,
      );
      setComments(data.comments);
      setVisibleCount(data.visibleCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load comments.');
    }
  }, [titleSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const canModerate = user !== null && (user.isAdmin || user.handle === creatorHandle);

  async function removeComment(comment: CommentItem) {
    const confirmed = window.confirm('Remove this comment?');
    if (!confirmed) return;
    await apiSend('DELETE', `/api/comments/${comment.id}`);
    await load();
  }

  const setCommentLike = useCallback(
    async (comment: CommentItem, liked: boolean) => {
      if (!user || liked === comment.likedByMe) return;
      // Optimistic update, reconciled with the server's authoritative count.
      const optimistic = comment.likes + (liked ? 1 : -1);
      setComments((cur) => (cur ? applyCommentLike(cur, comment.id, optimistic, liked) : cur));
      try {
        const res = await apiSend<{ likes: number; likedByMe: boolean }>(
          liked ? 'PUT' : 'DELETE',
          `/api/comments/${comment.id}/like`,
        );
        setComments((cur) =>
          cur ? applyCommentLike(cur, comment.id, res.likes, res.likedByMe) : cur,
        );
      } catch {
        setComments((cur) =>
          cur ? applyCommentLike(cur, comment.id, comment.likes, comment.likedByMe) : cur,
        );
      }
    },
    [user],
  );

  return (
    <section aria-labelledby="comments-heading" className="comments-section">
      <h2 id="comments-heading">Comments ({visibleCount})</h2>
      {user ? (
        <CommentForm titleSlug={titleSlug} parentId={null} label="Add a comment" onPosted={load} />
      ) : (
        <p>
          <Link to="/signin" state={{ from: `/t/${titleSlug}` }}>
            Sign in
          </Link>{' '}
          to join the conversation.
        </p>
      )}
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      {!comments && !error && <Loading label="Loading comments" />}
      {comments && comments.length === 0 && <p>No comments yet. Start the conversation.</p>}
      {comments && comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((comment) => (
            <CommentView
              key={comment.id}
              comment={comment}
              isReply={false}
              signedIn={user !== null}
              canModerate={canModerate}
              replyTo={replyTo}
              setReplyTo={setReplyTo}
              onRemove={removeComment}
              onLike={setCommentLike}
              titleSlug={titleSlug}
              onReload={load}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One comment (with its replies): like button + double-tap to like, reply, remove, report. */
function CommentView({
  comment,
  isReply,
  signedIn,
  canModerate,
  replyTo,
  setReplyTo,
  onRemove,
  onLike,
  titleSlug,
  onReload,
}: {
  comment: CommentItem;
  isReply: boolean;
  signedIn: boolean;
  canModerate: boolean;
  replyTo: string | null;
  setReplyTo: (id: string | null) => void;
  onRemove: (comment: CommentItem) => void;
  onLike: (comment: CommentItem, liked: boolean) => void;
  titleSlug: string;
  onReload: () => Promise<void>;
}) {
  const removed = comment.status !== 'visible';
  const [burst, setBurst] = useState(false);

  const likeFromGesture = () => {
    if (!signedIn) return;
    setBurst(true);
    window.setTimeout(() => setBurst(false), 600);
    onLike(comment, true);
  };
  const doubleTap = useDoubleTap<HTMLParagraphElement>(likeFromGesture);

  return (
    <li className={isReply ? 'comment comment-reply' : 'comment'}>
      {removed ? (
        <p className="comment-removed">{REMOVAL_LABELS[comment.status] ?? 'Comment removed.'}</p>
      ) : (
        <>
          <p className="comment-meta">
            {comment.author.handle ? (
              <Link to={`/c/${comment.author.handle}`}>{comment.author.displayName}</Link>
            ) : (
              <strong>{comment.author.displayName}</strong>
            )}
            {comment.authorIsCreator && <span className="tag-new"> Creator</span>} ·{' '}
            {comment.createdAt.slice(0, 10)}
          </p>
          <div className="comment-body-wrap">
            <p
              className="comment-body"
              title={signedIn ? 'Double-tap to like' : undefined}
              {...doubleTap}
            >
              {comment.body}
            </p>
            {burst && (
              <span className="like-burst" aria-hidden="true">
                ♥
              </span>
            )}
          </div>
          <div className="comment-actions">
            <button
              type="button"
              className={`comment-like${comment.likedByMe ? ' is-liked' : ''}`}
              aria-pressed={comment.likedByMe}
              aria-label={
                comment.likedByMe
                  ? `Unlike, ${comment.likes} likes`
                  : `Like, ${comment.likes} likes`
              }
              disabled={!signedIn}
              onClick={() => onLike(comment, !comment.likedByMe)}
            >
              <span aria-hidden="true">{comment.likedByMe ? '♥' : '♡'}</span> {comment.likes}
            </button>
            {!isReply && signedIn && (
              <button
                type="button"
                className="button-link"
                onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
              >
                {replyTo === comment.id ? 'Cancel reply' : 'Reply'}
              </button>
            )}
            {(comment.mine || canModerate) && (
              <button type="button" className="button-link" onClick={() => onRemove(comment)}>
                {comment.mine ? 'Delete' : 'Remove'}
              </button>
            )}
            {signedIn && !comment.mine && <ReportCommentControl commentId={comment.id} />}
          </div>
        </>
      )}
      {comment.replies.length > 0 && (
        <ul className="comment-list">
          {comment.replies.map((reply) => (
            <CommentView
              key={reply.id}
              comment={reply}
              isReply
              signedIn={signedIn}
              canModerate={canModerate}
              replyTo={replyTo}
              setReplyTo={setReplyTo}
              onRemove={onRemove}
              onLike={onLike}
              titleSlug={titleSlug}
              onReload={onReload}
            />
          ))}
        </ul>
      )}
      {replyTo === comment.id && (
        <CommentForm
          titleSlug={titleSlug}
          parentId={comment.id}
          label={`Reply to ${comment.author.displayName}`}
          onPosted={async () => {
            setReplyTo(null);
            await onReload();
          }}
        />
      )}
    </li>
  );
}

function CommentForm({
  titleSlug,
  parentId,
  label,
  onPosted,
}: {
  titleSlug: string;
  parentId: string | null;
  label: string;
  onPosted: () => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldId = `comment-${parentId ?? 'new'}`;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', `/api/titles/${encodeURIComponent(titleSlug)}/comments`, {
        body,
        parentId,
      });
      setBody('');
      await onPosted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post the comment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="comment-form">
      <div className="field">
        <label htmlFor={fieldId}>{label}</label>
        <textarea
          id={fieldId}
          rows={parentId ? 2 : 3}
          maxLength={1000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={submitting || body.trim() === ''}>
        {submitting ? 'Posting…' : 'Post'}
      </button>
    </form>
  );
}

function ReportCommentControl({ commentId }: { commentId: string }) {
  const [state, setState] = useState<'idle' | 'choosing' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function report(reason: string) {
    try {
      await apiSend('POST', `/api/comments/${commentId}/report`, { reason });
      setState('sent');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'already_reported') setState('sent');
      else setError(err instanceof ApiError ? err.message : 'Report failed.');
    }
  }

  if (state === 'sent') return <span className="comment-reported">Reported</span>;
  if (state === 'choosing') {
    return (
      <span className="comment-report-choices">
        {COMMENT_REPORT_REASONS.map((reason) => (
          <button key={reason} type="button" className="button-link" onClick={() => report(reason)}>
            {reason}
          </button>
        ))}
        <button type="button" className="button-link" onClick={() => setState('idle')}>
          cancel
        </button>
        {error && (
          <span role="alert" className="comment-reported">
            {error}
          </span>
        )}
      </span>
    );
  }
  return (
    <button type="button" className="button-link" onClick={() => setState('choosing')}>
      Report
    </button>
  );
}
