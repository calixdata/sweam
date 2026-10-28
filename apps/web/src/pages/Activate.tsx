import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { TV_PAIR_CODE_LENGTH } from '@sweam/shared';
import { ApiError, apiSend } from '../api';
import { usePageTitle } from '../hooks';

const PLATFORM_LABELS: Record<string, string> = {
  'tv-web': 'Smart TV',
  roku: 'Roku',
  tizen: 'Samsung TV',
  webos: 'LG TV',
  other: 'TV',
};

/**
 * Claim a SweamTV pairing code. The TV polls while its code is on screen;
 * the moment the code is claimed here, the TV finishes signing in itself.
 */
export function Activate() {
  usePageTitle('Activate your TV');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState<{ platform: string; name: string | null } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await apiSend<{ ok: boolean; device: { platform: string; name: string | null } }>(
        'POST',
        '/api/me/tv/claim',
        { code },
      );
      setConnected(result.device);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try the code again.');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const deviceLabel = connected
    ? connected.name?.trim() || PLATFORM_LABELS[connected.platform] || 'Your TV'
    : '';

  return (
    <div className="page page-form">
      <h1>Activate your TV</h1>
      <p>
        Open SweamTV on your TV and enter the code it shows you here. The TV signs in to your
        account, and whatever you watch there resumes on the web and in the app.
      </p>
      {connected && (
        <p className="status status-ok" role="status">
          {deviceLabel} connected. The TV finishes signing in by itself within a few seconds.
        </p>
      )}
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor="tv-code">TV code</label>
        <input
          id="tv-code"
          ref={inputRef}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setError('');
          }}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={TV_PAIR_CODE_LENGTH}
          aria-describedby="tv-code-hint"
        />
        <p id="tv-code-hint">
          The {TV_PAIR_CODE_LENGTH}-character code on the TV screen. Codes expire after 15
          minutes; the TV can always show a fresh one.
        </p>
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect TV'}
        </button>
      </form>
      <p>
        Manage paired TVs any time in <Link to="/settings#tv-devices">Settings</Link>.
      </p>
    </div>
  );
}
