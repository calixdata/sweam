import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { UcastDisclaimer, UcastHeader } from '../../components/UcastBits';
import { colors, radius } from '../../lib/theme';
import {
  UCAST_MAX_ROLES,
  UCAST_MIN_WORK_AGE_YEARS,
  UCAST_WORK_KINDS,
  UCAST_WORK_KIND_LABELS,
} from '../../lib/types';
import type { UcastDuplicateCandidate, UcastRequestInput, UcastWorkKind } from '../../lib/types';

interface RoleRow {
  key: number;
  name: string;
  originalPerformer: string;
}

export default function UcastRequestScreen() {
  const { user } = useAuth();
  const [kind, setKind] = useState<UcastWorkKind>('film');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [hook, setHook] = useState('');
  const [note, setNote] = useState('');
  const [roles, setRoles] = useState<RoleRow[]>([{ key: 1, name: '', originalPerformer: '' }]);
  const [nextKey, setNextKey] = useState(2);
  const [candidates, setCandidates] = useState<UcastDuplicateCandidate[] | null>(null);
  const [confirmDifferent, setConfirmDifferent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const latestYear = new Date().getFullYear() - UCAST_MIN_WORK_AGE_YEARS;

  const addRole = () => {
    if (roles.length >= UCAST_MAX_ROLES) return;
    setRoles((r) => [...r, { key: nextKey, name: '', originalPerformer: '' }]);
    setNextKey((k) => k + 1);
  };
  const removeRole = (key: number) => setRoles((r) => r.filter((x) => x.key !== key));
  const editRole = (key: number, patch: Partial<RoleRow>) =>
    setRoles((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const submit = async () => {
    if (!user) {
      router.push('/signin');
      return;
    }
    const y = Number.parseInt(year, 10);
    if (!title.trim()) return setError('Enter the title.');
    if (!Number.isInteger(y) || y < 1900) return setError('Enter a year from 1900 on.');
    if (y > latestYear) return setError(`UCast is a room for classics: ${latestYear} or earlier.`);
    setSaving(true);
    setError(null);
    const body: UcastRequestInput = {
      kind,
      title: title.trim(),
      year: y,
      hook: hook.trim(),
      note: note.trim(),
      roles: roles
        .map((r) => ({ name: r.name.trim(), originalPerformer: r.originalPerformer.trim() }))
        .filter((r) => r.name.length > 0),
      confirmDifferent,
    };
    try {
      const res = await api.post<{ id: string; slug: string; phase: string }>('/api/ucast/requests', body);
      router.replace(`/ucast/p/${res.slug}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const list =
          (e.body as { check?: { candidates?: UcastDuplicateCandidate[] } } | null)?.check?.candidates ?? [];
        setCandidates(list);
        setError(
          e.code === 'duplicate_poll'
            ? e.message
            : `${e.message} If this is a different work, confirm below and submit again.`,
        );
        if (e.code === 'possible_duplicate') setConfirmDifferent(false);
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not send the request.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <UcastHeader title="Request a poll" />
      <UcastDisclaimer />
      <Text style={styles.lead}>
        Name a classic you want the room to recast. Every request is checked for duplicates and reviewed by a
        UCast admin before it opens; you are notified either way. Works must be {UCAST_MIN_WORK_AGE_YEARS} years
        old or older ({latestYear} or earlier).
      </Text>

      <Text style={styles.label} accessibilityRole="header">
        Kind
      </Text>
      <View style={styles.kinds} accessibilityRole="radiogroup" accessibilityLabel="Kind of work">
        {UCAST_WORK_KINDS.map((k) => {
          const on = kind === k;
          return (
            <Pressable
              key={k}
              onPress={() => setKind(k)}
              style={[styles.kind, on && styles.kindOn]}
              accessibilityRole="radio"
              accessibilityLabel={UCAST_WORK_KIND_LABELS[k]}
              accessibilityState={{ checked: on, selected: on }}
              aria-checked={on}
            >
              <Text style={[styles.kindText, on && styles.kindTextOn]}>{UCAST_WORK_KIND_LABELS[k]}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Little Shop of Horrors"
        placeholderTextColor={colors.muted}
        maxLength={120}
        accessibilityLabel="Title"
      />
      <Text style={styles.label}>Year</Text>
      <TextInput
        style={styles.input}
        value={year}
        onChangeText={setYear}
        placeholder={String(latestYear)}
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        maxLength={4}
        accessibilityLabel="Year of release"
      />
      <Text style={styles.label}>One-liner (optional)</Text>
      <TextInput
        style={styles.input}
        value={hook}
        onChangeText={setHook}
        placeholder="Why this one deserves a recast"
        placeholderTextColor={colors.muted}
        maxLength={300}
        accessibilityLabel="One-liner, optional"
      />

      <Text style={styles.label} accessibilityRole="header">
        Suggested roles (optional, up to {UCAST_MAX_ROLES})
      </Text>
      <Text style={styles.hint}>The admin sets the final list when the poll opens.</Text>
      {roles.map((r, i) => (
        <View key={r.key} style={styles.roleRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <TextInput
              style={styles.input}
              value={r.name}
              onChangeText={(t) => editRole(r.key, { name: t })}
              placeholder="Role"
              placeholderTextColor={colors.muted}
              maxLength={80}
              accessibilityLabel={`Role ${i + 1} name`}
            />
            <TextInput
              style={[styles.input, styles.inputSmall]}
              value={r.originalPerformer}
              onChangeText={(t) => editRole(r.key, { originalPerformer: t })}
              placeholder="Original performer (optional)"
              placeholderTextColor={colors.muted}
              maxLength={80}
              accessibilityLabel={`Role ${i + 1} original performer, optional`}
            />
          </View>
          <Pressable
            style={styles.remove}
            onPress={() => removeRole(r.key)}
            accessibilityRole="button"
            accessibilityLabel={`Remove role ${i + 1}`}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={24} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      <Pressable
        style={[styles.btnGhost, roles.length >= UCAST_MAX_ROLES && styles.disabled]}
        onPress={addRole}
        disabled={roles.length >= UCAST_MAX_ROLES}
        accessibilityRole="button"
        accessibilityLabel="Add a role"
        accessibilityState={{ disabled: roles.length >= UCAST_MAX_ROLES }}
        aria-disabled={roles.length >= UCAST_MAX_ROLES}
      >
        <Text style={styles.btnGhostText}>+ Add a role</Text>
      </Pressable>

      <Text style={styles.label}>Note to the admin (optional)</Text>
      <TextInput
        style={[styles.input, styles.inputMulti]}
        value={note}
        onChangeText={setNote}
        placeholder="Anything the reviewer should know"
        placeholderTextColor={colors.muted}
        maxLength={1000}
        multiline
        accessibilityLabel="Note to the admin, optional"
      />

      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {candidates && candidates.length > 0 && (
        <View style={styles.dupes}>
          <Text style={styles.dupesHeading} accessibilityRole="header">
            Already in the room
          </Text>
          {candidates.map((c) => (
            <Pressable
              key={c.slug}
              onPress={() => router.push(`/ucast/p/${c.slug}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.title} (${c.year}), ${UCAST_WORK_KIND_LABELS[c.kind]}. ${c.reason}`}
            >
              <Text style={styles.dupe}>
                {c.title} ({c.year}) · {UCAST_WORK_KIND_LABELS[c.kind]} · {c.reason}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={styles.checkRow}
            onPress={() => setConfirmDifferent((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityLabel="This is a different work"
            accessibilityState={{ checked: confirmDifferent }}
            aria-checked={confirmDifferent}
          >
            <Ionicons name={confirmDifferent ? 'checkbox' : 'square-outline'} size={22} color={colors.accent} />
            <Text style={styles.checkText}>This is a different work</Text>
          </Pressable>
        </View>
      )}

      {!user && (
        <Pressable onPress={() => router.push('/signin')} accessibilityRole="button" accessibilityLabel="Sign in to request a poll">
          <Text style={styles.link}>Sign in to request a poll.</Text>
        </Pressable>
      )}
      <Pressable
        style={[styles.btn, saving && styles.disabled]}
        onPress={submit}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Send the request"
        accessibilityState={{ disabled: saving, busy: saving }}
        aria-disabled={saving}
        aria-busy={saving}
      >
        <Text style={styles.btnText}>{saving ? 'Sending…' : 'Send request'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, marginTop: 12 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700', paddingHorizontal: 16, marginTop: 16, marginBottom: 6 },
  hint: { color: colors.muted, fontSize: 12, paddingHorizontal: 16, marginBottom: 8 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  kind: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  kindOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  kindTextOn: { color: colors.bg },
  input: {
    marginHorizontal: 16,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  inputSmall: { fontSize: 13 },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  roleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  remove: { width: 40, alignItems: 'center', marginRight: 8 },
  btn: {
    marginHorizontal: 16,
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  btnText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  btnGhost: {
    marginHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  btnGhostText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 12 },
  link: { color: colors.accent, fontSize: 15, fontWeight: '600', paddingHorizontal: 16, marginTop: 14 },
  dupes: { marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  dupesHeading: { color: colors.text, fontWeight: '700', marginBottom: 6 },
  dupe: { color: colors.accent, fontSize: 14, paddingVertical: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  checkText: { color: colors.text, fontSize: 14 },
});
