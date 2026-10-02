import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { router } from 'expo-router';
import { api } from '../lib/api';
import { colors } from '../lib/theme';
import type { CommentItem } from '../lib/types';

interface ReplyTarget {
  rootId: string;
  author: string;
}

/**
 * TikTok-style comments: slides up over the video (which keeps playing behind).
 * Read, double-tap or tap the heart to like, reply to a specific comment (kept
 * threaded under it), and post inline. No navigation.
 */
export function CommentsSheet({
  slug,
  visible,
  signedIn,
  onClose,
  onCountChange,
}: {
  slug: string | null;
  visible: boolean;
  signedIn: boolean;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}) {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const inputRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setComments(null);
    try {
      const data = await api.get<{ comments: CommentItem[]; visibleCount: number }>(
        `/api/titles/${encodeURIComponent(slug)}/comments`,
      );
      setComments(data.comments);
      onCountChange?.(data.visibleCount);
    } catch {
      setComments([]);
    }
  }, [slug, onCountChange]);

  useEffect(() => {
    if (visible) {
      setReplyTo(null);
      setDraft('');
      void load();
    }
  }, [visible, load]);

  const setLike = useCallback(async (comment: CommentItem, liked: boolean) => {
    setComments((cur) =>
      cur ? applyLike(cur, comment.id, comment.likes + (liked ? 1 : -1), liked) : cur,
    );
    try {
      const res = await (liked
        ? api.put<{ likes: number; likedByMe: boolean }>(`/api/comments/${comment.id}/like`)
        : api.del<{ likes: number; likedByMe: boolean }>(`/api/comments/${comment.id}/like`));
      setComments((cur) => (cur ? applyLike(cur, comment.id, res.likes, res.likedByMe) : cur));
    } catch {
      setComments((cur) =>
        cur ? applyLike(cur, comment.id, comment.likes, comment.likedByMe) : cur,
      );
    }
  }, []);

  const startReply = useCallback((rootId: string, author: string) => {
    setReplyTo({ rootId, author });
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const post = useCallback(async () => {
    if (!draft.trim() || !slug) return;
    setPosting(true);
    try {
      await api.post(`/api/titles/${encodeURIComponent(slug)}/comments`, {
        body: draft.trim(),
        parentId: replyTo?.rootId ?? null,
      });
      setDraft('');
      setReplyTo(null);
      await load();
    } catch {
      /* ignore */
    } finally {
      setPosting(false);
    }
  }, [draft, slug, replyTo, load]);

  const count = comments ? countVisible(comments) : 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheet}
      >
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.headerText}>{count} comments</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close comments" hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>

        {!comments ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : comments.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>No comments yet. Be the first.</Text>
          </View>
        ) : (
          <FlatList
            data={comments}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <SheetComment
                comment={item}
                rootId={item.id}
                signedIn={signedIn}
                onLike={setLike}
                onReply={startReply}
              />
            )}
          />
        )}

        {signedIn ? (
          <View>
            {replyTo && (
              <View style={styles.replyBar}>
                <Text style={styles.replyBarText} numberOfLines={1}>
                  Replying to {replyTo.author}
                </Text>
                <Pressable onPress={() => setReplyTo(null)} accessibilityLabel="Cancel reply" hitSlop={8}>
                  <Ionicons name="close" size={16} color={colors.muted} />
                </Pressable>
              </View>
            )}
            <View style={styles.composer}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder={replyTo ? `Reply to ${replyTo.author}…` : 'Add a comment…'}
                placeholderTextColor={colors.muted}
                value={draft}
                onChangeText={setDraft}
                multiline
              />
              <Pressable
                onPress={() => void post()}
                disabled={!draft.trim() || posting}
                accessibilityLabel={replyTo ? 'Post reply' : 'Post comment'}
                hitSlop={8}
              >
                <Ionicons name="send" size={24} color={draft.trim() ? colors.accent : colors.muted} />
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            style={styles.composer}
            onPress={() => {
              onClose();
              router.push('/signin');
            }}
          >
            <Text style={styles.link}>Sign in to comment</Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetComment({
  comment,
  rootId,
  signedIn,
  onLike,
  onReply,
  isReply,
}: {
  comment: CommentItem;
  rootId: string;
  signedIn: boolean;
  onLike: (c: CommentItem, liked: boolean) => void;
  onReply: (rootId: string, author: string) => void;
  isReply?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const removed = comment.status !== 'visible';
  const replyCount = comment.replies.length;
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (signedIn && !comment.likedByMe) runOnJS(onLike)(comment, true);
    });

  return (
    <View style={[styles.row, isReply && styles.replyRow]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {comment.author.displayName.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowBody}>
        {removed ? (
          <Text style={styles.removed}>Comment removed.</Text>
        ) : (
          <GestureDetector gesture={doubleTap}>
            <View>
              <Text style={styles.author}>
                {comment.author.displayName}
                {comment.authorIsCreator ? ' · Creator' : ''}
              </Text>
              <Text style={styles.body}>{comment.body}</Text>
            </View>
          </GestureDetector>
        )}
        {!removed && signedIn && (
          <Pressable
            onPress={() => onReply(rootId, comment.author.displayName)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Reply to ${comment.author.displayName}`}
          >
            <Text style={styles.replyBtn}>Reply</Text>
          </Pressable>
        )}
        {!isReply && replyCount > 0 && (
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Hide replies' : `View ${replyCount} replies`}
          >
            <Text style={styles.viewReplies}>
              {expanded ? 'Hide replies' : `View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
            </Text>
          </Pressable>
        )}
        {!isReply &&
          expanded &&
          comment.replies.map((r) => (
            <SheetComment
              key={r.id}
              comment={r}
              rootId={rootId}
              signedIn={signedIn}
              onLike={onLike}
              onReply={onReply}
              isReply
            />
          ))}
      </View>
      {!removed && (
        <Pressable
          style={styles.likeCol}
          disabled={!signedIn}
          onPress={() => onLike(comment, !comment.likedByMe)}
          accessibilityLabel={comment.likedByMe ? 'Unlike' : 'Like'}
          hitSlop={8}
        >
          <Ionicons
            name={comment.likedByMe ? 'heart' : 'heart-outline'}
            size={18}
            color={comment.likedByMe ? colors.like : colors.muted}
          />
          <Text style={styles.likeText}>{comment.likes || ''}</Text>
        </Pressable>
      )}
    </View>
  );
}

function applyLike(list: CommentItem[], id: string, likes: number, likedByMe: boolean): CommentItem[] {
  return list.map((c) =>
    c.id === id
      ? { ...c, likes, likedByMe }
      : { ...c, replies: applyLike(c.replies, id, likes, likedByMe) },
  );
}

function countVisible(list: CommentItem[]): number {
  return list.reduce(
    (n, c) => n + (c.status === 'visible' ? 1 : 0) + countVisible(c.replies),
    0,
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    height: '68%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.muted, fontSize: 15 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  replyRow: { paddingLeft: 4, paddingVertical: 6 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  rowBody: { flex: 1 },
  author: { color: colors.muted, fontSize: 12, marginBottom: 2 },
  body: { color: colors.text, fontSize: 15, lineHeight: 20 },
  removed: { color: colors.muted, fontStyle: 'italic' },
  replyBtn: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 6 },
  viewReplies: { color: colors.accent, fontSize: 13, fontWeight: '600', marginTop: 8 },
  likeCol: { alignItems: 'center', width: 34, gap: 2 },
  likeText: { color: colors.muted, fontSize: 11 },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  replyBarText: { color: colors.muted, fontSize: 13, flex: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 20,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
  },
  link: { color: colors.accent, fontSize: 15, paddingVertical: 8 },
});
