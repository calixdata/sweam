import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { UPLOAD_SPECS, USERNAME_HINT, USERNAME_RE } from '@sweam/shared';
import { ApiError, apiGet, apiSend } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components/Avatar';
import { usePageTitle } from '../hooks';
import { uploadMedia } from '../upload';

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

      <ProfilePictureSection />

      <ChangeEmailSection />

      <ChangePasswordSection />

      <section aria-labelledby="billing-heading">
        <h2 id="billing-heading">Subscriptions &amp; billing</h2>
        <p className="page-intro">
          Manage your Sweam Blu subscriptions and Scout membership, update your card, or cancel.
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

/** Upload, replace, or remove the account's profile picture. */
function ProfilePictureSection() {
  const { user, refresh } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file be re-picked after an error
    if (!file) return;
    setError(null);
    setNotice('');
    if (file.size > UPLOAD_SPECS.avatar.maxBytes) {
      setError(`That image is too large. Keep it under ${UPLOAD_SPECS.avatar.maxLabel}.`);
      return;
    }
    setBusy(true);
    try {
      await uploadMedia(file, (p) => setNotice(p.message), '/api/me/avatar');
      await refresh();
      setNotice('Profile picture updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that image.');
      setNotice('');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      await apiSend('DELETE', '/api/me/avatar');
      await refresh();
      setNotice('Profile picture removed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove your picture.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="avatar-heading">
      <h2 id="avatar-heading">Profile picture</h2>
      <p className="page-intro">
        Shown next to your name across Sweam. {UPLOAD_SPECS.avatar.recommended}{' '}
        {UPLOAD_SPECS.avatar.formats}, up to {UPLOAD_SPECS.avatar.maxLabel}.
      </p>
      <div className="settings-avatar-row">
        <Avatar
          src={user.avatarUrl}
          name={user.displayName}
          size={72}
          label={`${user.displayName}'s current profile picture`}
        />
        <div className="title-actions">
          <input
            ref={inputRef}
            type="file"
            accept={UPLOAD_SPECS.avatar.accept}
            className="visually-hidden"
            onChange={(e) => void onPick(e)}
          />
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {user.avatarUrl ? 'Change picture' : 'Upload picture'}
          </button>
          {user.avatarUrl && (
            <button
              type="button"
              className="button button-quiet"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="status status-ok" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

/** Request an email change; the new address is confirmed from an emailed link. */
function ChangeEmailSection() {
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiSend('POST', '/api/me/change-email', { newEmail, password });
      setSentTo(newEmail);
      setNewEmail('');
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the email change.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="email-heading">
      <h2 id="email-heading">Email</h2>
      <p className="page-intro">
        Your account email is <strong>{user.email}</strong>. Changing it sends a confirmation link
        to the new address; nothing changes until you confirm it there.
      </p>
      {sentTo && (
        <p className="status status-ok" role="status">
          Confirmation sent to {sentTo}. Open it to finish the change. The link expires in 24 hours.
        </p>
      )}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="settings-new-email">New email</label>
          <input
            id="settings-new-email"
            type="email"
            autoComplete="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="settings-email-password">Current password</label>
          <input
            id="settings-email-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={busy || !newEmail || !password}>
          {busy ? 'Sending…' : 'Send confirmation'}
        </button>
      </form>
    </section>
  );
}

/** Change the password, proving the current one. */
function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiSend('POST', '/api/me/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="password-heading">
      <h2 id="password-heading">Password</h2>
      <p className="page-intro">Choose a new password. Your other devices will be signed out.</p>
      {done && (
        <p className="status status-ok" role="status">
          Password changed. Other devices have been signed out.
        </p>
      )}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="settings-current-password">Current password</label>
          <input
            id="settings-current-password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="settings-next-password">New password</label>
          <input
            id="settings-next-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="settings-confirm-password">Confirm new password</label>
          <input
            id="settings-confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
