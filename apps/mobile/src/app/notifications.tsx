import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import type { NotificationItem } from '../lib/types';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

function iconFor(kind: string): React.ComponentProps<typeof Ionicons>['name'] {
  switch (kind) {
    case 'follow':
      return 'person-add';
    case 'comment':
      return 'chatbubble';
    case 'submission':
      return 'cloud-upload';
    case 'payout':
      return 'cash';
    case 'interest':
      return 'star';
    case 'strike':
    case 'takedown':
      return 'warning';
    default:
      return 'notifications';
  }
}

/** Route a notification's web-style link to the matching app screen (unknown links are ignored). */
function openLink(link: string | null): void {
  if (!link) return;
  if (link.startsWith('/c/')) router.push(`/c/${link.slice(3)}`);
  else if (link.startsWith('/t/')) router.push(`/t/${link.slice(3)}`);
  else if (link.startsWith('/watch/')) router.push(`/watch/${link.slice(7)}`);
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    api
      .get<{ notifications: NotificationItem[] }>('/api/me/notifications')
      .then((d) => {
        if (active) setItems(d.notifications);
      })
      .catch(() => {
        if (active) setError('Could not load notifications.');
      });
    // Opening the screen clears the unread badge.
    api.post('/api/me/notifications/read-all').catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>Notifications</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  if (!user) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.center}>
          <Text style={styles.muted}>Sign in to see your notifications.</Text>
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

  if (!items) {
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
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No notifications yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => openLink(item.link)}
            disabled={!item.link}
            accessibilityRole={item.link ? 'button' : 'text'}
            accessibilityLabel={`${item.body}${item.read ? '' : ', unread'}`}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={iconFor(item.kind)} size={20} color={colors.accent} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
            </View>
            {!item.read && <View style={styles.dot} />}
          </Pressable>
        )}
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
    paddingBottom: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  muted: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10 },
  primaryBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 3 },
  body: { color: colors.text, fontSize: 15, lineHeight: 20 },
  time: { color: colors.muted, fontSize: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
});
