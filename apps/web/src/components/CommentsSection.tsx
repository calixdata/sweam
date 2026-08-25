import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { CommentItem } from '@sweam/shared';
import { COMMENT_REPORT_REASONS } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { Loading } from './Status';

const REMOVAL_LABELS: Record<string, string> = {
  removed_by_author: 'Comment removed by its author.',
  removed_by_creator: 'Comment removed by the creator.',
  removed_by_admin: 'Comment removed by moderators.',
};

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

  function renderComment(comment: CommentItem, isReply: boolean) {
    const removed = comment.status !== 'visible';
    return (
      <li key={comment.id} className={isReply ? 'comment comment-reply' : 'comment'}>
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
            <p className="comment-body">{comment.body}</p>
            <div className="comment-actions">
              {!isReply && user && (
                <button
                  type="button"
                  className="button-link"
                  onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                >
                  {replyTo === comment.id ? 'Cancel reply' : 'Reply'}
                </button>
              )}
              {(comment.mine || canModerate) && (
                <button type="button" className="button-link" onClick={() => removeComment(comment)}>
                  {comment.mine ? 'Delete' : 'Remove'}
                </button>
              )}
              {user && !comment.mine && <ReportCommentControl commentId={comment.id} />}
            </div>
          </>
        )}
        {comment.replies.length > 0 && (
          <ul className="comment-list">
            {comment.replies.map((reply) => renderComment(reply, true))}
          </ul>
        )}
        {replyTo === comment.id && (
          <CommentForm
            titleSlug={titleSlug}
            parentId={comment.id}
            label={`Reply to ${comment.author.displayName}`}
            onPosted={async () => {
              setReplyTo(null);
              await load();
            }}
          />
        )}
      </li>
    );
  }

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
        <ul className="comment-list">{comments.map((comment) => renderComment(comment, false))}</ul>
      )}
    </section>
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
