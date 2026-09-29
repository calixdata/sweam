import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { api, mediaUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import type { CommentItem, TitleDetail } from '../../lib/types';

export default function TitleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { user } = useAuth();
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    if (!slug) return;
    try {
      const data = await api.get<{ comments: CommentItem[] }>(
        `/api/titles/${encodeURIComponent(slug)}/comments`,
      );
      setComments(data.comments);
    } catch {
      /* comments are non-critical */
    }
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    api
      .get<TitleDetail>(`/api/titles/${encodeURIComponent(slug)}`)
      .then(setTitle)
      .catch(() => setError('Could not load this title.'));
    void loadComments();
  }, [slug, loadComments]);

  const setCommentLike = useCallback(async (comment: CommentItem, liked: boolean) => {
    setComments((cur) => applyLike(cur, comment.id, comment.likes + (liked ? 1 : -1), liked));
    try {
      const res = await (liked
        ? api.put<{ likes: number; likedByMe: boolean }>(`/api/comments/${comment.id}/like`)
        : api.del<{ likes: number; likedByMe: boolean }>(`/api/comments/${comment.id}/like`));
      setComments((cur) => applyLike(cur, comment.id, res.likes, res.likedByMe));
    } catch {
      setComments((cur) => applyLike(cur, comment.id, comment.likes, comment.likedByMe));
    }
  }, []);

  const postComment = useCallback(async () => {
    if (!draft.trim() || !slug) return;
    try {
      await api.post(`/api/titles/${encodeURIComponent(slug)}/comments`, {
        body: draft.trim(),
        parentId: null,
      });
      setDraft('');
      await loadComments();
    } catch {
      /* ignore */
    }
  }, [draft, slug, loadComments]);

  if (error) return <Center><Text style={styles.muted}>{error}</Text></Center>;
  if (!title) return <Center><ActivityIndicator color={colors.accent} /></Center>;

  const firstEpisode = title.episodes[0];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 48 }}>
      <View style={styles.heroWrap}>
        {title.heroUrl || title.posterUrl ? (
          <Image
            source={{ uri: mediaUrl(title.heroUrl ?? title.posterUrl) ?? undefined }}
            style={styles.hero}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.hero, styles.placeholder]} />
        )}
        <Pressable style={styles.back} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={styles.name}>{title.name}</Text>
        <Text style={styles.metaLine} numberOfLines={1}>
          {[title.kind, title.audiences?.[0], title.genre, title.advisory].filter(Boolean).join('  ·  ')}
        </Text>
        <Text style={styles.stats}>
          {title.views.toLocaleString()} views · {title.likes.toLocaleString()} likes ·{' '}
          {title.commentCount.toLocaleString()} comments
        </Text>
        <Text style={styles.synopsis}>{title.synopsis}</Text>

        {firstEpisode && (
          <Pressable style={styles.playBtn} onPress={() => router.push(`/watch/${firstEpisode.id}`)}>
            <Ionicons name="play" size={20} color="#04121a" />
            <Text style={styles.playText}>{title.episodes.length > 1 ? 'Play S1 E1' : 'Play'}</Text>
          </Pressable>
        )}

        <Text style={styles.sectionTitle}>Comments</Text>
        {user ? (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Add a comment"
              placeholderTextColor={colors.muted}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <Pressable style={styles.postBtn} onPress={() => void postComment()} disabled={!draft.trim()}>
              <Text style={styles.postText}>Post</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => router.push('/signin')}>
            <Text style={styles.link}>Sign in to join the conversation</Text>
          </Pressable>
        )}

        {comments.map((c) => (
          <CommentRow key={c.id} comment={c} signedIn={user !== null} onLike={setCommentLike} />
        ))}
      </View>
    </ScrollView>
  );
}

function applyLike(list: CommentItem[], id: string, likes: number, likedByMe: boolean): CommentItem[] {
  return list.map((c) =>
    c.id === id
      ? { ...c, likes, likedByMe }
      : { ...c, replies: applyLike(c.replies, id, likes, likedByMe) },
  );
}

function CommentRow({
  comment,
  signedIn,
  onLike,
  isReply,
}: {
  comment: CommentItem;
  signedIn: boolean;
  onLike: (c: CommentItem, liked: boolean) => void;
  isReply?: boolean;
}) {
  const removed = comment.status !== 'visible';
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (signedIn && !comment.likedByMe) runOnJS(onLike)(comment, true);
    });

  return (
    <View style={[styles.comment, isReply && styles.reply]}>
      {removed ? (
        <Text style={styles.removed}>Comment removed.</Text>
      ) : (
        <>
          <GestureDetector gesture={doubleTap}>
            <View>
              <Text style={styles.commentMeta}>
                {comment.author.displayName}
                {comment.authorIsCreator ? ' · Creator' : ''}
              </Text>
              <Text style={styles.commentBody}>{comment.body}</Text>
            </View>
          </GestureDetector>
          <Pressable
            style={styles.commentLike}
            disabled={!signedIn}
            accessibilityRole="button"
            accessibilityLabel={comment.likedByMe ? 'Unlike comment' : 'Like comment'}
            onPress={() => onLike(comment, !comment.likedByMe)}
          >
            <Ionicons
              name={comment.likedByMe ? 'heart' : 'heart-outline'}
              size={16}
              color={comment.likedByMe ? colors.like : colors.muted}
            />
            <Text style={styles.commentLikeText}>{comment.likes}</Text>
          </Pressable>
        </>
      )}
      {comment.replies.map((r) => (
        <CommentRow key={r.id} comment={r} signedIn={signedIn} onLike={onLike} isReply />
      ))}
    </View>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={[styles.screen, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: colors.muted, fontSize: 15 },
  heroWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface2 },
  hero: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: colors.surface2 },
  back: { position: 'absolute', top: 12, left: 12, padding: 6, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 20 },
  body: { padding: 16, gap: 8 },
  name: { color: colors.text, fontSize: 26, fontWeight: '800' },
  metaLine: { color: colors.muted, fontSize: 13 },
  stats: { color: colors.muted, fontSize: 13 },
  synopsis: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 4 },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  playText: { color: '#04121a', fontSize: 16, fontWeight: '700' },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 20 },
  composer: { gap: 8 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    padding: 12,
    minHeight: 44,
  },
  postBtn: { alignSelf: 'flex-start', backgroundColor: colors.accent, paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8 },
  postText: { color: '#04121a', fontWeight: '700' },
  link: { color: colors.accent, fontSize: 15 },
  comment: { paddingVertical: 10, borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth },
  reply: { paddingLeft: 16 },
  removed: { color: colors.muted, fontStyle: 'italic' },
  commentMeta: { color: colors.muted, fontSize: 12, marginBottom: 2 },
  commentBody: { color: colors.text, fontSize: 15 },
  commentLike: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  commentLikeText: { color: colors.muted, fontSize: 13 },
});
