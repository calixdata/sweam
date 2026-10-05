import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiSend } from '../api';
import { useAuth } from '../auth';
import { usePageTitle } from '../hooks';

/** Confirms a requested email change from the link emailed to the new address. */
export function ConfirmEmailChange() {
  usePageTitle('Confirm email change');
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');
  // The token is single-use; guard against React's double-effect in dev.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState('error');
      setMessage('This confirmation link is missing its token. Request a new change from Settings.');
      return;
    }
    apiSend('POST', '/api/auth/confirm-email-change', { token })
      .then(async () => {
        await refresh();
        setState('done');
      })
      .catch((err: unknown) => {
        setState('error');
        setMessage(
          err instanceof ApiError
            ? err.message
            : 'Could not confirm the email change. Request a new one from Settings.',
        );
      });
  }, [token, refresh]);

  return (
    <div className="page page-form">
      <h1>Confirm email change</h1>
      {state === 'working' && (
        <p className="status" role="status">
          Confirming your new email…
        </p>
      )}
      {state === 'done' && (
        <p className="status status-ok" role="status">
          Your account email has been updated. You can use it to sign in from now on.
        </p>
      )}
      {state === 'error' && (
        <p className="status status-error" role="alert">
          {message}
        </p>
      )}
      <p>
        <Link to="/settings">Back to settings</Link>
      </p>
    </div>
  );
}
