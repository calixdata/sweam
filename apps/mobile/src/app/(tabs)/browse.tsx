import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api, mediaUrl } from '../../lib/api';
import { BluBadge } from '../../components/BluBadge';
import { colors, radius } from '../../lib/theme';
import type { HomePayload, TitleSummary } from '../../lib/types';

export default function BrowseScreen() {
  const [payload, setPayload] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<HomePayload>('/api/catalog/home')
      .then(setPayload)
      .catch(() => setError('Could not load the catalog.'));
  }, []);

  if (error) return <View style={[styles.screen, styles.centered]}><Text style={styles.muted}>{error}</Text></View>;
  if (!payload) return <View style={[styles.screen, styles.centered]}><ActivityIndicator color={colors.accent} /></View>;

  const spotlight = payload.rails.find((r) => r.key === 'spotlight');
  const feature = spotlight?.titles[0] ?? payload.rails[0]?.titles[0] ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.brand}>SWEAM</Text>
      <Pressable
        style={styles.searchBar}
        onPress={() => router.push('/search')}
        accessibilityRole="button"
        accessibilityLabel="Search Sweam"
      >
        <Ionicons name="search" size={18} color={colors.muted} />
        <Text style={styles.searchText}>Search @usernames, titles, and creators</Text>
      </Pressable>
      {feature && (
        <Pressable style={styles.hero} onPress={() => router.push(`/t/${feature.slug}`)}>
          {feature.heroUrl || feature.posterUrl ? (
            <Image
              source={{ uri: mediaUrl(feature.heroUrl ?? feature.posterUrl) ?? undefined }}
              style={styles.heroImg}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={[styles.heroImg, styles.placeholder]} />
          )}
          <View style={styles.heroOverlay}>
            <Text style={styles.eyebrow}>Featured on Sweam</Text>
            <Text style={styles.heroTitle}>{feature.name}</Text>
            <Text style={styles.heroMeta} numberOfLines={1}>
              {[feature.kind, feature.audiences?.[0], feature.genre, feature.advisory]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
          </View>
        </Pressable>
      )}

      {payload.rails
        .filter((r) => r.titles.length > 0)
        .map((rail) => (
          <View key={rail.key} style={styles.rail}>
            <Text style={styles.railHeading}>{rail.heading}</Text>
            <FlatList
              horizontal
              data={rail.titles}
              keyExtractor={(t) => t.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 12 }}
              renderItem={({ item }) => <PosterCard title={item} />}
            />
          </View>
        ))}
    </ScrollView>
  );
}

function PosterCard({ title }: { title: TitleSummary }) {
  const poster = mediaUrl(title.posterUrl);
  return (
    <Pressable style={styles.card} onPress={() => router.push(`/t/${title.slug}`)}>
      <View style={styles.posterWrap}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.poster, styles.placeholder]}>
            <Text style={styles.posterInitial}>{title.name.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        {title.isBlu && (
          <View style={styles.bluOnPoster}>
            <BluBadge height={18} />
          </View>
        )}
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {title.name}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {title.genre}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.muted, fontSize: 16 },
  brand: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 3,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  searchText: { color: colors.muted, fontSize: 15 },
  hero: { margin: 12, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  heroImg: { width: '100%', aspectRatio: 16 / 10 },
  heroOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: 'rgba(8,14,25,0.55)',
  },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  heroTitle: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 2 },
  heroMeta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  rail: { marginTop: 18 },
  railHeading: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  card: { width: 120 },
  posterWrap: { width: 120, position: 'relative' },
  bluOnPoster: { position: 'absolute', top: 6, right: 6 },
  poster: { width: 120, height: 180, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  posterInitial: { color: colors.accent, fontSize: 40, fontWeight: '800' },
  cardName: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
  cardMeta: { color: colors.muted, fontSize: 12 },
});
