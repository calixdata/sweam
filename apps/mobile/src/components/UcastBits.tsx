import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { mediaUrl } from '../lib/api';
import { phaseLabel, plural, pollStatusLine } from '../lib/ucast';
import { colors, radius } from '../lib/theme';
import { UCAST_HANDLE, UCAST_WORK_KIND_LABELS } from '../lib/types';
import type { UcastPollSummary } from '../lib/types';

/** The host line on every UCast screen: who runs the room. */
export function UcastDisclaimer() {
  return (
    <View style={styles.disclaimer}>
      <Text style={styles.disclaimerText}>
        Hosted by{' '}
        <Text
          style={styles.hostLink}
          onPress={() => router.push(`/c/${UCAST_HANDLE}`)}
          accessibilityRole="link"
          accessibilityLabel="@ucast, verified. View the UCast profile"
        >
          @{UCAST_HANDLE}
        </Text>
        , Sweam&apos;s own account.
      </Text>
    </View>
  );
}

/** Screen header with a back control and the screen's name. */
export function UcastHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <Pressable
        style={styles.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/browse'))}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

/** One poll on the board. */
export function PollCard({ poll }: { poll: UcastPollSummary }) {
  const cover = mediaUrl(poll.coverUrl);
  const kind = UCAST_WORK_KIND_LABELS[poll.kind];
  const label = `${poll.title} (${poll.year}), ${kind}. ${phaseLabel(poll.phase)}. ${pollStatusLine(poll)}. ${plural(
    poll.roleCount,
    'role',
  )}, ${plural(poll.ballotCount, 'ballot')}.`;
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/ucast/p/${poll.slug}`)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the poll"
    >
      {cover ? (
        <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" transition={150} accessible={false} />
      ) : (
        <View style={[styles.cover, styles.coverEmpty]}>
          <Text style={styles.coverInitial}>{poll.title.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardKind}>
          {kind} · {poll.year}
        </Text>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {poll.title}
        </Text>
        {poll.hook ? (
          <Text style={styles.cardHook} numberOfLines={2}>
            {poll.hook}
          </Text>
        ) : null}
        <View style={styles.pillRow}>
          <Text style={[styles.pill, poll.phase === 'open' && styles.pillOpen]}>{phaseLabel(poll.phase)}</Text>
        </View>
        <Text style={styles.cardMeta}>{pollStatusLine(poll)}</Text>
        <Text style={styles.cardMeta}>
          {plural(poll.roleCount, 'role')} · {plural(poll.ballotCount, 'ballot')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disclaimer: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  disclaimerText: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  hostLink: { color: colors.accent, fontWeight: '700' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 4,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' },
  headerRight: { minWidth: 40, alignItems: 'flex-end', paddingRight: 8 },
  card: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cover: { width: 84, height: 120, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  coverInitial: { color: colors.accent, fontSize: 32, fontWeight: '800' },
  cardBody: { flex: 1 },
  cardKind: { color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 2 },
  cardHook: { color: colors.muted, fontSize: 13, marginTop: 4 },
  pillRow: { flexDirection: 'row', marginTop: 6 },
  pill: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  pillOpen: { color: colors.bg, backgroundColor: colors.accent },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
});
