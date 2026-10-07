import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function SignUp() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [age, setAge] = useState(false);
  const [sex, setSex] = useState<'' | 'female' | 'male' | 'nonbinary' | 'undisclosed'>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await signUp({
        email: email.trim(),
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        password,
        sex: sex as 'female' | 'male' | 'nonbinary' | 'undisclosed',
        ageConfirmed: age,
      });
      if (res.pending) setPending(true);
      else router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-up failed.');
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.muted}>
          We sent a verification link to {email}. Confirm it, then sign in.
        </Text>
        <Pressable style={styles.btn} onPress={() => router.replace('/signin')}>
          <Text style={styles.btnText}>Go to sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ gap: 14, paddingVertical: 32 }}>
      <Text style={styles.title}>Join Sweam</Text>
      <TextInput style={styles.input} placeholder="Display name" placeholderTextColor={colors.muted} value={displayName} onChangeText={setDisplayName} />
      <TextInput style={styles.input} placeholder="Username" placeholderTextColor={colors.muted} autoCapitalize="none" value={username} onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Password (8+ characters)" placeholderTextColor={colors.muted} secureTextEntry value={password} onChangeText={setPassword} />
      <Text style={styles.fieldLabel}>Sex</Text>
      <View style={styles.sexRow}>
        {(
          [
            ['female', 'Female'],
            ['male', 'Male'],
            ['nonbinary', 'Non-binary'],
            ['undisclosed', 'Prefer not to say'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            style={[styles.sexChip, sex === value && styles.sexChipOn]}
            onPress={() => setSex(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: sex === value }}
            accessibilityLabel={label}
          >
            <Text style={[styles.sexChipText, sex === value && styles.sexChipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        We use this to power audience filters, like a women-only For You. It is never shown on your
        profile, and you can change it in Settings.
      </Text>
      <Pressable style={styles.ageRow} onPress={() => setAge((a) => !a)}>
        <Ionicons name={age ? 'checkbox' : 'square-outline'} size={22} color={age ? colors.accent : colors.muted} />
        <Text style={styles.ageText}>I confirm I am at least 16 years old.</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.btn, (!age || !sex || busy) && styles.btnDisabled]} onPress={() => void submit()} disabled={!age || !sex || busy}>
        <Text style={styles.btnText}>{busy ? 'Creating…' : 'Create account'}</Text>
      </Pressable>
      <Pressable onPress={() => router.replace('/signin')}>
        <Text style={styles.link}>Already have an account? Sign in</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 24 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 15, marginTop: 8, lineHeight: 21 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    padding: 14,
    fontSize: 16,
  },
  fieldLabel: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  sexRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sexChip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  sexChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  sexChipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sexChipTextOn: { color: '#04121a' },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ageText: { color: colors.text, fontSize: 15, flex: 1 },
  error: { color: colors.danger, fontSize: 14 },
  btn: { backgroundColor: colors.accent, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#04121a', fontSize: 16, fontWeight: '700' },
  link: { color: colors.accent, fontSize: 15, textAlign: 'center', marginTop: 6 },
});
