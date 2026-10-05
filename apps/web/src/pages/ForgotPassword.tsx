import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiSend } from '../api';
import { usePageTitle } from '../hooks';

/** Request a password-reset link. The response never reveals whether an account exists. */
export function ForgotPassword() {
  usePageTitle('Reset password');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiSend('POST', '/api/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset email. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="page page-form">
        <h1>Check your email</h1>
        <p className="status status-ok" role="status">
          If an account exists for <strong>{email}</strong>, we've sent a password-reset link. It
          expires in 1 hour.
        </p>
        <p>
          <Link to="/signin">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="page page-form">
      <h1>Reset your password</h1>
      <p className="page-intro">
        Enter your account email and we'll send you a link to set a new password.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="forgot-email">Email</label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p>
        <Link to="/signin">Back to sign in</Link>
      </p>
    </div>
  );
}
