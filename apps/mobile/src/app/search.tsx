import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, mediaUrl } from '../lib/api';
import { colors, radius } from '../lib/theme';
import type { TitleSummary } from '../lib/types';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TitleSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 1) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const data = await api.get<{ query: string; results: TitleSummary[] }>(
          `/api/catalog/search?q=${encodeURIComponent(term)}`,
        );
        setResults(data.results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            style={styles.input}
            value={q}
            onChangeText={setQ}
            placeholder="Search titles and creators"
            placeholderTextColor={colors.muted}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search Sweam"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {loading && <ActivityIndicator color={colors.accent} style={{ marginTop: 28 }} />}

      {!loading && results !== null && results.length === 0 && (
        <Text style={styles.empty}>No results for “{q.trim()}”.</Text>
      )}

      {!loading && results !== null && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => <ResultRow title={item} />}
        />
      )}

      {results === null && !loading && (
        <Text style={styles.hint}>Find films, series, skits, and creators across Sweam.</Text>
      )}
    </View>
  );
}

function ResultRow({ title }: { title: TitleSummary }) {
  const poster = mediaUrl(title.posterUrl);
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/t/${title.slug}`)} accessibilityRole="button">
      {poster ? (
        <Image source={{ uri: poster }} style={styles.thumb} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.thumb, styles.placeholder]}>
          <Text style={styles.thumbInitial}>{title.name.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {title.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          @{title.creator.handle} · {title.genre}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  empty: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 28, paddingHorizontal: 24 },
  hint: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 28, paddingHorizontal: 32, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 54, height: 81, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  thumbInitial: { color: colors.accent, fontSize: 24, fontWeight: '800' },
  rowBody: { flex: 1, gap: 3 },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowMeta: { color: colors.muted, fontSize: 13 },
});
