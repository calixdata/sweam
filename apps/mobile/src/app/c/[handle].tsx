import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, mediaUrl } from '../../lib/api';
import { BluBadge } from '../../components/BluBadge';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import type { CreatorPublicPage } from '../../lib/types';

export default function CreatorScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [page, setPage] = useState<CreatorPublicPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!handle) return;
    api
      .get<CreatorPublicPage>(`/api/creators/${encodeURIComponent(handle)}`)
      .then((p) => {
        setPage(p);
        setFollowing(p.followedByMe);
        setFollowerCount(p.followerCount);
      })
      .catch(() => setError('Could not load this creator.'));
  }, [handle]);

  const toggleFollow = useCallback(async () => {
    if (!handle || busy) return;
    if (!user) {
      router.push('/signin');
      return;
    }
    const next = !following;
    setBusy(true);
    setFollowing(next);
    setFollowerCount((n) => Math.max(0, n + (next ? 1 : -1)));
    try {
      await (next
        ? api.put(`/api/creators/${encodeURIComponent(handle)}/follow`)
        : api.del(`/api/creators/${encodeURIComponent(handle)}/follow`));
    } catch {
      setFollowing(!next);
      setFollowerCount((n) => Math.max(0, n + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }, [handle, busy, user, following]);

  if (error) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.muted}>{error}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }
  if (!page) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const gap = 8;
  const pad = 12;
  const col = Math.floor((width - pad * 2 - gap * 2) / 3);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{page.displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{page.displayName}</Text>
          {page.verified && <Ionicons name="checkmark-circle" size={18} color={colors.accent} />}
        </View>
        <Text style={styles.handle}>@{page.handle}</Text>
        <Text style={styles.followers}>
          {followerCount.toLocaleString()} {followerCount === 1 ? 'follower' : 'followers'} ·{' '}
          {page.titles.length} {page.titles.length === 1 ? 'title' : 'titles'}
        </Text>
        {page.bio ? <Text style={styles.bio}>{page.bio}</Text> : null}
        <Pressable
          style={[styles.followBtn, following && styles.followingBtn]}
          onPress={() => void toggleFollow()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ selected: following }}
          accessibilityLabel={
            following ? `Following ${page.displayName}. Tap to unfollow.` : `Follow ${page.displayName}`
          }
        >
          <Ionicons name={following ? 'checkmark' : 'add'} size={18} color={following ? colors.text : colors.bg} />
          <Text style={[styles.followText, following && styles.followingText]}>
            {following ? 'Following' : 'Follow'}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.gridHeading}>Titles</Text>
      {page.titles.length === 0 ? (
        <Text style={[styles.muted, { paddingHorizontal: pad }]}>No published titles yet.</Text>
      ) : (
        <View style={[styles.grid, { paddingHorizontal: pad, gap }]}>
          {page.titles.map((t) => {
            const poster = mediaUrl(t.posterUrl);
            return (
              <Pressable key={t.id} style={{ width: col }} onPress={() => router.push(`/t/${t.slug}`)}>
                {poster ? (
                  <Image
                    source={{ uri: poster }}
                    style={{ width: col, height: col * 1.5, borderRadius: radius.sm }}
                    contentFit="cover"
                    transition={150}
                  />
                ) : (
                  <View style={[{ width: col, height: col * 1.5, borderRadius: radius.sm }, styles.placeholder]}>
                    <Text style={styles.posterInitial}>{t.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                {t.isBlu && (
                  <View style={{ position: 'absolute', top: 6, right: 6 }}>
                    <BluBadge height={16} />
                  </View>
                )}
                <Text style={styles.cardName} numberOfLines={1}>
                  {t.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  link: { color: colors.accent, fontSize: 15 },
  header: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 4 },
  back: { position: 'absolute', left: 12, top: 8, zIndex: 2 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  avatarText: { color: colors.accent, fontSize: 38, fontWeight: '800' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.text, fontSize: 22, fontWeight: '800' },
  handle: { color: colors.muted, fontSize: 15 },
  followers: { color: colors.muted, fontSize: 13, marginTop: 2 },
  bio: { color: colors.text, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: radius.pill,
    marginTop: 12,
  },
  followingBtn: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  followText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  followingText: { color: colors.text },
  gridHeading: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginTop: 18, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  posterInitial: { color: colors.accent, fontSize: 34, fontWeight: '800' },
  cardName: { color: colors.text, fontSize: 12, fontWeight: '600', marginTop: 6, marginBottom: 4 },
});
