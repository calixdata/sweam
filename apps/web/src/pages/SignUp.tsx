import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiSend } from '../api';
import { usePageTitle } from '../hooks';

export function SignUp() {
  usePageTitle('Join Sweam');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/auth/signup', { email, displayName, password });
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
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
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
