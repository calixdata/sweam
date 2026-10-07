import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MIN_AGE, USERNAME_HINT, USERNAME_RE } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { usePageTitle } from '../hooks';

type UsernameStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken';

export function SignUp() {
  usePageTitle('Join Sweam');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [password, setPassword] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [sex, setSex] = useState<'' | 'female' | 'male' | 'nonbinary' | 'undisclosed'>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const normalizedUsername = username.trim().toLowerCase();

  // Debounced availability check against the public endpoint.
  useEffect(() => {
    if (normalizedUsername === '') {
      setUsernameStatus('idle');
      return;
    }
    if (!USERNAME_RE.test(normalizedUsername)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiGet<{ available: boolean; valid: boolean }>(
          `/api/auth/username-available?u=${encodeURIComponent(normalizedUsername)}`,
        );
        if (cancelled) return;
        setUsernameStatus(res.valid ? (res.available ? 'available' : 'taken') : 'invalid');
      } catch {
        if (!cancelled) setUsernameStatus('idle');
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedUsername]);

  const canSubmit = ageConfirmed && sex !== '' && usernameStatus === 'available' && !submitting;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/auth/signup', {
        email,
        displayName,
        username: normalizedUsername,
        password,
        sex,
        ageConfirmed,
      });
      setSentTo(email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-up failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <div className="page page-form">
        <h1>Confirm your email</h1>
        <p className="page-intro">
          We sent a verification link to <strong>{sentTo}</strong>. Click it to activate your account,
          then sign in. The link expires in 24 hours.
        </p>
        <ResendVerification email={sentTo} />
        <p>
          Already verified? <Link to="/signin">Sign in</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="page page-form">
      <h1>Join Sweam</h1>
      <p className="page-intro">
        Watching is free. We&rsquo;ll email you a link to confirm your address, then you&rsquo;re in.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="signup-name">Display name</label>
          <input
            id="signup-name"
            type="text"
            autoComplete="name"
            required
            maxLength={60}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="signup-username">Username</label>
          <div className="username-input">
            <span aria-hidden="true" className="username-at">
              @
            </span>
            <input
              id="signup-username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-describedby="signup-username-hint"
            />
          </div>
          <p className="field-hint" id="signup-username-hint" role="status" aria-live="polite">
            {usernameStatus === 'invalid'
              ? USERNAME_HINT
              : usernameStatus === 'checking'
                ? 'Checking availability…'
                : usernameStatus === 'available'
                  ? `@${normalizedUsername} is available.`
                  : usernameStatus === 'taken'
                    ? `@${normalizedUsername} is taken. Try another.`
                    : `Your public @handle. ${USERNAME_HINT}`}
          </p>
        </div>
        <div className="field">
          <label htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby="signup-password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="field-hint" id="signup-password-hint">
            At least 8 characters.
          </p>
        </div>
        <div className="field">
          <label htmlFor="signup-sex">Sex</label>
          <select
            id="signup-sex"
            required
            value={sex}
            onChange={(event) => setSex(event.target.value as typeof sex)}
            aria-describedby="signup-sex-hint"
          >
            <option value="" disabled>
              Select one
            </option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="nonbinary">Non-binary</option>
            <option value="undisclosed">Prefer not to say</option>
          </select>
          <p className="field-hint" id="signup-sex-hint">
            We use this to power audience filters, like a women-only For You. It is never shown on
            your profile. You can change it anytime in Settings.
          </p>
        </div>
        <div className="field field-checkbox">
          <input
            id="signup-age"
            type="checkbox"
            checked={ageConfirmed}
            onChange={(event) => setAgeConfirmed(event.target.checked)}
          />
          <label htmlFor="signup-age">
            I confirm I am at least {MIN_AGE} years old and agree to the{' '}
            <Link to="/legal/terms">Terms</Link> and{' '}
            <Link to="/legal/community-guidelines">Community Guidelines</Link>.
          </label>
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={!canSubmit}>
          {submitting ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/signin">Sign in</Link>.
      </p>
    </div>
  );
}

/** Reusable "resend the verification email" control. */
export function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');

  async function resend() {
    setState('sending');
    try {
      await apiSend('POST', '/api/auth/resend-verification', { email });
    } catch {
      // Endpoint always returns ok; ignore transport errors and show sent.
    }
    setState('sent');
  }

  return (
    <p className="status" role="status">
      {state === 'sent' ? (
        <>If an account needs it, a new link is on its way. Check your inbox and spam folder.</>
      ) : (
        <>
          Didn&rsquo;t get it?{' '}
          <button type="button" className="link-button" onClick={resend} disabled={state === 'sending'}>
            {state === 'sending' ? 'Resending…' : 'Resend the email'}
          </button>
          .
        </>
      )}
    </p>
  );
}
