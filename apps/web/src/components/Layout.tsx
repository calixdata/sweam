import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { apiGet } from '../api';
import { useAuth } from '../auth';

export function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);
  const [unread, setUnread] = useState(0);

  // Refresh the notifications badge on every navigation; a stale badge is
  // worse than one extra count query.
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    apiGet<{ unread: number }>('/api/me/notifications/unread-count')
      .then((data) => {
        if (!cancelled) setUnread(data.unread);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, location.pathname]);

  // On SPA navigation, move focus to the main landmark so screen reader and
  // keyboard users land at the new page content instead of staying mid-header.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <nav aria-label="Primary">
          <Link to="/" className="brand" aria-label="Sweam home">
            Sweam
          </Link>
          <ul className="nav-links">
            <li>
              <NavLink to="/" end>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink to="/discover">Discover</NavLink>
            </li>
            <li>
              <NavLink to="/search">Search</NavLink>
            </li>
            {user && (
              <li>
                <NavLink to="/watchlist">My list</NavLink>
              </li>
            )}
            {user && (
              <li>
                <NavLink to="/studio">Studio</NavLink>
              </li>
            )}
            <li>
              <NavLink to="/scout">Scout</NavLink>
            </li>
            {user && (
              <li>
                <NavLink
                  to="/notifications"
                  aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                >
                  Notifications{unread > 0 ? ` (${unread})` : ''}
                </NavLink>
              </li>
            )}
            {user?.isAdmin && (
              <li>
                <NavLink to="/admin">Admin</NavLink>
              </li>
            )}
          </ul>
          <div className="nav-auth">
            {user ? (
              <>
                <span className="nav-user">{user.displayName}</span>
                <button type="button" className="button button-quiet" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link className="button button-quiet" to="/signin">
                  Sign in
                </Link>
                <Link className="button" to="/signup">
                  Join Sweam
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>
          Sweam is an open-source portfolio project. Demo catalog: Blender Foundation open movies
          (CC-BY, © Blender Foundation, blender.org).
        </p>
      </footer>
    </>
  );
}
