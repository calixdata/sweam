import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
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
import { BluBadge } from '../components/BluBadge';
import { colors, radius } from '../lib/theme';
import type { AccountSearchResult, SearchResults, TitleSummary } from '../lib/types';

type Row = { kind: 'account'; account: AccountSearchResult } | { kind: 'title'; title: TitleSummary };
type Section = { title: string; data: Row[] };

/**
 * Search: accounts first (a username such as "@scionsaga" or a name finds the
 * account itself, creator or not), then titles.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
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
        const data = await api.get<SearchResults>(
          `/api/catalog/search?q=${encodeURIComponent(term)}`,
        );
        setResults({ ...data, accounts: data.accounts ?? [] });
      } catch {
        setResults({ query: term, accounts: [], results: [] });
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const sections: Section[] = [];
  if (results && results.accounts.length > 0) {
    sections.push({
      title: 'Accounts',
      data: results.accounts.map((account) => ({ kind: 'account', account })),
    });
  }
  if (results && results.results.length > 0) {
    sections.push({ title: 'Titles', data: results.results.map((title) => ({ kind: 'title', title })) });
  }
  const empty = !loading && results !== null && sections.length === 0;

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
            placeholder="Search @usernames, titles, and creators"
            placeholderTextColor={colors.muted}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
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

      {empty && (
        <Text style={styles.empty} accessibilityLiveRegion="polite">
          No accounts or titles for “{q.trim()}”.
        </Text>
      )}

      {!loading && sections.length > 0 && (
        <SectionList
          sections={sections}
          keyExtractor={(row) => (row.kind === 'account' ? `a:${row.account.username}` : `t:${row.title.id}`)}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeading} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) =>
            item.kind === 'account' ? <AccountRow account={item.account} /> : <ResultRow title={item.title} />
          }
        />
      )}

      {results === null && !loading && (
        <Text style={styles.hint}>Find accounts by @username, plus films, series, skits, and creators.</Text>
      )}
    </View>
  );
}

function AccountRow({ account }: { account: AccountSearchResult }) {
  const avatar = mediaUrl(account.avatarUrl);
  const followers = `${account.followerCount.toLocaleString()} ${
    account.followerCount === 1 ? 'follower' : 'followers'
  }`;
  const meta = account.isCreator
    ? `@${account.username} · ${followers} · ${account.publishedTitles} ${
        account.publishedTitles === 1 ? 'title' : 'titles'
      }`
    : `@${account.username} · ${followers}`;
  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/c/${account.username}`)}
      accessibilityRole="button"
      accessibilityLabel={`${account.displayName}, ${meta}`}
    >
      {avatar ? (
        <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.avatar, styles.placeholder]}>
          <Text style={styles.avatarInitial}>{account.displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowNameWrap}>
          <Text style={styles.rowName} numberOfLines={1}>
            {account.displayName}
          </Text>
          {account.verified && <Ionicons name="checkmark-circle" size={16} color={colors.accent} />}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
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
        <View style={styles.rowNameWrap}>
          <Text style={styles.rowName} numberOfLines={1}>
            {title.name}
          </Text>
          {title.isBlu && <BluBadge height={16} />}
        </View>
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
  sectionHeading: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface2 },
  avatarInitial: { color: colors.accent, fontSize: 20, fontWeight: '800' },
  thumb: { width: 54, height: 81, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  thumbInitial: { color: colors.accent, fontSize: 24, fontWeight: '800' },
  rowBody: { flex: 1, gap: 3 },
  rowNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  rowMeta: { color: colors.muted, fontSize: 13 },
});
