import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
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
  const [searchTerm, setSearchTerm] = useState('');

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

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = searchTerm.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
      setSearchTerm('');
    }
  }

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
        <div className="header-inner">
          <div className="header-row">
            <Link to="/" className="brand" aria-label="Sweam home">
              <img className="brand-logo" src="/brand/sweam-wordmark-dark.png" alt="Sweam" />
            </Link>
            <form role="search" className="header-search" onSubmit={handleSearch}>
              <label htmlFor="header-search-input" className="visually-hidden">
                Search titles and creators
              </label>
              <input
                id="header-search-input"
                type="search"
                placeholder="Search titles and creators"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <button type="submit" className="button button-quiet">
                Search
              </button>
            </form>
            <div className="header-account">
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
          </div>
          <div className="header-row">
            <nav aria-label="Primary">
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
                  <NavLink to="/browse">Browse</NavLink>
                </li>
                <li>
                  <NavLink to="/submit">Submit</NavLink>
                </li>
                {user && (
                  <li>
                    <NavLink to="/watchlist">My list</NavLink>
                  </li>
                )}
              </ul>
            </nav>
            <nav aria-label="Workspaces">
              <ul className="nav-links nav-links-secondary">
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
                {user && (
                  <li>
                    <NavLink to="/studio">Studio</NavLink>
                  </li>
                )}
                <li>
                  <NavLink to="/scout">Scout</NavLink>
                </li>
                {user?.isAdmin && (
                  <li>
                    <NavLink to="/admin">Admin</NavLink>
                  </li>
                )}
              </ul>
            </nav>
          </div>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>© 2026 Sweam</p>
      </footer>
    </>
  );
}
