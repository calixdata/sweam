import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import type { StudioTitleSummary } from '../lib/types';

/**
 * "Your content": lists the signed-in creator's own titles and lets them delete
 * free content outright. Deletion follows the same Blu rule as the web Studio:
 * only titles that have never been Blu can be hard-deleted here. Blu or ex-Blu
 * titles say so and are managed on sweam.co (removal request / make private).
 */
export default function MyContentScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [titles, setTitles] = useState<StudioTitleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ titles: StudioTitleSummary[] }>('/api/studio/titles');
      setTitles(data.titles);
    } catch (err) {
      // Someone who has never posted isn't a creator yet: show the empty state, not an error.
      if (err instanceof ApiError && (err.status === 403 || err.code === 'creator_required')) {
        setTitles([]);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load your content.');
      }
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  function confirmDelete(title: StudioTitleSummary) {
    Alert.alert(
      'Delete this content?',
      `"${title.name}" and its video will be permanently deleted. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void remove(title.id) },
      ],
    );
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await api.del(`/api/studio/titles/${id}`);
      setTitles((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
    } catch (err) {
      Alert.alert('Could not delete', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>Your content</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  if (!user) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.center}>
          <Text style={styles.muted}>Sign in to manage your content.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.push('/signin')}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.center}>
          <Text style={styles.muted}>{error}</Text>
        </View>
      </View>
    );
  }

  if (!titles) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <FlatList
        data={titles}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.muted}>You have not posted anything yet.</Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.push('/record')}>
              <Text style={styles.primaryBtnText}>Record a clip</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => {
          const canDelete = !item.isBlu && !item.everBlu;
          const kindLabel = item.kind === 'short' ? 'Clip' : item.kind;
          return (
            <View style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.meta}>
                  {kindLabel} · {item.published ? 'Live' : 'Draft'}
                  {item.episodeCount > 1 ? ` · ${item.episodeCount} episodes` : ''}
                </Text>
              </View>
              {canDelete ? (
                <Pressable
                  onPress={() => confirmDelete(item)}
                  disabled={busyId === item.id}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.name}`}
                  style={styles.deleteBtn}
                >
                  {busyId === item.id ? (
                    <ActivityIndicator color={colors.danger} size="small" />
                  ) : (
                    <Ionicons name="trash-outline" size={22} color={colors.danger} />
                  )}
                </Pressable>
              ) : (
                <Text style={styles.bluNote}>Blu · manage on sweam.co</Text>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  empty: { alignItems: 'center', gap: 12, paddingTop: 80, paddingHorizontal: 24 },
  muted: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#04121a', fontSize: 16, fontWeight: '700' },
  row: {
    marginTop: 10,
    marginHorizontal: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowBody: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 13 },
  deleteBtn: { padding: 6 },
  bluNote: { color: colors.muted, fontSize: 12, maxWidth: 110, textAlign: 'right' },
});
