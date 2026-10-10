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
import { router, useLocalSearchParams } from 'expo-router';
import { api, ApiError, mediaUrl } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { UcastDisclaimer, UcastHeader } from '../../../components/UcastBits';
import { daysUntil, phaseLabel, plural, ucastDay } from '../../../lib/ucast';
import { colors, radius } from '../../../lib/theme';
import { UCAST_WORK_KIND_LABELS } from '../../../lib/types';
import type { UcastBallot, UcastBallotInput, UcastPick, UcastPollPage, UcastRole } from '../../../lib/types';

type Draft = Record<string, { pick: string; note: string }>;

function draftFrom(roles: UcastRole[], ballot: UcastBallot | null): Draft {
  const d: Draft = {};
  for (const r of roles) {
    const mine = ballot?.picks.find((p) => p.roleId === r.id);
    d[r.id] = { pick: mine?.pick ?? '', note: mine?.note ?? '' };
  }
  return d;
}

export default function UcastPollScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { user } = useAuth();
  const [page, setPage] = useState<UcastPollPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [ballotNote, setBallotNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyPick, setBusyPick] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const data = await api.get<UcastPollPage>(`/api/ucast/polls/${encodeURIComponent(slug)}`);
      setPage(data);
      setDraft(draftFrom(data.roles, data.myBallot));
      setBallotNote(data.myBallot?.note ?? '');
      setEditing(!data.myBallot);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'That poll is not here.' : 'Could not load the poll.');
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const requireSignIn = (): boolean => {
    if (user) return true;
    router.push('/signin');
    return false;
  };

  const submitBallot = async () => {
    if (!page || !requireSignIn()) return;
    const picks = page.roles
      .map((r) => ({ roleId: r.id, pick: draft[r.id]?.pick.trim() ?? '', note: draft[r.id]?.note.trim() ?? '' }))
      .filter((p) => p.pick.length > 0);
    if (picks.length === 0) {
      setFormError('Cast at least one role.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body: UcastBallotInput = { note: ballotNote.trim(), picks };
      await api.put(`/api/ucast/polls/${encodeURIComponent(page.poll.slug)}/ballot`, body);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save your ballot.');
    } finally {
      setSaving(false);
    }
  };

  const withdrawBallot = () => {
    if (!page) return;
    Alert.alert('Withdraw your ballot?', 'Your picks and the agreements they gathered are removed.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.del(`/api/ucast/polls/${encodeURIComponent(page.poll.slug)}/ballot`);
            await load();
          } catch (e) {
            setFormError(e instanceof ApiError ? e.message : 'Could not withdraw the ballot.');
          }
        },
      },
    ]);
  };

  const toggleAgree = async (pick: UcastPick) => {
    if (!page || !requireSignIn()) return;
    setBusyPick(pick.id);
    try {
      const path = `/api/ucast/picks/${encodeURIComponent(pick.id)}/vote`;
      const res = pick.votedByMe
        ? await api.del<{ votedByMe: boolean; votes: number }>(path)
        : await api.put<{ votedByMe: boolean; votes: number }>(path);
      setPage((prev) =>
        prev
          ? {
              ...prev,
              ballots: prev.ballots.map((b) => ({
                ...b,
                picks: b.picks.map((p) => (p.id === pick.id ? { ...p, votedByMe: res.votedByMe, votes: res.votes } : p)),
                votes: b.picks.reduce((n, p) => n + (p.id === pick.id ? res.votes : p.votes), 0),
              })),
            }
          : prev,
      );
    } catch (e) {
      Alert.alert('Could not record that', e instanceof ApiError ? e.message : 'Try again in a moment.');
    } finally {
      setBusyPick(null);
    }
  };

  if (error) {
    return (
      <View style={styles.screen}>
        <UcastHeader title="UCast" />
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      </View>
    );
  }
  if (!page) {
    return (
      <View style={styles.screen}>
        <UcastHeader title="UCast" />
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} accessibilityLabel="Loading poll" />
      </View>
    );
  }

  const { poll, roles, results, ballots, myBallot } = page;
  const cover = mediaUrl(poll.coverUrl);
  const isOpen = poll.phase === 'open';
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? 'Role';
  const otherBallots = ballots.filter((b) => !b.isMine);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <UcastHeader title={poll.title} />
      <UcastDisclaimer />

      <View style={styles.top}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" accessible={false} />
        ) : (
          <View style={[styles.cover, styles.coverEmpty]}>
            <Text style={styles.coverInitial}>{poll.title.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.kind}>
            {UCAST_WORK_KIND_LABELS[poll.kind]} · {poll.year}
            {poll.official ? ' · by @ucast' : ''}
          </Text>
          <Text style={styles.title} accessibilityRole="header">
            {poll.title}
          </Text>
          {poll.hook ? <Text style={styles.hook}>{poll.hook}</Text> : null}
        </View>
      </View>

      <View style={styles.strip} accessibilityLabel="Poll status">
        <Text style={[styles.stripPill, isOpen && styles.stripPillOpen]}>{phaseLabel(poll.phase)}</Text>
        {poll.phase === 'scheduled' && poll.opensAt && <Text style={styles.stripText}>Opens {ucastDay(poll.opensAt)}</Text>}
        {isOpen && poll.closesAt && (
          <Text style={styles.stripText}>
            Closes {ucastDay(poll.closesAt)} ({plural(daysUntil(poll.closesAt), 'day')} left)
          </Text>
        )}
        {(poll.phase === 'closed' || poll.phase === 'results') && poll.resultsDueAt && (
          <Text style={styles.stripText}>
            {poll.phase === 'results' ? 'Results posted' : 'Results by'} {ucastDay(poll.resultsDueAt)}
          </Text>
        )}
        <Text style={styles.stripText}>
          {plural(roles.length, 'role')} · {plural(poll.ballotCount, 'ballot')}
        </Text>
      </View>

      {page.adminNote ? (
        <View style={styles.note}>
          <Text style={styles.noteText}>Note from UCast: {page.adminNote}</Text>
        </View>
      ) : null}

      {/* Your ballot */}
      {(isOpen || myBallot) && (
        <View style={styles.section}>
          <Text style={styles.h2} accessibilityRole="header">
            Your ballot
          </Text>
          {!user && isOpen && (
            <Pressable onPress={() => router.push('/signin')} accessibilityRole="button" accessibilityLabel="Sign in to cast a ballot">
              <Text style={styles.link}>Sign in to cast a ballot.</Text>
            </Pressable>
          )}
          {user && myBallot && !editing && (
            <View>
              {myBallot.picks.map((p) => (
                <View key={p.id} style={styles.pickRow}>
                  <Text style={styles.pickRole}>{roleName(p.roleId)}</Text>
                  <Text style={styles.pickName}>{p.pick}</Text>
                  {p.note ? <Text style={styles.pickNote}>{p.note}</Text> : null}
                  <Text style={styles.pickVotes}>{plural(p.votes, 'agreement')}</Text>
                </View>
              ))}
              {myBallot.note ? <Text style={styles.ballotNote}>{myBallot.note}</Text> : null}
              {isOpen && (
                <View style={styles.actions}>
                  <Pressable
                    style={styles.btn}
                    onPress={() => setEditing(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Edit your ballot"
                  >
                    <Text style={styles.btnText}>Edit ballot</Text>
                  </Pressable>
                  <Pressable
                    style={styles.btnGhost}
                    onPress={withdrawBallot}
                    accessibilityRole="button"
                    accessibilityLabel="Withdraw your ballot"
                  >
                    <Text style={styles.btnGhostText}>Withdraw</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
          {user && isOpen && editing && (
            <View>
              <Text style={styles.hint}>
                Name who you would cast per role. Leave a role blank to skip it. Text only. Resubmitting replaces
                your earlier ballot and drops the agreements it gathered.
              </Text>
              {roles.map((r) => (
                <View key={r.id} style={styles.roleBlock}>
                  <Text style={styles.roleLabel} nativeID={`role-${r.id}`}>
                    {r.name}
                    {r.originalPerformer ? ` (originally ${r.originalPerformer})` : ''}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={draft[r.id]?.pick ?? ''}
                    onChangeText={(t) => setDraft((d) => ({ ...d, [r.id]: { pick: t, note: d[r.id]?.note ?? '' } }))}
                    placeholder="Your pick"
                    placeholderTextColor={colors.muted}
                    maxLength={80}
                    accessibilityLabel={`Your pick for ${r.name}`}
                    accessibilityLabelledBy={`role-${r.id}`}
                  />
                  <TextInput
                    style={[styles.input, styles.inputSmall]}
                    value={draft[r.id]?.note ?? ''}
                    onChangeText={(t) => setDraft((d) => ({ ...d, [r.id]: { pick: d[r.id]?.pick ?? '', note: t } }))}
                    placeholder="Why (optional)"
                    placeholderTextColor={colors.muted}
                    maxLength={280}
                    accessibilityLabel={`Why ${r.name}, optional`}
                  />
                </View>
              ))}
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={ballotNote}
                onChangeText={setBallotNote}
                placeholder="A note on your whole cast (optional)"
                placeholderTextColor={colors.muted}
                maxLength={1000}
                multiline
                accessibilityLabel="Note on your whole cast, optional"
              />
              {formError && (
                <Text style={styles.error} accessibilityRole="alert">
                  {formError}
                </Text>
              )}
              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, saving && styles.btnDisabled]}
                  onPress={submitBallot}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={myBallot ? 'Save your ballot' : 'Submit your ballot'}
                  accessibilityState={{ disabled: saving, busy: saving }}
                  aria-disabled={saving}
                  aria-busy={saving}
                >
                  <Text style={styles.btnText}>{saving ? 'Saving…' : myBallot ? 'Save ballot' : 'Submit ballot'}</Text>
                </Pressable>
                {myBallot && (
                  <Pressable
                    style={styles.btnGhost}
                    onPress={() => {
                      setEditing(false);
                      setDraft(draftFrom(roles, myBallot));
                      setBallotNote(myBallot.note);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel editing"
                  >
                    <Text style={styles.btnGhostText}>Cancel</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Standings or results */}
      <View style={styles.section}>
        <Text style={styles.h2} accessibilityRole="header">
          {poll.phase === 'results' ? 'Results' : isOpen ? 'Live standings' : 'Standings'}
        </Text>
        {page.resultsNote ? <Text style={styles.hint}>{page.resultsNote}</Text> : null}
        {poll.phase === 'closed' && results.length === 0 && (
          <Text style={styles.hint}>Standings are withheld until results are posted.</Text>
        )}
        {poll.phase === 'scheduled' && <Text style={styles.hint}>Casting has not opened yet.</Text>}
        {results.map((rr) => (
          <View key={rr.role.id} style={styles.roleResult}>
            <Text style={styles.roleResultName}>
              {rr.role.name}
              {rr.role.originalPerformer ? ` (originally ${rr.role.originalPerformer})` : ''}
            </Text>
            {rr.standings.length === 0 ? (
              <Text style={styles.hint}>No ballots yet.</Text>
            ) : (
              rr.standings.slice(0, 5).map((s, i) => (
                <Text
                  key={s.pick}
                  style={[styles.standing, i === 0 && styles.standingTop]}
                  accessibilityLabel={`${i + 1}. ${s.pick}: ${plural(s.ballots, 'ballot')}, ${Math.round(s.share * 100)} percent, ${plural(s.votes, 'agreement')}`}
                >
                  {i + 1}. {s.pick} · {plural(s.ballots, 'ballot')} · {Math.round(s.share * 100)}% ·{' '}
                  {plural(s.votes, 'agreement')}
                </Text>
              ))
            )}
          </View>
        ))}
      </View>

      {/* Ballots from the room */}
      <View style={styles.section}>
        <Text style={styles.h2} accessibilityRole="header">
          Ballots from the room
        </Text>
        {otherBallots.length === 0 && <Text style={styles.hint}>No other ballots yet.</Text>}
        {otherBallots.map((b) => (
          <View key={b.id} style={styles.ballot}>
            <Pressable
              onPress={() => router.push(`/c/${b.author.username}`)}
              accessibilityRole="button"
              accessibilityLabel={`View ${b.author.displayName}'s profile`}
              style={styles.authorRow}
            >
              <Text style={styles.author}>
                {b.author.displayName} <Text style={styles.handle}>@{b.author.username}</Text>
              </Text>
              {b.author.verified && (
                <Ionicons name="checkmark-circle" size={14} color={colors.pink} accessibilityLabel="Verified account" />
              )}
            </Pressable>
            {b.picks.map((p) => (
              <View key={p.id} style={styles.pickRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickRole}>{roleName(p.roleId)}</Text>
                  <Text style={styles.pickName}>{p.pick}</Text>
                  {p.note ? <Text style={styles.pickNote}>{p.note}</Text> : null}
                </View>
                <Pressable
                  style={[styles.agree, p.votedByMe && styles.agreeOn, !isOpen && styles.btnDisabled]}
                  onPress={() => toggleAgree(p)}
                  disabled={!isOpen || busyPick === p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Agree with ${p.pick} as ${roleName(p.roleId)}, ${plural(p.votes, 'agreement')}`}
                  accessibilityHint={p.votedByMe ? 'Takes your agreement back' : 'Adds your agreement'}
                  accessibilityState={{ selected: p.votedByMe, disabled: !isOpen || busyPick === p.id }}
                  aria-selected={p.votedByMe}
                  aria-disabled={!isOpen || busyPick === p.id}
                >
                  <Ionicons name={p.votedByMe ? 'thumbs-up' : 'thumbs-up-outline'} size={16} color={p.votedByMe ? colors.bg : colors.text} />
                  <Text style={[styles.agreeText, p.votedByMe && styles.agreeTextOn]}>{p.votes}</Text>
                </Pressable>
              </View>
            ))}
            {b.note ? <Text style={styles.ballotNote}>{b.note}</Text> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 10 },
  top: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, marginTop: 14 },
  cover: { width: 96, height: 136, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  coverInitial: { color: colors.accent, fontSize: 36, fontWeight: '800' },
  kind: { color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 2 },
  hook: { color: colors.muted, fontSize: 14, marginTop: 6, lineHeight: 20 },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 14,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  stripPill: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  stripPillOpen: { color: colors.bg, backgroundColor: colors.accent },
  stripText: { color: colors.muted, fontSize: 12 },
  note: { marginHorizontal: 16, marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  noteText: { color: colors.text, fontSize: 13 },
  section: { marginTop: 22, paddingHorizontal: 16 },
  h2: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  link: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  roleBlock: { marginBottom: 12 },
  roleLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  inputSmall: { marginTop: 6, fontSize: 13 },
  inputMulti: { minHeight: 70, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: radius.pill, backgroundColor: colors.accent },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  btnGhost: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnGhostText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pickRole: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  pickName: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 1 },
  pickNote: { color: colors.muted, fontSize: 13, marginTop: 2 },
  pickVotes: { color: colors.muted, fontSize: 12, marginTop: 2 },
  ballotNote: { color: colors.muted, fontSize: 13, fontStyle: 'italic', marginTop: 8 },
  roleResult: { marginBottom: 14 },
  roleResultName: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  standing: { color: colors.muted, fontSize: 13, paddingVertical: 2 },
  standingTop: { color: colors.text, fontWeight: '600' },
  ballot: {
    marginBottom: 14,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  author: { color: colors.text, fontSize: 14, fontWeight: '700' },
  handle: { color: colors.muted, fontWeight: '400' },
  agree: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  agreeOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  agreeText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  agreeTextOn: { color: colors.bg },
});
