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
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Link, router } from 'expo-router';
import { api, videoSource } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import type { FeedItem } from '../../lib/types';

export default function FeedScreen() {
  const { user, loading: authLoading, token } = useAuth();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [listHeight, setListHeight] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: FeedItem[] }>('/api/feed');
      setItems(data.items);
    } catch {
      setError('Could not load the feed.');
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActiveIndex(first.index);
  }).current;
  const viewConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;

  if (authLoading) {
    return <Centered><ActivityIndicator color={colors.accent} /></Centered>;
  }

  if (!user) {
    return (
      <Centered>
        <Text style={styles.gateTitle}>Watch on Sweam</Text>
        <Text style={styles.gateBody}>Create a free account to watch the feed.</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/signup')}>
          <Text style={styles.primaryBtnText}>Join free</Text>
        </Pressable>
        <Link href="/signin" style={styles.link}>
          Sign in
        </Link>
      </Centered>
    );
  }

  if (error) return <Centered><Text style={styles.gateBody}>{error}</Text></Centered>;
  if (!items) return <Centered><ActivityIndicator color={colors.accent} /></Centered>;
  if (items.length === 0) return <Centered><Text style={styles.gateBody}>No clips yet.</Text></Centered>;

  return (
    <View
      style={styles.container}
      onLayout={(e: LayoutChangeEvent) => setListHeight(e.nativeEvent.layout.height)}
    >
      {listHeight > 0 && (
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
          windowSize={3}
          maxToRenderPerBatch={2}
          renderItem={({ item, index }) => (
            <FeedCard
              item={item}
              height={listHeight}
              isActive={index === activeIndex}
              token={token}
            />
          )}
        />
      )}
    </View>
  );
}

function FeedCard({
  item,
  height,
  isActive,
  token,
}: {
  item: FeedItem;
  height: number;
  isActive: boolean;
  token: string | null;
}) {
  const [liked, setLiked] = useState(item.likedByMe);
  const [likeCount, setLikeCount] = useState(item.likes);
  const [paused, setPaused] = useState(false);
  const heart = useSharedValue(0);

  const player = useVideoPlayer(videoSource(item.videoUrl, token), (p) => {
    p.loop = true;
    p.muted = false;
  });

  useEffect(() => {
    if (isActive && !paused) player.play();
    else player.pause();
  }, [isActive, paused, player]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heart.value,
    transform: [{ scale: 0.6 + heart.value }],
  }));

  const like = useCallback(
    async (next: boolean) => {
      setLiked(next);
      setLikeCount((n) => n + (next ? 1 : -1));
      try {
        await (next
          ? api.put(`/api/me/likes/${item.titleId}`)
          : api.del(`/api/me/likes/${item.titleId}`));
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

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      runOnJS(burstLike)();
    });
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(setPaused)((p) => !p);
    });
  const gesture = Gesture.Exclusive(doubleTap, singleTap);

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          <VideoView
            style={StyleSheet.absoluteFill}
            player={player}
            contentFit="cover"
            nativeControls={false}
          />
          <Animated.View style={[styles.heartWrap, heartStyle]} pointerEvents="none">
            <Ionicons name="heart" size={120} color={colors.like} />
          </Animated.View>
          {paused && (
            <View style={styles.pausedWrap} pointerEvents="none">
              <Ionicons name="play" size={72} color="rgba(255,255,255,0.85)" />
            </View>
          )}
        </View>
      </GestureDetector>

      {/* Right-side action rail */}
      <View style={styles.rail}>
        <Pressable
          style={styles.railBtn}
          accessibilityRole="button"
          accessibilityLabel={liked ? `Unlike, ${likeCount} likes` : `Like, ${likeCount} likes`}
          onPress={() => void like(!liked)}
        >
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={34} color={liked ? colors.like : '#fff'} />
          <Text style={styles.railText}>{likeCount}</Text>
        </Pressable>
        <Pressable
          style={styles.railBtn}
          accessibilityRole="button"
          accessibilityLabel={`${item.commentCount} comments`}
          onPress={() => router.push(`/t/${item.slug}`)}
        >
          <Ionicons name="chatbubble-outline" size={32} color="#fff" />
          <Text style={styles.railText}>{item.commentCount}</Text>
        </Pressable>
        <Pressable
          style={styles.railBtn}
          accessibilityRole="button"
          accessibilityLabel="Open title"
          onPress={() => router.push(`/watch/${item.episodeId}`)}
        >
          <Ionicons name="expand-outline" size={30} color="#fff" />
          <Text style={styles.railText}>Watch</Text>
        </Pressable>
      </View>

      {/* Bottom caption */}
      <View style={styles.caption} pointerEvents="box-none">
        <Text style={styles.captionName}>@{item.creator.handle}</Text>
        <Text style={styles.captionText} numberOfLines={2}>
          {item.name}
        </Text>
      </View>
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={[styles.container, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  gateTitle: { color: colors.text, fontSize: 24, fontWeight: '700' },
  gateBody: { color: colors.muted, fontSize: 16, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
    marginTop: 8,
  },
  primaryBtnText: { color: '#04121a', fontSize: 16, fontWeight: '700' },
  link: { color: colors.accent, fontSize: 15, marginTop: 4 },
  heartWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedWrap: {
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
  captionName: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  captionText: { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
});
