import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function MeScreen() {
  const { user, signOut } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    api
      .get<{ unread: number }>('/api/me/notifications/unread-count')
      .then((d) => {
        if (active) setUnread(d.unread);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user]);

  if (!user) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.title}>Your Sweam</Text>
        <Text style={styles.muted}>Sign in to like, comment, follow, and post.</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/signup')}>
          <Text style={styles.primaryBtnText}>Join free</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/signin')}>
          <Text style={styles.link}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user.username ?? user.displayName).slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.handle}>@{user.username ?? '—'}</Text>
        <Text style={styles.name}>{user.displayName}</Text>
        <Text style={styles.muted}>{user.email}</Text>
      </View>

      <Pressable
        style={styles.row}
        onPress={() => router.push('/notifications')}
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <Ionicons name="notifications-outline" size={22} color={colors.text} />
        <Text style={styles.rowLabel}>Notifications</Text>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        )}
      </Pressable>

      <Pressable
        style={styles.row}
        onPress={() => router.push('/record')}
        accessibilityRole="button"
        accessibilityLabel="Record a clip"
      >
        <Ionicons name="videocam-outline" size={22} color={colors.text} />
        <Text style={styles.rowLabel}>Record a clip</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>

      <Pressable
        style={styles.row}
        onPress={() => void signOut()}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Ionicons name="log-out-outline" size={22} color={colors.danger} />
        <Text style={[styles.rowLabel, styles.danger]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
    marginTop: 8,
  },
  primaryBtnText: { color: '#04121a', fontSize: 16, fontWeight: '700' },
  link: { color: colors.accent, fontSize: 15 },
  header: { alignItems: 'center', paddingVertical: 32, gap: 4 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarText: { color: colors.accent, fontSize: 40, fontWeight: '800' },
  handle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  name: { color: colors.text, fontSize: 15 },
  row: {
    marginTop: 10,
    marginHorizontal: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  danger: { color: colors.danger },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.bg, fontSize: 12, fontWeight: '800' },
});
