import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiSend } from '../api';
import { usePageTitle } from '../hooks';

/** Set a new password from the emailed reset link's token. */
export function ResetPassword() {
  usePageTitle('Set a new password');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/auth/reset-password', { token, password });
      navigate('/signin', {
        replace: true,
        state: { from: '/' },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password. Try again.');
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="page page-form">
        <h1>Set a new password</h1>
        <p className="status status-error" role="alert">
          This reset link is missing its token. Request a new link from{' '}
          <Link to="/forgot-password">Reset your password</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="page page-form">
      <h1>Set a new password</h1>
      <p className="page-intro">
        Choose a new password for your account. You'll be signed out on all devices.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="reset-confirm">Confirm new password</label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Saving…' : 'Set new password'}
        </button>
      </form>
      <p>
        <Link to="/signin">Back to sign in</Link>
      </p>
    </div>
  );
}
