import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { api, ApiError, mediaUrl } from '../../lib/api';
import { BluBadge } from '../../components/BluBadge';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import type { CommentItem, TitleDetail } from '../../lib/types';

/** "October 10, 2026" for a release instant, as a date in the Eastern zone. */
function releaseDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function TitleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { user } = useAuth();
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ rootId: string; author: string } | null>(null);
  const inputRef = useRef<TextInput>(null);

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

  const startReply = useCallback((rootId: string, author: string) => {
    setReplyTo({ rootId, author });
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const postComment = useCallback(async () => {
    if (!draft.trim() || !slug) return;
    try {
      await api.post(`/api/titles/${encodeURIComponent(slug)}/comments`, {
        body: draft.trim(),
        parentId: replyTo?.rootId ?? null,
      });
      setDraft('');
      setReplyTo(null);
      await loadComments();
    } catch {
      /* ignore */
    }
  }, [draft, slug, replyTo, loadComments]);

  const subscribeBlu = useCallback(async () => {
    if (!title) return;
    if (!user) {
      router.push('/signup');
      return;
    }
    try {
      const { url } = await api.post<{ url: string }>(`/api/stripe/blu/${title.creator.handle}`);
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      Alert.alert('Subscribe', e instanceof ApiError ? e.message : 'Could not start checkout.');
    }
  }, [title, user]);

  if (error) return <Center><Text style={styles.muted}>{error}</Text></Center>;
  if (!title) return <Center><ActivityIndicator color={colors.accent} /></Center>;

  // Play starts the first episode that can actually stream; a fully scheduled
  // title shows its release date and a reminder button instead.
  const firstEpisode = title.episodes.find((ep) => ep.released !== false) ?? null;
  const firstUpcoming = title.episodes.find((ep) => ep.released === false) ?? null;
  const scheduled = title.episodes.filter((ep) => ep.released === false);

  async function toggleReminder(episodeId: string, current: boolean | undefined) {
    if (!title) return;
    if (!user) {
      router.push('/signin');
      return;
    }
    try {
      const data = current
        ? await api.del<{ reminderSet: boolean }>(`/api/me/release-reminders/${episodeId}`)
        : await api.put<{ reminderSet: boolean }>(`/api/me/release-reminders/${episodeId}`);
      setTitle({
        ...title,
        episodes: title.episodes.map((ep) => (ep.id === episodeId ? { ...ep, reminderSet: data.reminderSet } : ep)),
      });
    } catch (e) {
      Alert.alert('Reminder', e instanceof ApiError ? e.message : 'Could not update the reminder.');
    }
  }

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
        <Pressable
          style={styles.creatorRow}
          onPress={() => router.push(`/c/${title.creator.handle}`)}
          accessibilityRole="button"
          accessibilityLabel={`View ${title.creator.displayName}'s profile`}
        >
          <Ionicons name="person-circle-outline" size={18} color={colors.accent} />
          <Text style={styles.creatorText}>@{title.creator.handle}</Text>
          {title.creator.verified && (
            <Ionicons name="checkmark-circle" size={16} color={colors.pink} accessibilityLabel="Verified account" />
          )}
          <Ionicons name="chevron-forward" size={14} color={colors.muted} />
        </Pressable>
        {title.isBlu && (
          <View style={styles.bluRow}>
            <BluBadge height={22} label />
            <Text style={styles.bluText}>
              {title.bluPriceCents != null ? `$${(title.bluPriceCents / 100).toFixed(2)}/mo · ` : ''}
              Subscribers only
            </Text>
          </View>
        )}
        <Text style={styles.metaLine} numberOfLines={1}>
          {[title.kind, title.audiences?.[0], title.genre, title.advisory].filter(Boolean).join('  ·  ')}
        </Text>
        <Text style={styles.stats}>
          {title.views.toLocaleString()} views · {title.likes.toLocaleString()} likes ·{' '}
          {title.commentCount.toLocaleString()} comments
        </Text>
        <Text style={styles.synopsis}>{title.synopsis}</Text>

        {!firstEpisode && firstUpcoming?.releaseAt && (
          <View>
            <Text style={styles.releaseLine} accessibilityLiveRegion="polite">
              Releases {releaseDay(firstUpcoming.releaseAt)} at 12:00 AM Eastern.
            </Text>
            <Pressable
              style={styles.playBtn}
              onPress={() => void toggleReminder(firstUpcoming.id, firstUpcoming.reminderSet)}
              accessibilityRole="button"
              accessibilityState={{ selected: Boolean(firstUpcoming.reminderSet) }}
            >
              <Ionicons name={firstUpcoming.reminderSet ? 'notifications' : 'notifications-outline'} size={18} color="#04121a" />
              <Text style={styles.playText}>
                {firstUpcoming.reminderSet ? 'Reminder set for release day' : 'Notify me on release day'}
              </Text>
            </Pressable>
          </View>
        )}

        {firstEpisode &&
          (title.isBlu && !title.bluAccess ? (
            <Pressable style={styles.playBtn} onPress={() => void subscribeBlu()}>
              <Ionicons name="lock-closed" size={18} color="#04121a" />
              <Text style={styles.playText}>
                Subscribe{title.bluPriceCents != null ? ` $${(title.bluPriceCents / 100).toFixed(2)}/mo` : ''}
              </Text>
            </Pressable>
          ) : (
            <Pressable style={styles.playBtn} onPress={() => router.push(`/watch/${firstEpisode.id}`)}>
              <Ionicons name="play" size={20} color="#04121a" />
              <Text style={styles.playText}>{title.episodes.length > 1 ? 'Play S1 E1' : 'Play'}</Text>
            </Pressable>
          ))}

        {scheduled.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Coming up</Text>
            {scheduled.map((ep) => (
              <View key={ep.id} style={styles.upcomingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upcomingName}>
                    S{ep.season} E{ep.episode}: {ep.name}
                  </Text>
                  <Text style={styles.releaseLine}>
                    Releases {ep.releaseAt ? releaseDay(ep.releaseAt) : 'soon'} at 12:00 AM Eastern
                  </Text>
                </View>
                <Pressable
                  onPress={() => void toggleReminder(ep.id, ep.reminderSet)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={ep.reminderSet ? 'Reminder set. Tap to remove.' : 'Notify me on release day'}
                  accessibilityState={{ selected: Boolean(ep.reminderSet) }}
                >
                  <Ionicons
                    name={ep.reminderSet ? 'notifications' : 'notifications-outline'}
                    size={24}
                    color={ep.reminderSet ? colors.pink : colors.text}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Comments</Text>
        {user ? (
          <View style={styles.composer}>
            {replyTo && (
              <View style={styles.replyBar}>
                <Text style={styles.replyBarText} numberOfLines={1}>
                  Replying to {replyTo.author}
                </Text>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityLabel="Cancel reply">
                  <Ionicons name="close" size={16} color={colors.muted} />
                </Pressable>
              </View>
            )}
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={replyTo ? `Reply to ${replyTo.author}…` : 'Add a comment'}
              placeholderTextColor={colors.muted}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <Pressable style={styles.postBtn} onPress={() => void postComment()} disabled={!draft.trim()}>
              <Text style={styles.postText}>{replyTo ? 'Reply' : 'Post'}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => router.push('/signin')}>
            <Text style={styles.link}>Sign in to join the conversation</Text>
          </Pressable>
        )}

        {comments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            rootId={c.id}
            signedIn={user !== null}
            onLike={setCommentLike}
            onReply={startReply}
          />
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
          <View style={styles.commentActions}>
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
            {signedIn && (
              <Pressable
                onPress={() => onReply(rootId, comment.author.displayName)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Reply to ${comment.author.displayName}`}
              >
                <Text style={styles.replyBtn}>Reply</Text>
              </Pressable>
            )}
          </View>
        </>
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
          <CommentRow
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
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  creatorText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  bluRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  bluText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
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
  releaseLine: { color: '#f5c47c', fontSize: 14, marginTop: 6 },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  upcomingName: { color: colors.text, fontSize: 15, fontWeight: '600' },
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
  commentActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  commentLike: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentLikeText: { color: colors.muted, fontSize: 13 },
  replyBtn: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  viewReplies: { color: colors.accent, fontSize: 13, fontWeight: '600', marginTop: 8 },
  replyBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 2 },
  replyBarText: { color: colors.muted, fontSize: 13, flex: 1 },
});
