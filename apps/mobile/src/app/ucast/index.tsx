import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../lib/api';
import { PollCard, UcastDisclaimer, UcastHeader } from '../../components/UcastBits';
import { colors, radius } from '../../lib/theme';
import {
  UCAST_MIN_WORK_AGE_YEARS,
  UCAST_RESULTS_WITHIN_HOURS,
  UCAST_WORK_KINDS,
  UCAST_WORK_KIND_LABELS,
} from '../../lib/types';
import type { UcastBoard, UcastPollSummary, UcastWorkKind } from '../../lib/types';

type KindFilter = 'all' | UcastWorkKind;

const SECTIONS: { key: keyof UcastBoard; heading: string; hint: string }[] = [
  { key: 'closingSoon', heading: 'Closing this week', hint: 'Cast these before the window shuts.' },
  { key: 'open', heading: 'Open for casting', hint: 'One ballot per member. Resubmitting replaces it.' },
  {
    key: 'awaitingResults',
    heading: 'Closed, results coming',
    hint: `Results are posted within ${UCAST_RESULTS_WITHIN_HOURS} hours of closing.`,
  },
  { key: 'results', heading: 'Latest results', hint: 'The room has spoken.' },
  { key: 'scheduled', heading: 'Opening soon', hint: 'Scheduled polls.' },
];

export default function UcastBoardScreen() {
  const [board, setBoard] = useState<UcastBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');

  const load = useCallback(async () => {
    try {
      setBoard(await api.get<UcastBoard>('/api/ucast'));
      setError(null);
    } catch {
      setError('Could not load UCast.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const byKind = (polls: UcastPollSummary[]) => (kind === 'all' ? polls : polls.filter((p) => p.kind === kind));
  const visible = board
    ? SECTIONS.map((s) => ({ ...s, polls: byKind(board[s.key]) })).filter((s) => s.polls.length > 0)
    : [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      <UcastHeader
        title="UCast"
        right={
          <Pressable
            style={styles.requestBtn}
            onPress={() => router.push('/ucast/request')}
            accessibilityRole="button"
            accessibilityLabel="Request a poll"
          >
            <Text style={styles.requestBtnText}>Request</Text>
          </Pressable>
        }
      />
      <Text style={styles.lead}>
        The recasting room. Pick who you would cast in a classic, one ballot per poll, and agree with other
        members&apos; picks. Hosted by @ucast.
      </Text>
      <UcastDisclaimer />

      <View style={styles.how}>
        <Text style={styles.howHeading} accessibilityRole="header">
          How it works
        </Text>
        <Text style={styles.howLine}>
          1. A poll is a film, series, song, musical or music video at least {UCAST_MIN_WORK_AGE_YEARS} years old,
          with a fixed list of roles.
        </Text>
        <Text style={styles.howLine}>2. Submit one ballot: your pick for each role you care about. Text only.</Text>
        <Text style={styles.howLine}>
          3. Agree with other members&apos; picks. Results post within {UCAST_RESULTS_WITHIN_HOURS} hours of closing.
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
        accessibilityRole="tablist"
        accessibilityLabel="Filter by kind"
      >
        {(['all', ...UCAST_WORK_KINDS] as KindFilter[]).map((k) => {
          const selected = kind === k;
          const label = k === 'all' ? 'All kinds' : UCAST_WORK_KIND_LABELS[k];
          return (
            <Pressable
              key={k}
              onPress={() => setKind(k)}
              style={[styles.filter, selected && styles.filterOn]}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              aria-selected={selected}
            >
              <Text style={[styles.filterText, selected && styles.filterTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {!board && !error && (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} accessibilityLabel="Loading polls" />
      )}
      {board && visible.length === 0 && <Text style={styles.empty}>No polls of this kind yet.</Text>}
      {visible.map((s) => (
        <View key={s.key} style={styles.section}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {s.heading}
          </Text>
          <Text style={styles.sectionHint}>{s.hint}</Text>
          {s.polls.map((p) => (
            <PollCard key={p.id} poll={p} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, marginTop: 4 },
  requestBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  requestBtnText: { color: colors.bg, fontWeight: '800', fontSize: 13 },
  how: { marginHorizontal: 16, marginTop: 14, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  howHeading: { color: colors.text, fontWeight: '700', fontSize: 15, marginBottom: 6 },
  howLine: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 2 },
  filters: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  filter: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  filterOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  filterTextOn: { color: colors.bg },
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 10 },
  empty: { color: colors.muted, paddingHorizontal: 16, marginTop: 10 },
  section: { marginTop: 8 },
  sectionHeading: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16 },
  sectionHint: { color: colors.muted, fontSize: 12, paddingHorizontal: 16, marginBottom: 10, marginTop: 2 },
});
