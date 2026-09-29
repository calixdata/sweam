import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function MeScreen() {
  const { user, signOut } = useAuth();

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
      <Pressable style={styles.row} onPress={() => void signOut()}>
        <Text style={styles.rowText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10, marginTop: 8 },
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
    marginTop: 8,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
});
