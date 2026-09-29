import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiSend } from '../api';
import { useAuth } from '../auth';
import { usePageTitle } from '../hooks';

export function Verify() {
  usePageTitle('Verify email');
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState('error');
      setMessage('This link is missing its token. Use the link exactly as it appears in your email.');
      return;
    }
    void (async () => {
      try {
        await apiSend('POST', '/api/auth/verify', { token });
        await refresh();
        setState('success');
      } catch (err) {
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'We could not verify this link.');
      }
    })();
  }, [token, refresh]);

  return (
    <div className="page page-form">
      <h1>Email verification</h1>
      {state === 'verifying' && (
        <p className="status" role="status">
          Verifying your email…
        </p>
      )}
      {state === 'success' && (
        <>
          <p className="status status-ok" role="status">
            Your email is verified and you&rsquo;re signed in.
          </p>
          <button type="button" className="button" onClick={() => navigate('/', { replace: true })}>
            Start watching
          </button>
        </>
      )}
      {state === 'error' && (
        <>
          <p className="status status-error" role="alert">
            {message}
          </p>
          <p>
            Head to <Link to="/signin">sign in</Link> to request a new link, or{' '}
            <Link to="/signup">create an account</Link>.
          </p>
        </>
      )}
    </div>
  );
}
