import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ApiError, api, getToken, mediaUrl } from '../lib/api';
import { API_BASE } from '../lib/config';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import type { BlockedAccount } from '../lib/types';

/** Max profile picture size, mirrored from the API (UPLOAD_SPECS.avatar). */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();

  if (!user) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.muted}>Sign in to manage your account.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile & account</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ProfilePictureSection avatarUrl={user.avatarUrl} name={user.displayName} refresh={refresh} />
        <ChangeEmailSection currentEmail={user.email} />
        <ChangePasswordSection />
        <BlockedAccountsSection />
        <DeleteAccountSection />
      </ScrollView>
    </View>
  );
}

function ProfilePictureSection({
  avatarUrl,
  name,
  refresh,
}: {
  avatarUrl: string | null;
  name: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const uri = mediaUrl(avatarUrl);

  async function pickAndUpload() {
    setStatus(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setStatus({ ok: false, text: 'Allow photo access to choose a picture.' });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > AVATAR_MAX_BYTES) {
      setStatus({ ok: false, text: 'That image is too large. Keep it under 5 MB.' });
      return;
    }
    const contentType = asset.mimeType ?? 'image/jpeg';
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const filename = asset.fileName ?? `avatar.${ext}`;

    setBusy(true);
    try {
      const token = await getToken();
      const up = await FileSystem.uploadAsync(
        `${API_BASE}/api/me/avatar/${encodeURIComponent(filename)}`,
        asset.uri,
        {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'x-sweam-client': 'mobile',
            'content-type': contentType,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      if (up.status < 200 || up.status >= 300) {
        const msg =
          (JSON.parse(up.body || '{}') as { error?: { message?: string } })?.error?.message ??
          'Could not upload that image.';
        throw new Error(msg);
      }
      await refresh();
      setStatus({ ok: true, text: 'Profile picture updated.' });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : 'Could not upload that image.' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setStatus(null);
    setBusy(true);
    try {
      await api.del('/api/me/avatar');
      await refresh();
      setStatus({ ok: true, text: 'Profile picture removed.' });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof ApiError ? err.message : 'Could not remove your picture.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Profile picture</Text>
      <Text style={styles.sectionHint}>Shown next to your name across Sweam. Square works best; up to 5 MB.</Text>
      <View style={styles.avatarRow}>
        {uri ? (
          <Image source={{ uri }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.avatarBtns}>
          <Pressable style={styles.primaryBtn} disabled={busy} onPress={() => void pickAndUpload()}>
            <Text style={styles.primaryBtnText}>{avatarUrl ? 'Change photo' : 'Upload photo'}</Text>
          </Pressable>
          {avatarUrl && (
            <Pressable style={styles.secondaryBtn} disabled={busy} onPress={() => void remove()}>
              <Text style={styles.secondaryBtnText}>Remove</Text>
            </Pressable>
          )}
        </View>
      </View>
      {busy && <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} />}
      {status && (
        <Text
          style={[styles.status, status.ok ? styles.statusOk : styles.statusErr]}
          accessibilityLiveRegion="polite"
        >
          {status.text}
        </Text>
      )}
    </View>
  );
}

function ChangeEmailSection({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setStatus(null);
    setBusy(true);
    try {
      await api.post('/api/me/change-email', { newEmail, password });
      setStatus({ ok: true, text: `Confirmation sent to ${newEmail}. Open it to finish the change.` });
      setNewEmail('');
      setPassword('');
    } catch (err) {
      setStatus({ ok: false, text: err instanceof ApiError ? err.message : 'Could not start the email change.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Email</Text>
      <Text style={styles.sectionHint}>
        Your account email is {currentEmail}. Changing it sends a confirmation link to the new
        address; nothing changes until you confirm it there.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="New email"
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        value={newEmail}
        onChangeText={setNewEmail}
        accessibilityLabel="New email"
      />
      <TextInput
        style={styles.input}
        placeholder="Current password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        accessibilityLabel="Current password"
      />
      <Pressable
        style={[styles.primaryBtn, (!newEmail || !password || busy) && styles.btnDisabled]}
        disabled={!newEmail || !password || busy}
        onPress={() => void submit()}
      >
        <Text style={styles.primaryBtnText}>{busy ? 'Sending…' : 'Send confirmation'}</Text>
      </Pressable>
      {status && (
        <Text
          style={[styles.status, status.ok ? styles.statusOk : styles.statusErr]}
          accessibilityLiveRegion="polite"
        >
          {status.text}
        </Text>
      )}
    </View>
  );
}

function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setStatus(null);
    if (next.length < 8) {
      setStatus({ ok: false, text: 'New password must be at least 8 characters.' });
      return;
    }
    if (next !== confirm) {
      setStatus({ ok: false, text: 'The two new passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/me/change-password', { currentPassword: current, newPassword: next });
      setStatus({ ok: true, text: 'Password changed. Other devices have been signed out.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setStatus({ ok: false, text: err instanceof ApiError ? err.message : 'Could not change your password.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Password</Text>
      <Text style={styles.sectionHint}>Choose a new password. Your other devices will be signed out.</Text>
      <TextInput
        style={styles.input}
        placeholder="Current password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        value={current}
        onChangeText={setCurrent}
        accessibilityLabel="Current password"
      />
      <TextInput
        style={styles.input}
        placeholder="New password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        value={next}
        onChangeText={setNext}
        accessibilityLabel="New password"
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
        accessibilityLabel="Confirm new password"
      />
      <Pressable style={[styles.primaryBtn, busy && styles.btnDisabled]} disabled={busy} onPress={() => void submit()}>
        <Text style={styles.primaryBtnText}>{busy ? 'Saving…' : 'Change password'}</Text>
      </Pressable>
      {status && (
        <Text
          style={[styles.status, status.ok ? styles.statusOk : styles.statusErr]}
          accessibilityLiveRegion="polite"
        >
          {status.text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  body: { padding: 16, gap: 20, paddingBottom: 48 },
  section: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sectionHint: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontSize: 32, fontWeight: '800' },
  avatarBtns: { gap: 10, flex: 1 },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#04121a', fontSize: 15, fontWeight: '700' },
  dangerBtn: { backgroundColor: colors.danger },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  blockedName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  muted: { color: colors.muted, fontSize: 15 },
  status: { fontSize: 14, marginTop: 4 },
  statusOk: { color: colors.accent },
  statusErr: { color: colors.danger },
});

/** Permanent account deletion: password, then a final confirm dialog. */
function BlockedAccountsSection() {
  const [blocks, setBlocks] = useState<BlockedAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ blocks: BlockedAccount[] }>('/api/me/blocks');
      setBlocks(res.blocks);
    } catch {
      setError('Could not load blocked accounts.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(handle: string) {
    setBusy(handle);
    try {
      await api.del(`/api/creators/${encodeURIComponent(handle)}/block`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not unblock that account.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Blocked accounts</Text>
      <Text style={styles.sectionHint}>
        Blocked accounts cannot follow you, and their videos and comments are hidden from you. Block
        someone from the Block button on their profile.
      </Text>
      {error && <Text style={[styles.status, styles.statusErr]}>{error}</Text>}
      {blocks === null ? (
        <ActivityIndicator color={colors.accent} />
      ) : blocks.length === 0 ? (
        <Text style={styles.muted}>You have not blocked anyone.</Text>
      ) : (
        blocks.map((b) => (
          <View key={b.handle} style={styles.blockedRow}>
            <Pressable onPress={() => router.push(`/c/${b.handle}`)} style={{ flex: 1 }}>
              <Text style={styles.blockedName} numberOfLines={1}>
                {b.displayName}
              </Text>
              <Text style={styles.muted}>@{b.handle}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, busy === b.handle && styles.btnDisabled]}
              disabled={busy === b.handle}
              onPress={() => void unblock(b.handle)}
              accessibilityRole="button"
              accessibilityLabel={`Unblock ${b.displayName}`}
            >
              <Text style={styles.secondaryBtnText}>Unblock</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

function DeleteAccountSection() {
  const { signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  function confirmDelete() {
    setStatus(null);
    if (!password) {
      setStatus({ ok: false, text: 'Enter your password first.' });
      return;
    }
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, everything you published, your comments, likes, follows and history, and cancels any subscription. There is no undo.',
      [
        { text: 'Keep my account', style: 'cancel' },
        { text: 'Delete permanently', style: 'destructive', onPress: () => void run() },
      ],
    );
  }

  async function run() {
    setBusy(true);
    try {
      await api.del('/api/me/account', { password, confirm: 'DELETE' });
      await signOut().catch(() => undefined);
      router.replace('/');
    } catch (err) {
      setStatus({ ok: false, text: err instanceof ApiError ? err.message : 'Could not delete your account.' });
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Delete account</Text>
      <Text style={styles.sectionHint}>
        Permanently deletes your account, your profile, everything you published, your comments,
        likes, follows and history, and cancels any Sweam Blu or Scout subscription. This cannot
        be undone.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Your password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        accessibilityLabel="Your password, to confirm deletion"
      />
      <Pressable
        style={[styles.primaryBtn, styles.dangerBtn, busy && { opacity: 0.5 }]}
        disabled={busy}
        onPress={confirmDelete}
        accessibilityRole="button"
        accessibilityLabel="Delete my account permanently"
      >
        <Text style={styles.primaryBtnText}>{busy ? 'Deleting…' : 'Delete my account permanently'}</Text>
      </Pressable>
      {status && (
        <Text style={[styles.status, status.ok ? styles.statusOk : styles.statusErr]} accessibilityLiveRegion="polite">
          {status.text}
        </Text>
      )}
    </View>
  );
}
