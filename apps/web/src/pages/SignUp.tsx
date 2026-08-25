import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, apiSend } from '../api';
import { useAuth } from '../auth';
import { usePageTitle } from '../hooks';

export function SignUp() {
  usePageTitle('Join Sweam');
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/auth/signup', { email, displayName, password });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-up failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page page-form">
      <h1>Join Sweam</h1>
      <p className="page-intro">Watching is free. Creating is one more step after you join.</p>
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
