import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api, mediaUrl, videoSource } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import type { WatchPayload } from '../../lib/types';

export default function WatchScreen() {
  const { episodeId } = useLocalSearchParams<{ episodeId: string }>();
  const { user, loading: authLoading, token } = useAuth();
  const [payload, setPayload] = useState<WatchPayload | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    if (authLoading || !episodeId) return;
    api
      .get<WatchPayload>(`/api/watch/${encodeURIComponent(episodeId)}`)
      .then(setPayload)
      .catch((e: unknown) =>
        setError(
          e instanceof ApiError
            ? { code: e.code, message: e.message }
            : { code: 'error', message: 'Could not load this video.' },
        ),
      );
  }, [episodeId, authLoading]);

  const player = useVideoPlayer(
    payload && payload.episode.mediaType !== 'image' ? videoSource(payload.episode.videoUrl, token) : null,
    (p) => {
      p.play();
    },
  );

  // Stop playback (and its audio) whenever this screen loses focus — e.g. the
  // user navigates to another tab or screen — and resume on return.
  useFocusEffect(
    useCallback(() => {
      try {
        player.play();
      } catch {
        /* no source yet */
      }
      return () => {
        try {
          player.pause();
        } catch {
          /* player released */
        }
      };
    }, [player]),
  );

  const shareTitle = useCallback(async () => {
    if (!payload) return;
    const url = `https://sweam.co/t/${payload.title.slug}`;
    try {
      await Share.share({ message: `${payload.title.name} on Sweam\n${url}`, url });
    } catch {
      /* share sheet dismissed */
    }
  }, [payload]);

  const toggleLike = useCallback(async () => {
    if (!payload) return;
    const next = !liked;
    setLiked(next);
    try {
      await (next
        ? api.put(`/api/me/likes/${payload.title.id}`)
        : api.del(`/api/me/likes/${payload.title.id}`));
    } catch {
      setLiked(!next);
    }
  }, [payload, liked]);

  if (authLoading) return <Center><ActivityIndicator color={colors.accent} /></Center>;

  if (error?.code === 'auth_required' || !user) {
    return (
      <Center>
        <Text style={styles.title}>Create a free account to watch</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/signup')}>
          <Text style={styles.primaryBtnText}>Join free</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/signin')}>
          <Text style={styles.link}>Sign in</Text>
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </Center>
    );
  }

  if (error) return <Center><Text style={styles.muted}>{error.message}</Text></Center>;
  if (!payload) return <Center><ActivityIndicator color={colors.accent} /></Center>;

  const { episode, title } = payload;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.playerWrap}>
        {episode.mediaType === 'image' ? (
          <Image
            source={{ uri: mediaUrl(episode.videoUrl) ?? undefined }}
            style={styles.player}
            contentFit="contain"
            accessibilityLabel={`${title.name}: ${episode.name}`}
          />
        ) : (
          <VideoView style={styles.player} player={player} contentFit="contain" nativeControls />
        )}
        <Pressable style={styles.back} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-down" size={28} color="#fff" />
        </Pressable>
      </View>
      <View style={styles.meta}>
        <Text style={styles.name}>{title.name}</Text>
        <Text style={styles.muted}>
          {episode.name} · @{title.creator.handle}
        </Text>
        <Text style={styles.muted} accessibilityLabel={`${title.views} views, ${title.likes} likes`}>
          {title.views.toLocaleString()} views · {title.likes.toLocaleString()} likes
        </Text>
        <View style={styles.actions}>
          <Pressable
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel={liked ? 'Unlike' : 'Like'}
            onPress={() => void toggleLike()}
          >
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={24} color={liked ? colors.like : '#fff'} />
            <Text style={styles.actionText}>{liked ? 'Liked' : 'Like'}</Text>
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Comments"
            onPress={() => router.push(`/t/${title.slug}`)}
          >
            <Ionicons name="chatbubble-outline" size={22} color="#fff" />
            <Text style={styles.actionText}>Comments</Text>
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Share"
            onPress={() => void shareTitle()}
          >
            <Ionicons name="share-outline" size={22} color="#fff" />
            <Text style={styles.actionText}>Share</Text>
          </Pressable>
        </View>
        {episode.synopsis ? <Text style={styles.synopsis}>{episode.synopsis}</Text> : null}
      </View>
    </ScrollView>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={[styles.screen, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  playerWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  player: { width: '100%', height: '100%' },
  back: { position: 'absolute', top: 12, left: 12, padding: 6 },
  meta: { padding: 16, gap: 6 },
  name: { color: colors.text, fontSize: 22, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 24, marginTop: 10 },
  actionBtn: { alignItems: 'center', gap: 4 },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  synopsis: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 10 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10 },
  primaryBtnText: { color: '#04121a', fontSize: 16, fontWeight: '700' },
  link: { color: colors.accent, fontSize: 15 },
});
