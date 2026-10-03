import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { USERNAME_HINT, USERNAME_RE } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { usePageTitle } from '../hooks';

type UsernameStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'current';

export function Settings() {
  usePageTitle('Settings');
  const { user, loading, refresh } = useAuth();

  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<UsernameStatus>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the field with the current username once the account loads.
  useEffect(() => {
    if (user?.username) setUsername(user.username);
  }, [user?.username]);

  const normalized = username.trim().toLowerCase();

  useEffect(() => {
    if (!user) return;
    if (normalized === (user.username ?? '')) {
      setStatus('current');
      return;
    }
    if (normalized === '') {
      setStatus('idle');
      return;
    }
    if (!USERNAME_RE.test(normalized)) {
      setStatus('invalid');
      return;
    }
    setStatus('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiGet<{ available: boolean; valid: boolean }>(
          `/api/auth/username-available?u=${encodeURIComponent(normalized)}`,
        );
        if (cancelled) return;
        setStatus(res.valid ? (res.available ? 'available' : 'taken') : 'invalid');
      } catch {
        if (!cancelled) setStatus('idle');
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalized, user]);

  if (loading) return null;
  if (!user) {
    return (
      <div className="page page-form">
        <h1>Settings</h1>
        <p className="status">
          <Link to="/signin" state={{ from: '/settings' }}>
            Sign in
          </Link>{' '}
          to manage your account.
        </p>
      </div>
    );
  }

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await apiSend('POST', '/api/me/username', { username: normalized });
      await refresh();
      setSaved(true);
      setStatus('current');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update your username.');
    } finally {
      setSaving(false);
    }
  }

  const canSave = status === 'available' && !saving;

  return (
    <div className="page page-form">
      <h1>Settings</h1>
      <section aria-labelledby="username-heading">
        <h2 id="username-heading">Username</h2>
        <p className="page-intro">
          Your public @handle. Changing it updates how you appear across Sweam.
        </p>
        <div className="field">
          <label htmlFor="settings-username">Username</label>
          <div className="username-input">
            <span aria-hidden="true" className="username-at">
              @
            </span>
            <input
              id="settings-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-describedby="settings-username-hint"
            />
          </div>
          <p className="field-hint" id="settings-username-hint" role="status" aria-live="polite">
            {status === 'current'
              ? 'This is your current username.'
              : status === 'invalid'
                ? USERNAME_HINT
                : status === 'checking'
                  ? 'Checking availability…'
                  : status === 'available'
                    ? `@${normalized} is available.`
                    : status === 'taken'
                      ? `@${normalized} is taken. Try another.`
                      : USERNAME_HINT}
          </p>
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="status status-ok" role="status">
            Username updated.
          </p>
        )}
        <button type="button" className="button" onClick={() => void save()} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save username'}
        </button>
      </section>

      <section aria-labelledby="billing-heading">
        <h2 id="billing-heading">Subscriptions &amp; billing</h2>
        <p className="page-intro">
          Manage your Sweam Blu subscriptions and scout all-access, update your card, or cancel.
        </p>
        <p>
          <Link className="button button-quiet" to="/me/subscriptions">
            Manage subscriptions
          </Link>
        </p>
      </section>
    </div>
  );
}
