import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewToken,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, router, useFocusEffect } from 'expo-router';
import { api, mediaUrl, videoSource } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useIntroDone } from '../../lib/intro';
import { colors } from '../../lib/theme';
import type { FeedItem } from '../../lib/types';
import { CommentsSheet } from '../../components/CommentsSheet';

type FeedTab = 'following' | 'foryou';

export default function FeedScreen() {
  const { user, loading: authLoading, token } = useAuth();
  const insets = useSafeAreaInsets();
  const [feedTab, setFeedTab] = useState<FeedTab>('foryou');
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const [commentSlug, setCommentSlug] = useState<string | null>(null);
  const [screenFocused, setScreenFocused] = useState(true);

  // Pause all feed playback when the Home tab/screen loses focus so audio never
  // bleeds into other tabs or screens.
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  const load = useCallback(async () => {
    if (!user) return;
    setItems(null);
    setActiveIndex(0);
    setError(null);
    try {
      const path = feedTab === 'following' ? '/api/feed?following=1' : '/api/feed';
      const data = await api.get<{ items: FeedItem[] }>(path);
      setItems(data.items);
    } catch {
      setError('Could not load the feed.');
    }
  }, [user, feedTab]);

  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActiveIndex(first.index);
  }).current;
  const viewConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  if (authLoading) return <Centered><ActivityIndicator color={colors.accent} /></Centered>;

  if (!user) {
    return (
      <Centered>
        <Text style={styles.gateTitle}>Watch on Sweam</Text>
        <Text style={styles.gateBody}>Create a free account to watch the feed.</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/signup')}>
          <Text style={styles.primaryBtnText}>Join free</Text>
        </Pressable>
        <Link href="/signin" style={styles.link}>Sign in</Link>
      </Centered>
    );
  }

  const topTabs = (
    <View style={[styles.topTabs, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable
        onPress={() => setFeedTab('following')}
        accessibilityRole="tab"
        accessibilityState={{ selected: feedTab === 'following' }}
        hitSlop={8}
      >
        <Text style={[styles.topTab, feedTab === 'following' && styles.topTabActive]}>Following</Text>
      </Pressable>
      <Pressable
        onPress={() => setFeedTab('foryou')}
        accessibilityRole="tab"
        accessibilityState={{ selected: feedTab === 'foryou' }}
        hitSlop={8}
      >
        <Text style={[styles.topTab, feedTab === 'foryou' && styles.topTabActive]}>For You</Text>
      </Pressable>
    </View>
  );

  return (
    <View
      style={styles.container}
      onLayout={(e: LayoutChangeEvent) => setListHeight(e.nativeEvent.layout.height)}
    >
      {listHeight > 0 && items && items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(item) => item.titleId}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={listHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewConfig}
          getItemLayout={(_, index) => ({ length: listHeight, offset: listHeight * index, index })}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <FeedCard
              item={item}
              height={listHeight}
              isActive={index === activeIndex}
              // Preload the current and the next clip only; everything else is a poster.
              isNear={index === activeIndex || index === activeIndex + 1}
              screenFocused={screenFocused}
              token={token}
              onOpenComments={() => setCommentSlug(item.slug)}
            />
          )}
        />
      )}

      {!items && !error && (
        <View style={[StyleSheet.absoluteFill, styles.centeredOverlay]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      {error && (
        <View style={[StyleSheet.absoluteFill, styles.centeredOverlay]}>
          <Text style={styles.gateBody}>{error}</Text>
        </View>
      )}
      {items && items.length === 0 && (
        <View style={[StyleSheet.absoluteFill, styles.centeredOverlay]}>
          <Text style={styles.gateBody}>
            {feedTab === 'following'
              ? 'Clips from creators you follow will show here.'
              : 'No clips yet.'}
          </Text>
          {feedTab === 'following' && (
            <Pressable onPress={() => router.push('/(tabs)/browse')}>
              <Text style={styles.link}>Find creators to follow</Text>
            </Pressable>
          )}
        </View>
      )}

      {topTabs}

      <CommentsSheet
        slug={commentSlug}
        visible={commentSlug !== null}
        signedIn={user !== null}
        onClose={() => setCommentSlug(null)}
      />
    </View>
  );
}

function FeedCard({
  item,
  height,
  isActive,
  isNear,
  screenFocused,
  token,
  onOpenComments,
}: {
  item: FeedItem;
  height: number;
  isActive: boolean;
  isNear: boolean;
  screenFocused: boolean;
  token: string | null;
  onOpenComments: () => void;
}) {
  const [liked, setLiked] = useState(item.likedByMe);
  const [likeCount, setLikeCount] = useState(item.likes);
  const [paused, setPaused] = useState(false);
  const [showPoster, setShowPoster] = useState(true);
  // How the video sits in the cell: 'cover' fills the screen (vertical clips),
  // 'contain' shows the whole frame over the blurred backdrop (wider clips).
  const [fit, setFit] = useState<'cover' | 'contain'>('contain');
  const heart = useSharedValue(0);
  const poster = mediaUrl(item.posterUrl);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = false;
  });

  // Load the video only for the active clip and the next one (single stream while
  // watching), so the feed does not buffer on many videos at once.
  const isImage = item.mediaType === 'image';
  const introDone = useIntroDone();
  useEffect(() => {
    // Not before the launch animation hands off: a loaded video surface would
    // show through it even while paused.
    if (isNear && !isImage && introDone) {
      try {
        player.replace(videoSource(item.videoUrl, token));
      } catch {
        /* player may be released mid-scroll */
      }
    }
  }, [isNear, isImage, introDone, item.videoUrl, token, player]);

  // Only the active, un-paused card plays — and only while the screen is focused,
  // so leaving the tab/screen stops the audio.
  useEffect(() => {
    // Nothing plays (or sounds) under the launch animation.
    if (isActive && !paused && screenFocused && !isImage && introDone) player.play();
    else player.pause();
  }, [isActive, paused, screenFocused, player, isImage, introDone]);

  // Choose the fit from the video's real shape once its source metadata loads:
  // portrait clips fill the screen; landscape clips show the whole frame. Falls
  // back to 'contain' (never crops a cinematic frame) until the size is known.
  useEffect(() => {
    const sub = player.addListener('sourceLoad', ({ availableVideoTracks }) => {
      const size = availableVideoTracks?.find(
        (t) => t.size && t.size.width > 0 && t.size.height > 0,
      )?.size;
      if (size) setFit(size.width < size.height ? 'cover' : 'contain');
    });
    return () => sub.remove();
  }, [player]);

  // Hide the poster once the active video is actually playing.
  useEffect(() => {
    if (!isActive) {
      setShowPoster(true);
      return;
    }
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) setShowPoster(false);
    });
    return () => sub.remove();
  }, [isActive, player]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heart.value,
    transform: [{ scale: 0.6 + heart.value }],
  }));

  const like = useCallback(
    async (next: boolean) => {
      setLiked(next);
      setLikeCount((n) => n + (next ? 1 : -1));
      try {
        await (next ? api.put(`/api/me/likes/${item.titleId}`) : api.del(`/api/me/likes/${item.titleId}`));
      } catch {
        setLiked(!next);
        setLikeCount((n) => n + (next ? -1 : 1));
      }
    },
    [item.titleId],
  );

  const burstLike = useCallback(() => {
    heart.value = withSequence(withTiming(1, { duration: 140 }), withTiming(0, { duration: 420 }));
    if (!liked) void like(true);
  }, [heart, liked, like]);

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDuration(300).onEnd(() => runOnJS(burstLike)());
  // runOnJS cannot carry a function argument across the worklet boundary, so
  // the updater form of setPaused never arrived and taps did nothing.
  const togglePaused = useCallback(() => setPaused((p) => !p), []);
  const singleTap = Gesture.Tap().numberOfTaps(1).onEnd(() => runOnJS(togglePaused)());
  const gesture = Gesture.Exclusive(doubleTap, singleTap);

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      {/* A heavily blurred, darkened copy fills the cell as ambient backdrop, so
          a non-vertical video (e.g. a 16:9 cinematic episode) reads as a full
          frame over soft darkness instead of hard black bars — and never over
          recognizable cover art. */}
      {poster && (
        <Image
          source={{ uri: poster }}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          contentFit="cover"
          blurRadius={40}
        />
      )}
      {/* The sharp poster (full frame, contain) ONLY while the video has not
          started. Once it plays, this is removed so the letterbox gaps show the
          blurred backdrop above — not the artwork sitting behind the video. */}
      {poster && showPoster && (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="contain" />
      )}
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          {isNear && isImage && (
            <Image
              source={{ uri: mediaUrl(item.videoUrl) ?? undefined }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              accessibilityLabel={item.name}
            />
          )}
          {isNear && !isImage && (
            <VideoView
              // Vertical clips fill the screen (cover); wider clips show the
              // whole frame (contain) over the blurred backdrop — chosen per
              // clip from its real dimensions, so nothing is cropped or stretched.
              style={[StyleSheet.absoluteFill, showPoster && isActive ? styles.hidden : null]}
              player={player}
              contentFit={fit}
              nativeControls={false}
            />
          )}
          <Animated.View style={[styles.heartWrap, heartStyle]} pointerEvents="none">
            <Ionicons name="heart" size={120} color={colors.like} />
          </Animated.View>
          {paused && isActive && (
            <View style={styles.heartWrap} pointerEvents="none">
              <Ionicons name="play" size={72} color="rgba(255,255,255,0.85)" />
            </View>
          )}
        </View>
      </GestureDetector>

      <View style={styles.rail}>
        <Pressable
          style={styles.railBtn}
          accessibilityLabel={liked ? `Unlike, ${likeCount} likes` : `Like, ${likeCount} likes`}
          onPress={() => void like(!liked)}
        >
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={34} color={liked ? colors.like : '#fff'} />
          <Text style={styles.railText}>{likeCount}</Text>
        </Pressable>
        <Pressable
          style={styles.railBtn}
          accessibilityLabel={`${item.commentCount} comments`}
          onPress={onOpenComments}
        >
          <Ionicons name="chatbubble-outline" size={32} color="#fff" />
          <Text style={styles.railText}>{item.commentCount}</Text>
        </Pressable>
        <Pressable
          style={styles.railBtn}
          accessibilityLabel="Open full player"
          onPress={() => router.push(`/watch/${item.episodeId}`)}
        >
          <Ionicons name="expand-outline" size={30} color="#fff" />
          <Text style={styles.railText}>Full</Text>
        </Pressable>
      </View>

      <View style={styles.caption} pointerEvents="box-none">
        <Pressable
          onPress={() => router.push(`/c/${item.creator.handle}`)}
          accessibilityRole="button"
          accessibilityLabel={`View @${item.creator.handle}'s profile`}
          style={styles.captionCreator}
        >
          <FeedAvatar uri={mediaUrl(item.creator.avatarUrl)} name={item.creator.displayName} />
          <Text style={styles.captionName}>@{item.creator.handle}</Text>
          {item.creator.verified ? (
            <Ionicons name="checkmark-circle" size={16} color={colors.pink} accessibilityLabel="Verified account" />
          ) : null}
        </Pressable>
        <Text style={styles.captionText} numberOfLines={2}>{item.name}</Text>
        {item.promotedBy ? (
          <Text style={styles.captionPromoted}>Promoted by {item.promotedBy}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** The creator's round profile picture in the feed caption, with an initials fallback. */
function FeedAvatar({ uri, name }: { uri: string | null; name: string }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.feedAvatar} contentFit="cover" />;
  }
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <View style={[styles.feedAvatar, styles.feedAvatarFallback]}>
      <Text style={styles.feedAvatarText}>{initial}</Text>
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={[styles.container, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centeredOverlay: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  hidden: { opacity: 0 },
  // Darkens the blurred backdrop so it reads as ambient darkness, not artwork.
  backdrop: { opacity: 0.45 },
  gateTitle: { color: colors.text, fontSize: 24, fontWeight: '700' },
  gateBody: { color: colors.muted, fontSize: 16, textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10, marginTop: 8 },
  primaryBtnText: { color: '#04121a', fontSize: 16, fontWeight: '700' },
  link: { color: colors.accent, fontSize: 15, marginTop: 4 },
  topTabs: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 10,
  },
  topTab: { color: 'rgba(255,255,255,0.65)', fontSize: 16, fontWeight: '600' },
  topTabActive: {
    color: '#fff',
    fontWeight: '800',
    textDecorationLine: 'underline',
    textDecorationColor: '#fff',
  },
  heartWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: { position: 'absolute', right: 12, bottom: 120, alignItems: 'center', gap: 20 },
  railBtn: { alignItems: 'center', gap: 3 },
  railText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  caption: { position: 'absolute', left: 16, right: 80, bottom: 96 },
  captionCreator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  captionName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  captionText: { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  captionPromoted: { color: '#f5c47c', fontSize: 12, fontWeight: '700', marginTop: 3 },
  feedAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  feedAvatarFallback: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedAvatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
