import { useEffect, useState } from 'react';
import type { TvUser } from '../App';
import { ApiError, unpairDevice } from '../api';
import { clearDeviceId, detectPlatform, getDeviceId } from '../device';
import { focusFirst } from '../focus';

interface DevicesScreenProps {
  user: TvUser | null;
  announce: (message: string) => void;
  onBack: () => void;
  onUnpaired: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  'tv-web': 'Smart TV (web)',
  roku: 'Roku',
  tizen: 'Samsung TV',
  webos: 'LG TV',
  other: 'TV',
};

/** TV settings: who is signed in here, and the way out. */
export function DevicesScreen({ user, announce, onBack, onUnpaired }: DevicesScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    focusFirst();
    announce('TV settings.');
  }, [announce]);

  async function unpair() {
    setBusy(true);
    setError('');
    const deviceId = getDeviceId();
    try {
      if (deviceId) await unpairDevice(deviceId);
      clearDeviceId();
      onUnpaired();
    } catch (err) {
      // A session that is already gone means the TV is effectively unpaired.
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        clearDeviceId();
        onUnpaired();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not unpair this TV.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tv-root">
      <h1 className="screen-heading">TV settings</h1>
      <p>
        {user
          ? `This TV is signed in as ${user.username ? `@${user.username}` : user.displayName}.`
          : 'This TV is signed in.'}
      </p>
      <p className="status-line">
        Device type: {PLATFORM_LABELS[detectPlatform()]}. Manage every paired TV at
        sweam.co/settings.
      </p>
      <p className="status-line">
        SweamTV is Sweam&rsquo;s channel for AI-generated binge series and films — sweam.co.
      </p>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
      <div className="button-row" style={{ marginTop: '24px' }}>
        <button type="button" data-tv-focus className="tv-button primary" onClick={onBack}>
          Back
        </button>
        <button type="button" data-tv-focus className="tv-button" onClick={() => void unpair()} disabled={busy}>
          {busy ? 'Unpairing…' : 'Unpair this TV'}
        </button>
      </div>
    </main>
  );
}
